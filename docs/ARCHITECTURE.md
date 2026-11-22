# Pince architecture

How Pince is put together, for someone reading or changing the code.

## The parts

| Part | Where | Runs as |
| --- | --- | --- |
| Browser app | `web/` | Static files. Plain ES modules, no build step, no framework |
| API | `api/src/` | One request handler, `makeApp` in `app.js` |
| Cover worker | `worker/main.js` with code from `api/src/` | A timer that drains a queue of cover lookups |
| Storage | behind a small store interface | SQLite and a folder on your computer; Table, Blob and Queue Storage on Azure |

The same API code runs in both places. Only the outer layer differs:

- **On your computer**, `scripts/dev.js` serves `web/`, passes `/api/*` to the handler, and runs cover lookups in the same process (`scripts/local-covers.js`). Data is kept by `scripts/local-store.js` in `.library/`. It also hands the handler the set-up routes in `scripts/local-setup.js`, which the deployed API never loads.
- **On Azure**, a Static Web App on the Free plan serves `web/` and runs `api/src/azure.js` as its managed Functions API, with `api/src/azure-store.js` for data. The cover worker is a separate Flex Consumption Function App, because a managed API can only answer HTTP requests.

## The store

Everything the API keeps goes through one object with a handful of methods: `get`, `cas` (write only if unchanged), `list`, `putImage`, `getImage`, `deleteImage` and `enqueueCover`. Records are JSON documents in named groups:

| Group | Holds |
| --- | --- |
| `books` | One record per book: details, note, flags, chosen cover, cover suggestions, lookup state, shelf photo link |
| `users` | The two accounts: role, password hash, language, session digests |
| `limits` | Counters for sign-in attempts and request throttles |
| `scans` | The answer of each photo scan, by request ID, so a repeated request is not paid for twice |
| `shelf-photos` | One record per kept shelf photo |
| `book-reviews`, `book-review-receipts` | Cached catalogue answers, and the receipt that proves a row from a photo was reviewed |
| `system` | Spending totals and switches, and request counters for Google Books and Brave |

Images are separate: each cover as a full-size JPEG and a thumbnail, and each kept shelf photo.

Changes use optimistic concurrency. `change(store, group, key, update)` in `store.js` reads a record, applies a side-effect-free function, and writes only if nobody else wrote in between, retrying otherwise. Books also carry a `version` that the browser sends back, so two people editing the same book cannot silently overwrite each other.

## The API

All routes are under `/api`. Everything except the first three needs a signed-in session.

| Route | Who | Purpose |
| --- | --- | --- |
| `GET /public/:id` | anyone | Title, author and cover address of one book |
| `GET /covers/:id/:key[/thumb]` | anyone for the chosen cover; family for the others | A cover image |
| `POST /cover-jobs/:id/:action` | the cover worker, with a per-job token | Claim a lookup, report its result, count a request |
| `POST /login`, `POST /logout`, `GET /me`, `PATCH /me` | | Session and language |
| `GET /books`, `POST /books` | family | List the catalogue; add up to 20 books |
| `GET`, `PATCH`, `DELETE /books/:id` | family; delete is parent only | One book |
| `POST /books/delete` | parent | Delete several books |
| `POST /books/:id/cover-lookup` | family | Search for covers on request, or again |
| `POST /scan` | family | Read a photo: one cover, a shelf, or several covers |
| `POST /book-review` | family | Check one title against the catalogues |
| `GET /shelf-photos`, `DELETE /shelf-photos/:id` | parent | List or delete kept shelf photos |
| `GET /shelf-photos/:id` | family | A kept shelf photo |
| `GET`, `PATCH /admin/settings`, `PATCH /admin/accounts`, `POST /admin/restore` | parent | Recognition switch and costs, accounts, restore a backup |

A library on your own computer has a few more routes, for setting it up from the browser. They do not exist on Azure.

| Route | Who | Purpose |
| --- | --- | --- |
| `GET /setup` | anyone | Whether set-up is still waiting, for the hint on the sign-in page |
| `GET /setup/state`, `POST /setup/accounts`, `POST /setup/services`, `POST /setup/finish` | the holder of the one-time set-up link | Choose the two accounts, add service keys, end set-up |
| `PATCH /admin/services` | parent | Add, replace or remove a service's keys after set-up |

Errors come back as `{ "error": "<code>" }` with a matching status. The browser turns the code into a sentence in the reader's language.

## Adding books from photos

`POST /scan` takes a mode. All three share the same rules: the request carries an ID so a retry returns the stored answer, the full cost is reserved before the model is called, and text in a photo is treated as data, never as instructions.

**One cover (`cover`).** The photo goes to the vision model, which returns one row of title, authors, publisher and date.

**A shelf (`shelf`).** Code in `shelf-scan.js`, `shelf-ocr.js` and `shelf-photos.js`.

1. The browser sends the whole photo plus up to six overlapping zoomed tiles, so thin spines stay readable.
2. The model lists one row per book, with series, confidence and a note. Rows reported from two tiles are merged, and publisher names are normalised to known spellings.
3. In parallel, a text detector reports where every line of text is printed. A title is placed by finding its own words among those lines, and gets a cut-out only on a strong match. The model is not asked for positions: in tests it put titles on neighbouring spines.
4. The photo is kept, and books saved from it link back to it.

**Several covers (`covers`).** Code in `covers-scan.js` and `cover-finder.js`.

1. The model lists one row per book laid face up, with its own instructions for front covers.
2. The text detector's lines place each title, as for a shelf.
3. `cover-finder.js` then finds the edges of each cover. It estimates the colour of the surface from the photo's border. Starting at a title, each side moves outward to the first straight line with that surface beyond it. Where two covers touch there is no surface between them, so the line is the straightest edge between their two titles, and that cover is marked for checking.
4. The browser cuts each cover from the full-size photo and offers a hand crop when a cut-out is off or missing. The photo is not kept.

In every mode the rows then go through **review** (`book-review.js`): each title is looked up in Google Books and Open Library, and the reader picks a suggestion or confirms what they see. A row sent as coming from a photo is refused without proof of that review.

## Finding covers

Saving a book queues a lookup instead of doing it in the request. A book whose chosen cover is the reader's own picture is the exception: a save queues nothing for it, when it is added, edited or restored, and it is searched when someone asks through `POST /books/:id/cover-lookup`. The search would only add pictures beside the reader's own, at the cost of requests to the outside services.

1. `cover-jobs.js` marks the book as queued, with a random token, and puts a message on the queue.
2. The worker claims the job through the API, using the token as its only credential. It never touches storage directly.
3. `cover-providers.js` tries Open Library, then Google Books, then, when a key is set and fewer than two covers were found, an image search through Brave (`brave-covers.js`). A search result is used only when it comes from a known bookshop or publisher page whose title names the book.
4. The worker reports up to two distinct covers. They become suggestions; the first is selected only for a book that has no cover and whose cover was never chosen by hand.

Only fixed hosts are contacted. An address taken from a search result is never fetched, apart from Brave's own image proxy. Daily and monthly request counters keep each service inside its free allowance.

## Spending limits

`scans.js` records an estimate of every model call in integer millionths of a dollar. Before a call it reserves the worst case, and afterwards it replaces the reservation with the reported usage. Scanning is refused once the month or the trailing year reaches the fixed limits described in [deployment and costs](../DEPLOY.md). The parent sees the totals in **Family settings**.

## Security design

- **Sessions.** Signing in sets an `HttpOnly`, `SameSite=Lax` cookie limited to `/api`, and `Secure` when deployed. The server stores only a hash of the token. A session lasts a week, and changing a password ends every session of that account.
- **Passwords** are hashed with scrypt. Sign-in is throttled per network and backs off per account. Setting a new password, for either account, needs the parent's own current password, with a few attempts allowed per ten minutes.
- **Cross-site requests.** A request that changes anything must come from the library's own origin.
- **Images.** Every uploaded image is decoded, resized and re-encoded on the server, which also drops embedded metadata such as location. Sizes are capped before decoding.
- **Public pages** expose a book's title, author and chosen cover. Other covers, notes and shelf photos need a session.
- **Browser policy.** `web/staticwebapp.config.json` sets a content security policy that allows only the site's own scripts and requests. The local server sends the same headers, read from that file.
- **A local library on a network.** `scripts/local-network.js` holds what lets other devices reach a library on your own computer: the address it listens on, the address people open, the proxies in front, and stopping cleanly.
- **Logs** never include request bodies, credentials or photos.
- **Setting up a local library.** The set-up routes accept only the random token of the link printed in the terminal. The token lives in memory, is compared in constant time, and is dropped when set-up is finished or the program stops. The browser takes it out of the address bar and keeps it for that tab only. Service keys are written once and never read back through the API, each is tried against its service before it is saved, and an Azure key is only ever sent to an HTTPS address on that service's own domain (`api/src/endpoints.js`).

[SECURITY.md](../SECURITY.md) covers how to report a problem and how secrets are handled.

## The browser app

| File | What it does |
| --- | --- |
| `app.js` | Routing, the bookshelf, a book's page, the edit dialog, the cover picker |
| `import.js` | The add-books screen: photo handling, scanning, review, saving |
| `parent.js` | Family settings |
| `setup.js`, `services.js` | The set-up screen of a local library, and the service-key forms it shares with Family settings |
| `strings.js` | Labels in Romanian and English, and pure helpers (filtering, sorting, paging) that the tests exercise directly |
| `duplicates.js` | Which books look like the same book: one rule for the add-book warning, the edit warning and the bookshelf filter |
| `icons.js`, `*.css` | Icons and styles |

State lives in memory and is redrawn from it. There is no client-side storage of catalogue data.
