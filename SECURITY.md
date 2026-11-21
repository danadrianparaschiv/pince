# Security in Pince

## Reporting a problem

If you find a security problem in this code, please do not open a public issue. Use the repository's **Security** tab and choose **Report a vulnerability**, which opens a private report to the maintainer. Say what you found, how to reproduce it, and what it would let someone do.

This is a personal project maintained in spare time. Reports are read, but there is no guaranteed response time.

A report about someone's own deployment (their site, their accounts) should go to whoever runs that deployment, not here.

## Secrets and private data

Nothing secret or private belongs in this repository, in any file or in its history:

- keys, passwords, tokens and connection strings;
- the address of a deployed library and the names of its Azure resources;
- names, email addresses and paths on someone's computer;
- family data: backups, catalogues, shelf photos, and photos that still carry location data.

Settings are read at run time from the environment or from Azure, and local data stays in the git-ignored `.library/` folder. [Configuration](docs/CONFIGURATION.md) describes where each value is kept and how the helper scripts handle keys without writing them down.

If a secret is ever committed, removing the file is not enough, because it stays in the history. Revoke or rotate it at the service that issued it first, then clean the history.

## How the library protects its data

- **Two accounts, no sign-up.** Passwords are hashed with scrypt. Sign-in attempts are limited per network and slow down per account. A browser that has signed in before has an allowance of its own, so wrong passwords sent from elsewhere cannot keep it out; a browser that has never signed in can be held up while that is going on.
- **Sessions** use an `HttpOnly`, `SameSite=Lax` cookie, `Secure` when deployed or opened at an HTTPS address. A session ends after a week. The browser keeps the cookie for 180 days, only so that sign-in can recognise it; signing out removes it. The server keeps only a hash of the session token, and a password change ends that account's sessions and forgets its browsers. Setting a new password, for either account, needs the parent's own current password.
- **Public links** show a book's title, author and chosen cover. Notes, reading status, loans, other covers and shelf photos need a session.
- **The wishlist link** is off until the parent switches it on. It carries a random token, shows the same three details of each wished-for book, and stops working when it is switched off or replaced. Each listed book also has its own public address, like every book, and that address keeps working for someone who opened it while the list was shared.
- **Requests that change data** are accepted only from the library's own origin, are size-limited, and are throttled per account. The catalogue holds at most 5,000 books and 500 kept shelf photos.
- **Uploaded images** are decoded and re-encoded on the server, which drops embedded metadata, and are never served as anything but JPEG.
- **Outside services** are called on fixed HTTPS hosts only. An address found in a search result or typed by a user is never fetched. Text read from a photo is treated as data, never as instructions to the model.
- **The cover worker** has no access to the catalogue. It reports through the API with a separate random token for each job.
- **Spending** on photo recognition is reserved before each call and capped per month and per year.
- **Logs** do not contain request bodies, credentials or photos.
- **On your own computer** the database, the pictures and a backup written from the command line are readable by your user account only.
- **A library on your own computer that other devices reach** listens beyond that computer only when told to. Told the HTTPS address it is opened at, it accepts changes only from pages at that address and keeps its session cookie to HTTPS. Its pages carry the same browser policy as the deployed site. It takes a caller's address from a proxy only for the number of proxies you declare, and otherwise from the connection itself.
- **Setting up a library on your own computer** from the browser needs the one-time link printed in the terminal, which stops working when set-up is finished. Keys added there or in Family settings are kept in the git-ignored `.library/` folder, readable by you only, and are never sent back to the browser. The deployed site has no set-up screen and accepts no keys from the browser.

[Architecture](docs/ARCHITECTURE.md#security-design) has the details, and `test/security.test.js` exercises most of these rules.

## What is out of scope

The library is designed for one family and a few readers of public links. It has no defence against a signed-in family member misusing their own account, and it relies on Azure for transport security, storage encryption and network-level protection.
