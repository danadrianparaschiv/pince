# The test suite

```sh
npm test            # every test, offline, in a few seconds
npm run coverage    # the same, with a coverage report and minimum levels
npm run check       # what CI runs: formatting of this folder, then coverage
```

Run one file, or one test by name:

```sh
node --import ./test/no-network.js --test test/covers.test.js
node --import ./test/no-network.js --test --test-name-pattern="ISBN" "test/*.test.js"
```

The tests use Node's built-in runner and assertions. There is no test framework to install.

## What is tested where

| File                                            | Covers                                                                                                                                    |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `library.test.js`                               | The API end to end: accounts and sessions, books, public pages, images, bulk delete, shelf photos, spending limits                        |
| `security.test.js`                              | Account hand-over and back-off, the current-password rule, request size limits, and what the cover worker may do                          |
| `store.test.js`                                 | The storage contract, run against both SQLite and the Azure adapter                                                                       |
| `covers.test.js`                                | Cover lookups as a job: queueing, late results, Open Library, backups                                                                     |
| `google-covers.test.js`, `brave-covers.test.js` | The other two cover sources, their matching rules and request limits                                                                      |
| `book-review.test.js`                           | Checking titles read from a photo against the catalogues, and the proof required to save them                                             |
| `shelf-scan.test.js`                            | Shelf photos: tiles, the model's rows, placing each title on its lettering                                                                |
| `covers-scan.test.js`                           | Photos of several covers: finding each cover's edges, the scan mode                                                                       |
| `catalog.test.js`                               | The bookshelf's search, sorting, filters, paging and labels                                                                               |
| `family-features.test.js`                       | Shelf photos in backups, lending, the reading log, the wishlist and its public link                                                       |
| `local.test.js`                                 | Running on a computer: the settings file, the health check, backup and restore from the command line                                      |
| `setup.test.js`                                 | Setting up a local library in the browser: the one-time link, choosing the accounts, checking and saving service keys                     |
| `network.test.js`                               | A local library that other devices reach: where it listens, the address people open, proxies, the pages' browser policy, stopping cleanly |
| `deploy-script.test.js`                         | The deployment script's `doctor`, `status` and `destroy`, against a stand-in for the Azure CLI                                            |
| `repository.test.js`                            | The repository itself: nothing private in it, documentation that matches the code                                                         |

`helpers.js` holds what the files share: a temporary store, a running copy of the API, and test pictures. Real photos are not part of the repository: keep your own in `sample-photos/` or `sample-images/`, which git ignores, for trying the photo methods by hand. `fixtures/` holds recorded data: hand-read labels for three shelf photos and a text detector's answer for one of them.

## How the tests are written

- **Offline and free.** `no-network.js` is loaded before every file and fails the run if anything calls the network, even when the code under test would have treated that as an outage. The model, the text detector, the catalogues and Brave are stand-ins passed into the code, so no test needs a key or costs money.
- **Real storage, real images.** Tests use a real SQLite store in a temporary folder and real JPEG bytes made on the spot. Only the outside world is replaced.
- **Through the front door where it matters.** Rules about who may do what are tested through the API with real sessions (`startLibrary` in `helpers.js`), not by calling inner functions.
- **A test tells a story.** Many tests follow one scenario through several steps (save, look up, edit, delete) because the steps depend on each other. The name says what must hold, and comments mark the reason for each step that is not obvious.
- **Names state behaviour.** A test is named for what the library does ("a lookup that finishes late keeps an uploaded cover"), not for the function it calls.
- **No sleeping.** Nothing waits on a real clock. Code that waits takes its delay as a parameter, back-off and expiry are tested by moving a mock clock, and tests of concurrent requests hold one request open with a promise.

## Coverage

`npm run coverage` fails below 95% of lines, 85% of branches and 90% of functions. The figures are for the API, the worker's code, the local store and the bookshelf logic in `web/strings.js`.

Two things are deliberately outside them:

- **The browser screens** (`web/app.js`, `web/import.js`, `web/parent.js`, `web/setup.js`, `web/services.js`) are not run by the tests. Their logic that can be a pure function lives in `web/strings.js` or is exported (photo tiling, cover placement) and is tested; the screens themselves are checked by hand in a browser.
- **The deployment scripts** in `scripts/` and the templates in `infra/` are exercised by deploying. `deploy.sh` runs its own checks against the published site.

## Adding a test

1. Put it in the file for its area, or start a new `*.test.js` file for a new area.
2. Build on `tempStore` or `startLibrary` from `helpers.js`.
3. Pass stand-ins for anything outside the process. If you need `fetch` itself, mock it for that one test with `t.mock.method(globalThis, 'fetch', ...)`.
4. Run `npm run format` before committing. Formatting of this folder is checked in CI.

Photos used as samples must have their metadata removed first; see [CONTRIBUTING.md](../CONTRIBUTING.md).
