# What is supported

Pince runs in three ways, and those three are the ones this project is tested on, documented for, and fixed when they break.

| | On your own computer | In a container | On Azure |
| --- | --- | --- | --- |
| Guide | [Running locally](LOCAL.md) | [Running in a container](DOCKER.md) | [Deployment and costs](../DEPLOY.md) |
| What you need | Node.js 22 | Docker | An Azure subscription, Node.js 22, Azure CLI with Bicep, Static Web Apps CLI 2.1.0 or newer, Bash |
| Systems | macOS and Linux. Windows is tested in CI but not yet relied on | Linux containers on x86-64 and ARM64 | Deploying from macOS, Linux or WSL |
| Who can use it | One person at that computer | One person at that computer, or the family on your network through a proxy with HTTPS | The family, from any phone or computer; friends through public book links |
| Checked by | Tests, and a start-up check on every change | The same tests, and the same start-up check against a container on both kinds of computer, on every change and before an image is published | The same tests, plus a build of the templates and the package on every change, and the script's own checks after each deployment |
| Setting it up | The set-up link printed on the first start | The same set-up link, read from the container's log | `./scripts/deploy.sh setup`, which asks each question in the terminal |
| Health check | `npm run doctor` | `docker ps`, and `node scripts/doctor.mjs` inside the container | `./scripts/deploy.sh doctor` and `./scripts/deploy.sh status` |
| Backup | `npm run backup`, or **Family settings** in the app | **Family settings** in the app, or the backup command inside the container | **Family settings** in the app |
| Removing it | Delete the folder | Remove the container and its volume | `./scripts/deploy.sh destroy` |

All three run the same code and keep the same data. The container is the local library in a package; only Azure has different storage behind it. A backup made in one restores into any other.

The Azure path is rehearsed from a clean copy of the repository: `doctor`, `init`, `status`, `publish` and `destroy`, in a resource group of its own. It was last rehearsed on 20 November 2026 on macOS, without photo recognition and with `--with-vision`, in a second subscription. The run with photo recognition started from the zip that GitHub serves for the repository. A real photo of several front covers was read and its covers cut out, both before and after a `publish` that carried a change. That `publish` left every setting as it was, including the service keys on the cover worker, and a book added afterwards got its cover from the worker. The library was then removed and nothing was left behind.

The guided `setup` and `keys` commands were added after these rehearsals. Their questions, and what they hand to Azure, are covered by tests against a stand-in for the Azure CLI; they have not yet been rehearsed against Azure itself. `setup` ends in the same steps as `init`.

The same day it was rehearsed on Linux: Ubuntu 24.04 on x86-64, in a container that started with only Node.js, the Azure CLI and `zip`. There `doctor` named what was missing, `init --with-vision` created the library, a photo was read, a book got its cover, and `destroy` removed everything.

On 21 November 2026 the rest was rehearsed in the same kind of container. The two scripts that store a service key were run with stand-in keys, piped in and typed at the hidden prompt. A `publish` that carried a change then replaced the release and left every setting as it was, including those keys, and a photo was read and a book got its cover afterwards. The package built on Linux has the same release identifier as the one built on macOS from the same commit.

The deploy script has not yet been rehearsed on WSL, nor in a subscription that has never used these Azure services.

## How they differ

- **Reach.** A local library listens on that computer only, over plain HTTP, unless you put a proxy with HTTPS in front and tell the library so. Otherwise phones on the home network cannot open it, and public book links work only on that computer. For a library the family uses from several devices without running a server at home, deploy to Azure.
- **Cover lookups.** Locally they run inside the same program while it is open. On Azure a small separate worker runs them, including after the browser is closed.
- **Shelf photos** are kept beside the catalogue in both, and are part of a backup in both.
- **Costs.** Local running costs nothing by itself. Photo recognition and cover searches use your own keys in both places, with the same spending limits.

## What is not supported

- Other clouds or hosting services.
- A container on a real home server. The image and the Compose example are tried on every change and were used behind Caddy on a developer's computer, but not on a NAS, with a public name, or over months of upgrades.
- Reaching a local library from other devices. [The settings for it](LOCAL.md#reaching-it-from-other-devices) are covered by the tests, with a stand-in for the proxy, but no real proxy or home-server set-up is rehearsed here.
- More than one family, or more than the two accounts, in one library.
- Node.js versions other than 22.

These are not refused on principle. They are simply untested, and a change may break them without notice.

## Versions

Releases are numbered and listed on the repository's **Releases** page. Only the latest release is supported. A release note says so when an upgrade needs a step beyond the usual one: `npm run setup` locally, pulling the image again for a container, `./scripts/deploy.sh publish` on Azure.

## Getting help

This is a personal project maintained in spare time, so help is best-effort and there is no promised response time.

- **A problem or a question:** open an issue and choose the form that fits. Run the health check for your target first and include its output; it never prints a key or a password.
- **A security problem:** report it privately, as described in [SECURITY.md](../SECURITY.md).
- **Never post** keys, passwords, a backup file, or the address of your library in an issue.
