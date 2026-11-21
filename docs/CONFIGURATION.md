# Pince configuration

Every setting Pince reads, and where each one is kept. Nothing here needs a value to run Pince on your own computer: all of it is optional.

## The rule for secrets

Keys, passwords, connection strings and tokens are **never written into a tracked file**: not in code, tests, fixtures, scripts, documentation or commit messages. The same goes for anything that identifies one deployment or one family: the site's address, resource names with their unique suffix, account names you chose, real photos and backups.

They are kept in these places only:

| Where | What goes there |
| --- | --- |
| Your shell environment or a local `.env` file (ignored by git) | Settings for running on your own computer |
| `.library/` (ignored by git) | Generated local passwords, the local catalogue and its images, and service keys saved from the app in `settings.json` |
| Azure app settings | Everything the deployed site and worker need; the deployment scripts put them there |

The helper scripts read a secret from hidden input or from Azure, hold it in memory, and pass it on through standard input, so it never appears in a command line, in shell history or in a file.

## Running on your computer

Set these in your shell, or copy [`.env.example`](../.env.example) to `.env`. `npm start` reads `.env` by itself: a value set in the shell takes precedence, and a line left empty sets nothing. `npm run doctor` shows which optional services end up configured, by name only. [Running locally](LOCAL.md) has the walk-through.

The settings of the four outside services (`AZURE_OPENAI_*`, `AZURE_VISION_*`, `GOOGLE_BOOKS_API_KEY` and `BRAVE_SEARCH_API_KEY`) can instead be added in the browser: in the set-up screen on the first start, or by the parent under **Family settings → Services**. The library tries each one with a single small request, saves it in `.library/settings.json` only if the service accepts it, and uses it at once. A saved key is never sent back to the browser, which is told only whether the service is set. The shell and `.env` win over saved settings; a service that they set is shown as set there and cannot be changed from the app. This exists for a library on your own computer only: the deployed site has no such screen.

| Setting | Default | Purpose |
| --- | --- | --- |
| `PORT` | `46173` | Port of the local server |
| `LIBRARY_LOCAL_DIR` | `.library` | Folder for the local catalogue, images and generated passwords |
| `LIBRARY_HOST` | `127.0.0.1` | Address the local server listens on, as an IP address. `0.0.0.0` lets other devices connect; see [Reaching it from other devices](LOCAL.md#reaching-it-from-other-devices) |
| `PUBLIC_APP_ORIGIN` | unset | The address browsers open the library at when a proxy stands in front, such as `https://books.example.org`. Changes are then accepted only from pages at that address, an `https` address keeps the session cookie to HTTPS, and the set-up link is printed with it |
| `LIBRARY_TRUSTED_PROXIES` | `0` | How many proxies of your own stand in front, up to 5. The caller's address, used to limit sign-in attempts, is then read from what those proxies add to `X-Forwarded-For`. A proxy that adds nothing leaves all callers sharing one allowance |
| `LIBRARY_SETUP` | unset | Set to `1` for one start to open the set-up screen again, where `npm start -- --setup` cannot be used |
| `PARENT_USERNAME`, `CHILD_USERNAME` | `parinte`, `copil` | Account names: 1 to 48 ASCII letters, digits, dots, dashes or underscores |
| `BOOTSTRAP_PARENT_PASSWORD`, `BOOTSTRAP_CHILD_PASSWORD` | generated | First passwords, 10 to 128 characters. If unset they are generated once and saved in `.library/local-access.json` |
| `LIBRARY_REASSIGN_ROLES` | unset | Set to `1` for one start after swapping the two account names |
| `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_API_KEY` | unset | The vision model that reads photos. All three are needed before the parent can switch recognition on |
| `AZURE_VISION_ENDPOINT`, `AZURE_VISION_KEY` | unset | The text detector that places title and cover cut-outs. Without it scans still work; rows just have no cut-outs |
| `GOOGLE_BOOKS_API_KEY` | unset | Google Books lookups for title checks and covers |
| `BRAVE_SEARCH_API_KEY` | unset | Image search for covers that the catalogues do not have |
| `AZURE_MONTHLY_RESERVE_USD` | `0.60` | Your estimate of monthly Azure costs other than the model, before tax |
| `TAX_MULTIPLIER` | `1.25` | Allowance for tax and exchange rates on cost estimates |

The endpoints are checked before use: the model endpoint must be an HTTPS address on an Azure OpenAI or Azure AI domain, and the detector's on `cognitiveservices.azure.com`.

## The deployed site and worker

`./scripts/deploy.sh` reads the deployment settings listed in [DEPLOY.md](../DEPLOY.md#deployment-settings) from your environment and asks for the two passwords with hidden input. The Bicep templates in `infra/` then set the app settings below. You do not edit them by hand.

**Site (API)**

| App setting | Set from |
| --- | --- |
| `AZURE_STORAGE_CONNECTION_STRING` | The library's own storage account, read by the template at deployment |
| `PUBLIC_APP_ORIGIN` | The site's HTTPS address |
| `PARENT_USERNAME`, `CHILD_USERNAME`, `BOOTSTRAP_PARENT_PASSWORD`, `BOOTSTRAP_CHILD_PASSWORD` | Your environment or the hidden prompts |
| `AZURE_OPENAI_*` | The model resource created by `init --with-vision` |
| `AZURE_VISION_ENDPOINT`, `AZURE_VISION_KEY` | The library's free-tier Vision account, set by the template, or by `scripts/sync-vision-key.mjs` for a library created before that account existed |
| `GOOGLE_BOOKS_API_KEY` | Copied from the worker by `scripts/sync-review-key.mjs` |
| `AZURE_MONTHLY_RESERVE_USD`, `TAX_MULTIPLIER` | Your environment |

**Cover worker**

| App setting | Set from |
| --- | --- |
| `COVER_QUEUE_URL`, `AZURE_CLIENT_ID` | The template. The worker reads its queue with a managed identity, not a key |
| `LIBRARY_API_ORIGIN` | The site's HTTPS address |
| `GOOGLE_BOOKS_API_KEY` | `scripts/set-google-books-key.mjs` |
| `BRAVE_SEARCH_API_KEY` | `scripts/set-brave-search-key.mjs` |

`publish` keeps both worker keys when it redeploys.

## Storing a service key

Both scripts check the key with one test request before storing it, and change nothing if the check fails.

Brave Search asks for the key with hidden input:

```sh
node scripts/set-brave-search-key.mjs
```

Google Books reads the key from standard input:

```sh
read -r -s GOOGLE_KEY
printf '%s' "$GOOGLE_KEY" | node scripts/set-google-books-key.mjs
unset GOOGLE_KEY
```

[DEPLOY.md](../DEPLOY.md#automatic-cover-suggestions) explains how to create each key, what each service costs, and the request limits the library keeps.

## Checking before you commit

```sh
git status --short
git diff --cached
```

Look for anything that is a value and not a name: a key, a password, a connection string, an address ending in `azurestaticapps.net`, a path inside your home folder, a photo, a backup file. The test suite also fails if a deployment address, storage key or home-folder path appears in the source folders.
