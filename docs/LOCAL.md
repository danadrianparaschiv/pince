# Running Pince on your own computer

A local library needs no account anywhere. It is the quickest way to try Pince, and enough for one person cataloguing at one computer. For a library the family opens from phones, see [Deployment and costs](../DEPLOY.md).

## Install and start

You need [Node.js 22](https://nodejs.org/). Then, in the project folder:

```sh
npm run setup
```

```sh
npm start
```

The first start prints the library's address and a one-time **set-up link**. Open the link in a browser on the same computer.

## Set up in the browser

The set-up screen has four short steps, and every one can be skipped:

1. **Accounts.** Choose the names and passwords of the two accounts, parent and child. The passwords are stored only as hashes, so keep them in a password manager.
2. **Photos.** Add the address, model name and key of your Azure OpenAI resource for photo recognition, and of your Azure AI Vision resource for text detection.
3. **Covers.** Add a Google Books key and a Brave Search key for more cover sources.
4. **Ready.** Open the library and sign in.

Each key is tried with one small request before it is saved, and a key that the service refuses is not saved. Nothing needs a restart. After set-up, the parent can add, replace or remove the same keys under **Family settings → Services**.

The link works once, while the library is running, and stops working when you finish. To open the set-up screen again later, for example to choose both passwords anew:

```sh
npm start -- --setup
```

Where the start command cannot be changed, as for a service or a container, set `LIBRARY_SETUP=1` for one start instead.

If you skip the link altogether, open <http://127.0.0.1:46173> and sign in as **parinte** (parent) or **copil** (child) with the generated passwords in `.library/local-access.json`. The link is shown at every start until set-up is finished.

If something does not work, ask the health check:

```sh
npm run doctor
```

It reports the Node version, the installed parts, the data folder, the port, and which optional services are set up. It shows names and states only, never a key or a password.

## Where your library is kept

Everything is in the `.library/` folder inside the project: the catalogue (`library.sqlite`), covers and shelf photos (`covers/`), the generated passwords, and the service keys saved from the app (`settings.json`, readable by you only). Git ignores the folder, and nothing in it leaves your computer by itself.

To keep the data somewhere else, set `LIBRARY_LOCAL_DIR` to a folder of your choice.

## Settings

Everything is optional. The service keys are easiest to add in the set-up screen or in **Family settings → Services**. Any setting can also go in a file: copy `.env.example` to `.env`, remove the `# ` in front of the line and give it a value. `npm start` reads `.env` by itself; a value set in your shell takes precedence, and a line left empty sets nothing. A service set in the shell or in `.env` wins over one saved from the app, and the app then shows it as set there and does not change it.

[Configuration](CONFIGURATION.md) describes each setting. The ones most people add:

- **Photo recognition** (`AZURE_OPENAI_*`): lets you add books from photos. Without it you type titles and upload covers.
- **Text detection** (`AZURE_VISION_*`): places the title and cover cut-outs in scanned photos.
- **Cover searches** (`GOOGLE_BOOKS_API_KEY`, `BRAVE_SEARCH_API_KEY`): more sources for covers. Open Library is used without any key.

`.env` holds your keys, so it is ignored by git. Never put a real value in `.env.example`.

## Backing up

```sh
npm run backup
```

This writes `pince-backup-<date>.ndjson` in the current folder, readable by you only: every book with its covers, notes, reading log, loans and favourites, the wishlist, and the kept shelf photos. To choose the file: `npm run backup -- ~/Documents/books.ndjson`. An existing file is never overwritten.

```sh
npm run restore -- pince-backup-2026-11-20.ndjson
```

Restoring adds the books and shelf photos in the file. A book or photo that is already in the library is left as it is, so restoring twice is harmless.

The file is the same one **Family settings → Download backup** produces in the app. Either can restore the other, which is also how you move a library to Azure: back up here, then restore the file in the deployed app's Family settings.

Shelf photos are part of the file, so a restored book still shows where it stands on its shelf. A backup made before this was added holds no photos; it still restores, without those links.

## Upgrading

Download the new release, or pull the new tag, and install again:

```sh
npm run setup
```

Then start as usual. Your `.library/` folder is left alone. Back up first if the release notes mention a change to the data.

## Reaching it from other devices

Left alone, the library answers only on the computer it runs on. On a home server it can answer the family's phones and laptops too, through a proxy that adds HTTPS. The proxy is needed for two reasons: without HTTPS, passwords and service keys cross the network unprotected, and browsers switch off features that adding books relies on.

1. Run a proxy, such as Caddy or nginx, that holds the certificate and passes requests on to the library's port. It has to add the caller's address to the `X-Forwarded-For` header.
2. Tell the library the address people open, and that one proxy stands in front:

```sh
PUBLIC_APP_ORIGIN=https://books.example.org LIBRARY_TRUSTED_PROXIES=1 npm start
```

With these two settings the library:

- accepts changes only from pages at that address;
- keeps its session cookie to HTTPS;
- prints the set-up link with that address;
- counts sign-in attempts by the address the proxy reports, not by the proxy's own.

If the proxy runs on another computer, the library also has to listen beyond its own computer: add `LIBRARY_HOST=0.0.0.0`. The [container image](DOCKER.md) sets this by itself, and comes with an example that runs the library behind such a proxy. Do this only where the port can be reached by the proxy alone, or on a network you trust.

`npm run doctor` shows how the library will listen, and says so when other devices can reach it without HTTPS. Stopping the library, with Ctrl+C or a stop signal, lets requests in progress finish and closes the database first.

## Limits of a local library

- **This computer only, unless you set it up otherwise.** It listens on `127.0.0.1` over plain HTTP, so other devices cannot open it and the public link of a book works only here. [Reaching it from other devices](#reaching-it-from-other-devices) has the settings for a home server.
- **Only while it runs.** Cover lookups happen while `npm start` is running and continue the next time you start it.
- **One program at a time.** Start one copy per data folder.

## When something goes wrong

| What you see | What to do |
| --- | --- |
| "Pince needs Node.js 22" | Install Node 22. With a version manager, the `.nvmrc` file selects it: `nvm use` |
| "Dependencies … Not installed" | Run `npm run setup` again; it installs the image library for this computer |
| The port is in use | Another copy is running, or another program has the port. Start with `PORT=46200 npm start` |
| Forgotten password | The parent can set a new password for the child in Family settings. To choose both again, start with `npm start -- --setup` and open the link it prints. Generated passwords that were never replaced are in `.library/local-access.json` |
| Behind a proxy, signing in or saving is refused | `PUBLIC_APP_ORIGIN` must be exactly the address in the browser's address bar, without anything after the host |
| The set-up link no longer works | It works once, while the library is running. Start again with `npm start -- --setup` for a new one |
| "ExperimentalWarning: SQLite" at start | Harmless. Node 22 labels its built-in database that way |
| Photo recognition cannot be switched on | Add its three settings under **Family settings → Services**. `npm run doctor` shows whether they are all present and the endpoint is valid |

If the health check passes and the problem remains, see [What is supported](SUPPORT.md#getting-help).
