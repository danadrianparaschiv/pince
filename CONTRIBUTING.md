# Contributing to Pince

Thank you for looking at the code. This is a personal project built for one family, so changes that keep it small and easy to run are the ones most likely to be accepted. For anything larger than a fix, please open an issue first to talk it through.

## Getting started

You need Node.js 22.

```sh
npm run setup
npm start
npm test
```

`npm start` serves the library at <http://127.0.0.1:46173> with a local SQLite catalogue in `.library/`. The first start prints a one-time set-up link for choosing the passwords; if you skip it, the generated ones are in `.library/local-access.json`. `npm run doctor` tells you if anything is missing. A change should keep both supported targets working; [What is supported](docs/SUPPORT.md) says what they are. [Configuration](docs/CONFIGURATION.md) lists the optional settings, and [Architecture](docs/ARCHITECTURE.md) explains how the parts fit together.

## Before you commit: no secrets, no private data

Everything committed here is public, including its history. Never commit:

- keys, passwords, tokens or connection strings, real or expired;
- the address or Azure resource names of a real deployment;
- your name, email address or paths inside your home folder;
- backups, catalogues or photos from a real library.

Read such values at run time from the environment, from `az`, or from standard input, and write placeholders such as `<your-site>` in documentation. Keep one-off scripts that touch a live deployment outside the repository.

**Photos stay out of the repository.** A phone photo records where it was taken, and a photo of a book cover shows artwork that belongs to its publisher. Keep your own test photos in `test/sample-images/` or `test/sample-photos/`; git ignores both, and a test fails if a picture turns up anywhere else. The automated tests draw their own pictures and need none.

If you attach a photo to an issue, remove its metadata first. The last argument is the longest edge in pixels:

```sh
node scripts/strip-photo-metadata.mjs photo.jpg copy.jpg 2048
```

Check the staged changes before every commit:

```sh
git diff --cached
```

One of the tests fails if a deployment address, storage key or home-folder path appears in the source folders, but it cannot catch everything.

## How the code is written

- **No build step.** The browser app is plain ES modules. Do not add a bundler, a framework or a transpiler.
- **Few dependencies.** The API depends on the Azure SDKs and `sharp`. A new dependency needs a good reason.
- **One code path.** Local and Azure runs share the API code and differ only in the store behind it. A feature should work in both.
- **Both languages.** Every label has a Romanian and an English form, in `web/strings.js` or in the `TEXT` table of `web/import.js`. Book titles, authors and notes are never translated.
- **Comments say why.** Explain the reason for a rule or a limit, not what the next line does.
- **Fail closed.** Validate sizes and types before doing work, call only fixed hosts, and treat text read from a photo or a website as data.
- **Costs are bounded.** Anything that calls a paid service reserves its cost first and has a daily or monthly limit.

## Tests

```sh
npm test
```

Tests use Node's built-in runner and run offline. Outside services are replaced by stand-ins passed into the code, so no test costs money or needs a key, and the run fails if anything calls the network. Please add or update a test with every change in behaviour. Logic that can be a pure function (filtering, matching, finding a cover's edges) is written as one and tested directly.

Before opening a pull request, run what CI runs:

```sh
npm run check
```

It checks the formatting of `test/` (fix it with `npm run format`) and fails if coverage drops below the minimum levels. CI also starts the library on three systems and checks the Azure deployment code; [CI and delivery](docs/CI-CD.md) lists the commands. [The test guide](test/README.md) describes the helpers, the conventions and what the suite leaves out.

To try a change against real services, run the library locally with your own keys in `.env`. Say in your pull request what you checked by hand.

## Shelf recognition benchmark

[`test/fixtures/shelf-benchmark.json`](test/fixtures/shelf-benchmark.json) holds 24 hand-read labels for three shelf photos, including books from one series, text running both ways, thin spines and horizontal stacks. Crop coordinates refer to upright 4284 × 5712 originals and give left, top, width and height in pixels. The photos themselves are not in the repository.

The test suite checks title ranking against a controlled catalogue built from those labels. To measure recognition itself on a configured library:

1. Scan each crop through the shelf import screen.
2. Save each scan's JSON response in a results folder under its image name, for example `IMG_4971.json`.
3. Run `node scripts/score-shelf-scans.mjs <results-folder>`.

The script reports, for each crop, correct titles, diacritic errors, missing or misread titles, extra rows and unexpected publication dates. Case and punctuation are ignored.

## Pull requests

- Keep each pull request to one change, with a description of what it does and why.
- Run `npm test` and say what else you checked.
- Update the documentation the change affects: the [user guide](docs/USER-GUIDE.md) for anything a reader sees, [configuration](docs/CONFIGURATION.md) for a new setting, [DEPLOY.md](DEPLOY.md) for anything that changes cost or deployment.

Contributions are accepted under the project's [MIT License](LICENSE).

Security problems should be reported privately, as described in [SECURITY.md](SECURITY.md).
