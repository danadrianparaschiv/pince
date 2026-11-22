# Deploy Pince on Azure

The deployment creates an Azure Static Web App on the Free plan with its managed Node 22 HTTP API, a Standard LRS storage account, a private `covers` blob container, and the `LibraryData` table. It uses the Azure-provided HTTPS hostname. The optional vision model is a separate, pay-per-token deployment in the same resource group. [Static Web Apps plans](https://azure.microsoft.com/en-us/pricing/details/app-service/static/) · [Supported API runtimes](https://learn.microsoft.com/en-us/azure/static-web-apps/configuration#select-the-api-language-runtime-version)

## First deployment

Use Bash on macOS, Linux, or WSL with Node **22**, npm **10.3+**, Azure CLI with Bicep, and Microsoft’s Static Web Apps CLI **2.1.0+**. Version 2.1.0 recognizes the Node 22 runtime. Your Azure account needs permission to create the group and resources, read the storage and deployment keys, and optionally create cost budgets. [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli) · [SWA CLI deployment](https://learn.microsoft.com/en-us/azure/static-web-apps/static-web-apps-cli-deploy)

From the project directory. `./scripts/deploy.sh doctor` checks these tools and your Azure sign-in first, and changes nothing. You do not need to run `npm run setup` before deploying; the script installs what it uploads. Creating a library takes six to seven minutes, a later `publish` about five, and `destroy` two to four:

```sh
npm install --global @azure/static-web-apps-cli@2.1.0
az bicep install
az login
az account set --subscription 'YOUR_SUBSCRIPTION_ID'
./scripts/deploy.sh setup
```

On a minimal Linux, such as a container or a fresh server, Bicep installs but cannot start until the ICU library is present. `doctor` says so; on Ubuntu or Debian the fix is `sudo apt-get install libicu-dev`.

`setup` runs the `doctor` checks and then asks, one question at a time, for everything the deployment needs:

1. the subscription, when your sign-in has more than one. Choosing another one changes the subscription the Azure CLI uses on this computer;
2. the resource group and the region;
3. the names of the parent and child accounts, **parinte** and **copil** unless you type others;
4. a password for each account, typed twice without being shown;
5. whether to add photo recognition;
6. an email address for cost alerts, which can be left empty.

It shows a summary and creates nothing until you answer **y**. An empty answer takes the value shown in brackets. If the resource group already holds a finished library, `setup` creates nothing and only offers the optional keys; if an earlier attempt stopped half-way, it tries again in the same group.

After that it does what `init` does: it stages dependencies for Azure’s Linux x64 runtime, provisions the resources, and publishes the app. Last, it offers to store the Google Books and Brave keys described under [Automatic cover suggestions](#automatic-cover-suggestions); press Enter to skip either. Keep both passwords in your password manager. The script prints the HTTPS address after verifying the release, anonymous access rules, and a parent sign-in through the deployed proxy. A real model call is made only when a signed-in user explicitly requests recognition and the parent has enabled it.

`./scripts/deploy.sh init --with-vision` is the same deployment without the questions: it reads the [deployment settings](#deployment-settings) from your environment and asks only for the two passwords. Use it for an unattended deployment, or to change an existing one. For a deployment with manual entry and photo uploads only, run `./scripts/deploy.sh init`. To add recognition later, rerun `init --with-vision` with the same group and usernames. Use the current parent password for the sign-in check. Existing account records retain passwords set in the app. Use `publish` for routine code updates.

The default resource group is `pince-rg` in West Europe. The optional vision account is in Sweden Central and deploys `gpt-5-mini` version `2025-08-07` with the **Global Standard** SKU. Your subscription needs Global Standard quota for that model in the selected AI region. A quota or region rejection can be addressed by choosing an available `VISION_LOCATION` and rerunning, or running `init` to use manual entry. Microsoft currently schedules this model version for retirement on 13 July 2027. Before then, verify a replacement on a family shelf photo and update the deployment, the token rates and reservation in `api/src/scans.js`, and its budget tests together. [Microsoft model regions](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/concepts/models) · [Model lifecycle](https://learn.microsoft.com/en-us/azure/foundry/openai/concepts/model-retirement-schedule)

## Deployment settings

`setup` asks for the resource group, the region, the account names, the passwords and the alert address, and offers a value already set in your environment as the default. A password set in the environment is used without asking. The other rows are read from the environment by `setup` and `init` alike.

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `LIBRARY_RESOURCE_GROUP` | `pince-rg` | Dedicated group for deployment, cost reporting, and later updates. Keep this value for every publish. |
| `LIBRARY_LOCATION` | `westeurope` | Region for the site and storage. Choose a region that supports Static Web Apps. |
| `VISION_LOCATION` | `swedencentral` | Region for optional Azure OpenAI quota. |
| `PARENT_USERNAME`, `CHILD_USERNAME` | `parinte`, `copil` | Different account names, 1–48 ASCII letters, digits, dots, dashes, or underscores. |
| `BOOTSTRAP_PARENT_PASSWORD`, `BOOTSTRAP_CHILD_PASSWORD` | Prompted at `setup` and `init` | 10–128 characters. For unattended setup, inject from your CI secret store. Bicep receives secure parameters through standard input. |
| `AZURE_MONTHLY_RESERVE_USD` | `0.60` | Monthly estimate of non-model Azure costs before tax. Update against actual resource-group charges. |
| `TAX_MULTIPLIER` | `1.25` | Allowance for tax and exchange-rate variation, applied to USD estimates. Set for your bill. |
| `BUDGET_EMAIL` | Optional | Recipient of resource-group cost alerts. Supplying it to `init`, or answering the question in `setup`, creates both monthly and annual budgets. |
| `MONTHLY_BILLING_BUDGET`, `ANNUAL_BILLING_BUDGET` | `3`, `30` | Amounts in the **Azure billing currency** for alerts; decimals such as `2.10` are accepted. Allow for tax and exchange rates when setting pre-tax budgets. The app tracks its own limits in USD. |

With `--with-vision` the template also creates a free-tier (F0) Azure AI Vision account in the site's region and sets `AZURE_VISION_ENDPOINT` and `AZURE_VISION_KEY`. Each shelf scan sends one copy of the photo, at most 2,048 pixels on its long edge, to its text detector to find where each title is printed; single covers are not sent. A photo of several front covers is sent the same way, and each cover's edges are then found on the server from its title's place and the colour of the surface around it; that photo is not stored. The free tier allows 5,000 reads a month at 20 a minute and cannot bill, so these reads are outside the scan budget; if the tier is ever changed to a paid one, add a cost hold in `api/src/scans.js` first. A subscription can hold only one free Vision account. When the detector is missing, over its limit or slow, the scan still completes and the rows just have no cut-out. `publish` copies the endpoint and key of an existing `pince-ocr-*` account into the site settings, so a library created before this feature needs no re-provisioning.

The Bicep template sets `AZURE_STORAGE_CONNECTION_STRING` on the managed API. For a vision deployment it also sets `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`, and `AZURE_OPENAI_API_KEY` there. Access to these settings should be limited to the parent and deployment administrators. The public book view retrieves only the selected cover derivative through the API. The raw storage container has anonymous access disabled.

## Monthly and annual cost

The planning estimate uses **1 GB of blobs**, **10,000 blob reads**, **1,000 blob writes**, **up to 2 GB of public and family traffic**, and one included Free-plan static site. West Europe hot LRS capacity at $0.0196/GB-month, reads at $0.0043/10,000 and writes at $0.054/10,000 total about $0.03. The other $0.57 of the $0.60 Azure reserve covers tables, queue and worker storage operations, miscellaneous operations, and transfers. Subscription-wide free allowances must be available. [Microsoft retail storage meters](https://prices.azure.com/api/retail/prices?%24filter=armRegionName%20eq%20%27westeurope%27%20and%20productName%20eq%20%27General%20Block%20Blob%20v2%27%20and%20skuName%20eq%20%27Hot%20LRS%27) · [Bandwidth pricing](https://azure.microsoft.com/en-us/pricing/details/bandwidth/)

At the published GPT-5 mini Global Standard rates of $0.25 per million input tokens and $2.00 per million output tokens, a scan averaging 4,000 input and 1,000 output tokens costs $0.003. Images and reasoning contribute to actual metered usage. At the assumed rates and workload:

| Use | Estimated Azure + model before tax | Estimate with 1.25 multiplier |
| --- | ---: | ---: |
| One month, manual catalog only | $0.60 | $0.75 |
| One month, 100 scans | $0.90 | $1.13 |
| 500 individual cover scans, before the app cap | $2.10 | $2.63 |
| 500 import scans plus 11 ordinary months, before the app cap | $12.00 | $15.00 |

Shelf photos can add up to 20 books in a single call. A shelf photo larger than about 1.5 megapixels is sent as one overview plus two to six overlapping zoomed tiles, so that thin spines stay legible; each image adds up to about 2,500 input tokens. Shelf requests allow 4,000 output tokens and reserve $0.0095 for a single image, rising to $0.0134 with six tiles, at the configured rates. A tiled shelf scan typically settles near $0.005–$0.008, so the 100-scan row above is closer to $1.20–$1.40 before tax when every scan is a full shelf. A photo of several front covers is sent and held like a shelf photo. Single covers allow 1,000 and reserve $0.0035. Scan quotas reserve the cost before contacting Azure, so an import may reach its limit early if scans consume more than the example. Manual entry and attaching covers still work. The service tracks **$1.50 per month and $12 over twelve months for model usage**, with combined cost targets of **$2.25 and $26**. Resource charges, public traffic, taxes, and prices can vary. Azure’s pay-as-you-go billing can exceed an alert threshold. [Microsoft model pricing](https://devblogs.microsoft.com/foundry/whats-new-in-azure-ai-foundry-august-2025/) · [Azure budget behavior](https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/tutorial-acm-create-budgets)

To add the optional alerts after deployment, use:

```sh
BUDGET_EMAIL='your-address@example.com' ./scripts/deploy.sh budgets
```

The alert fires at 75% of each budget. Azure evaluates the group’s costs after usage occurs. Its annual alert follows a 12-month budget period starting the chosen month. The app separately checks the trailing period before paid scans. In Azure Cost Management, check the dedicated resource-group actuals and invoice tax after the first import and at least monthly. Adjust the reserve and pause recognition from the parent settings if spending moves above plan. If the subscription cannot create a budget yet, the app can still operate; rerun the budgets command once billing and permissions are available. For an existing annual budget, set `BUDGET_START_DATE` to its original first-of-month date when changing thresholds or recipients.

## Check, inspect and remove

```sh
./scripts/deploy.sh doctor
```

Checks Node, npm, zip, the Static Web Apps CLI, the Azure CLI with Bicep, and your sign-in, and says whether a library already exists in the resource group. It reports every problem at once and creates nothing. `setup` starts with the same checks.

```sh
./scripts/deploy.sh status
```

Shows the site, its address, the release that is live, the cover worker, and which optional services are set. Settings are shown as set or not set, never by value.

```sh
./scripts/deploy.sh destroy
```

Deletes the resource group and everything in it: the site, the catalogue, every cover and shelf photo. It lists what will go and asks you to type the resource group's name; anything else deletes nothing. It refuses a resource group that this script did not create a library in. Afterwards it clears the deleted AI accounts, which Azure would otherwise hold for weeks and which would block a new library with the same names. Download a backup from **Family settings** first if you may want the books back. For unattended use, set `LIBRARY_CONFIRM_DESTROY` to the group's name.

## Updates and acceptance checks

```sh
./scripts/deploy.sh publish
```

Publishing updates the static content and managed API while retaining books, account records, images, and settings in Azure. The script checks a fingerprint of the new release, opens the home page and anonymous session endpoint, and checks that a signed-out request to the catalog gets HTTP 401. When the parent credentials are provided, it also checks session-cookie forwarding and sign-out. The infrastructure definition is in [infra/main.bicep](infra/main.bicep), with the site's settings in [infra/site-settings.bicep](infra/site-settings.bicep), and [infra/budgets.bicep](infra/budgets.bicep) controls email alerts.

After the first deployment, add one book and one private note. Open its copied link in a private browser, switch from Romanian to English, and check that the page shows the public title, author, and chosen cover. Confirm the private notes and family catalog require sign-in. If vision was enabled, use one real shelf photo and review the suggestions and estimated spending before starting the 500-book import.

To prepare an inspectable package on your computer without connecting to an Azure subscription, run `./scripts/deploy.sh package /tmp/pince-release` with a new output directory. It contains only the public web assets and the managed API with Linux dependencies. Deployment does not require a GitHub repository.


## Security upgrade for existing libraries

The HTTP adapter authenticates protected requests before reading them and applies streamed limits (4 KB for login, up to 9 MB for authorized uploads). Managed Static Web Apps rejects the reserved `FUNCTIONS_REQUEST_BODY_SIZE_LIMIT` setting, so these limits are enforced in application code rather than by a configurable host ceiling.

Run `./scripts/deploy.sh publish` to upgrade the managed API and worker together. The deploying identity needs permission to create a user-assigned managed identity and role assignments in the resource group. The worker uses its own host storage account for deployment packages and timer locks. Its only role on the family storage account is **Storage Queue Data Message Processor**, scoped to the cover queue. The API supplies title, author and ISBN for the queued job and validates returned images. Existing accounts, private notes, covers and queued jobs keep their original storage locations.

The upgrade signs out existing family sessions once. Changing the configured parent or child username also expires family sessions. If a former parent name is reassigned to the child, the current parent can set a new child password in **Family settings**. For an intentional role swap, set the new usernames and run `LIBRARY_REASSIGN_ROLES=1 ./scripts/deploy.sh init` with the same vision option as your existing deployment. Enter fresh passwords for the reassigned accounts. For local development the same flag works with `npm start` and explicit bootstrap passwords. Repeating the handoff preserves accounts already assigned to the requested role.

The worker timer runs about 43,200 times in a 30-day month, including idle queue checks. The $0.60 monthly infrastructure allowance includes its status writes, queue polling and host leases. Lease acquire/renew/release are billed as lower-priced **other operations** on Standard v2 storage. Reconcile this allowance against actual billing after a full month. [Lease billing](https://learn.microsoft.com/en-us/rest/api/storageservices/lease-blob#billing)

## Automatic cover suggestions

Saving a book that has no picture of its own queues an Open Library lookup, with Google Books as a fallback when fewer than two covers are found. A book saved with the reader's own picture, such as one added from a cover photo, is looked up only when someone chooses **Find covers online**, so it uses none of the request limits below until then. It keeps at most two distinct suggestions from matching works/editions, resizes and strips metadata, and stores the images in the existing private container. The first is selected only if the book still has no cover and nobody has explicitly changed or removed it. Edit book details to choose a suggestion or keep/upload your own cover; save to apply the choice. Alternate suggestions are private to the family. Public links show the selected cover, including a Google Books attribution link when it comes from Google.

The API returns after saving and queuing. A separate Node 22 Azure Functions worker uses **Flex Consumption, 512 MB, zero always-ready instances**, with no Application Insights workspace. Its durable queue keeps working after the browser closes. A single timer consumer processes jobs sequentially, with at least 1.1 seconds between source requests; transient source errors retry at most three times. Timeouts, stale metadata, concurrent selections, removed books and duplicate queue delivery are handled. The edit screen offers a manual retry; ISBN improves matching. Source coverage varies: some books have one or no suitable covers. Only title, authors and ISBN are sent, plus the publisher when the Brave image search below is enabled; photos and notes are never sent for cover search. No LLM is called.

`init` and `publish` provision/update `infra/covers.bicep` and deploy the queue worker as well as the site. `./scripts/deploy.sh covers` updates only that worker. `package` prepares the web/API artifacts; cloud worker deployment copies the same API dependencies plus `worker/main.js` and `worker/host.json`. All worker resources belong to the existing library resource group and are covered by its budget alerts.

The Flex monthly free grant is subscription-wide (250,000 executions and 100,000 GB-seconds); the expected 500-book library is well below this when that allowance is available. Storage/queue operations still incur small usage charges. The default non-model reserve is now $0.60/month. The app's $2.25 monthly estimate cutoff may pause scans before a 500-cover import completes; shelf scanning usually reduces the number of calls. Existing budget alerts remain warnings, not a billing cap. [Azure Functions pricing](https://azure.microsoft.com/en-us/pricing/details/functions/) · [Open Library search API](https://openlibrary.org/dev/docs/api/search) · [Cover API](https://openlibrary.org/dev/docs/api/covers)

Backup format 4 includes the selected cover, up to three alternate covers, source attribution, the kept shelf photos, and each book's reading log, loan and wishlist state; formats 1 to 3 remain accepted. A library running an older release cannot read a format 4 file. Local development uses a persistent SQLite job queue with the same lookup code. Suggested images are served from your own API; visitors do not contact Open Library or Google to view them.

### Google Books fallback

Enable the Books API in your Google Cloud project and create an API key restricted to **Books API**. Keep it server-side on the cover worker and managed API. To validate and set a key without placing it in shell arguments or command history, run:

```sh
./scripts/deploy.sh keys
```

It asks for the Google Books key and then for the Brave key below, and shows nothing while you paste; press Enter alone to leave one as it is. Each key is tried with one request and stored only if that request succeeds. `setup` ends with the same two questions. To store the key from a secret store instead, pipe it to the script that `keys` uses: `printf '%s' "$GOOGLE_KEY" | node scripts/set-google-books-key.mjs`.

No Google billing changes are needed for Books API lookup. The secure `GOOGLE_BOOKS_API_KEY` worker setting is preserved by `publish` and `covers`; `publish` synchronizes it to the managed API for photo review. `node scripts/sync-review-key.mjs` synchronizes an already configured worker key without publishing. The frontend never receives it. The deployment script also accepts this environment variable from a secret store. The key goes only to the Google metadata endpoint, never to image hosts, logs or backups.

For cover lookup, Google is queried only when Open Library supplies fewer than two covers. Each cover lookup uses at most two Google metadata queries and four candidate-image downloads; the library caps Google queries at 900/day and 1,500/month, shared with photo metadata review. Quota or authentication failures stop automatic retries and block further Google queries for one hour. These are application limits, not promises about the project's shared quota. Cover lookup uses no LLM tokens and adds only small usage on the existing worker and storage. It retains the existing Azure budget alerts and cost assumptions. Actual Azure bills can lag usage, so the estimate is not a hard spending cap.

Google results carry the official attribution graphic and a link to the book, including after backup/restore. Only ISBN, title and authors are used for matching. [Google Books API usage](https://developers.google.com/books/docs/v1/using) · [Attribution guidelines](https://developers.google.com/books/branding)

### Brave image search for Romanian editions

Open Library and Google Books hold few Romanian editions: a check of 14 titles from the family's shelves found none of them in Open Library. With a Brave Search API key, a lookup that still has fewer than two covers makes **one** image search for the quoted title with the first author and the publisher. Without a key this step is skipped and nothing else changes.

A result is offered only when all of these hold:

- it is on a bookshop or publisher page from the fixed list in `api/src/brave-covers.js` (Libris, Cărturești, Cartepedia, Elefant, second-hand sellers, Romanian publishers and a few large international shops), over HTTPS;
- the page title contains the book's title. A title of one or two words also needs the author or publisher on the page, or to be the leading part of the page title, so "Ferma" does not match "Ferma animalelor";
- the picture has a plausible cover shape and is at least 150 pixels each way.

The worker contacts two hosts only: `api.search.brave.com` and Brave's image proxy `imgs.search.brave.com`, which serves a 500-pixel copy of each result. It never fetches an address taken from a search result on any other host, and the key is sent to the search endpoint only. At most four pictures are downloaded per lookup, and the same picture from two shops counts once. The edit screen shows the site each suggestion came from, and the family chooses; nothing replaces an existing cover.

Create a key at [Brave Search API](https://brave.com/search/api/), then validate and store it on the worker without placing it in shell arguments or history:

```sh
./scripts/deploy.sh keys
```

Press Enter alone at the Google Books question to keep that key as it is, then paste the Brave key; nothing is shown while you paste. `node scripts/set-brave-search-key.mjs` asks for the Brave key only, and also accepts it piped on standard input. It makes one test search in exactly the shape the worker uses, then sets `BRAVE_SEARCH_API_KEY` on the cover worker. `publish` and `covers` preserve it. For local development, set the same variable before `npm run dev`.

Brave charges $5 per 1,000 searches and includes $5 of credit each month (prices read on 19 November 2026). The library stops at 200 searches a day and 900 a month, which keeps a month inside that credit. An authentication or quota error blocks further searches for one hour and is not retried automatically. This cost is outside the Azure budget alerts and the scan budget. Brave's published terms say storing search results needs a custom plan; this library keeps only the chosen picture and the address of the page it was found on, for private family use.

Books already marked as having no cover are not searched again on their own: open **Edit book details** and choose **Find covers online**.

### Review photo titles and authors

The Romanian and English photo flow is **recognize → review each title/author → confirm and save → fetch covers in the background**, the last step only for books saved without their own cover. Recognition transcribes the photo; a separate authenticated metadata review checks Google Books and, when an exact match is unavailable, Open Library. Up to three candidates are shown with source links. Even an exact match needs an explicit choice. Uncertain matches are suggestions; if neither catalog has a reliable answer, the family can correct the text and repeat the review or explicitly confirm it against the photo. An unknown author can remain blank. Changing reviewed fields clears their confirmation. Duplicate checks use the accepted details.

Reviews fetch metadata only, never images. Each uncached title uses at most one Google query and one Open Library query, with an eight-second timeout per source. Reviews run sequentially with a library-wide lease and request spacing; there are limits of 30 requests per user per minute and 600 per library per day. Results are cached for seven days (one minute for unavailable sources), and the immutable review receipt keeps a lost-response save retry safe. The save API rejects photo rows without a receipt confirming their exact title, authors, ISBN, publisher and publication date. Only the subsequent save can queue cover fetching. An uploaded single-book cover remains selected; a shelf photo never becomes a public cover. Once a shelf scan succeeds, the copy of the photo used for text detection (at most 2,048 pixels on its long edge, with no camera metadata) is stored in the private `covers` container as `shelf-<scan id>.jpg` and served only to signed-in family members. Each photo is roughly half a megabyte, so storage cost stays negligible; the parent can delete photos in Family settings.

The review uses the existing API and storage, adds no Azure resources or LLM calls, and shares the Google request limits above. Catalog providers receive book metadata, not the photo or private notes. Google metadata selected during review keeps its source attribution on the book and in backups. Existing Azure alerts and recognition spending limits remain in effect.
