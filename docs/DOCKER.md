# Running Pince in a container

The container image holds the same library that [runs on your own computer](LOCAL.md): one program, with the catalogue, the pictures and the saved settings in one folder. It suits a home server or a NAS that is always on.

No image is published yet. You build it from a copy of the repository, which needs [Docker](https://docs.docker.com/get-docker/) and nothing else.

## Build and start

In the project folder:

```sh
docker build -t pince .
```

```sh
docker run -d --name pince -p 127.0.0.1:46173:46173 -v pince-data:/data pince
```

```sh
docker logs pince
```

The last command shows the library's address and the one-time **set-up link**. Open the link in a browser on the same computer to choose the two passwords and add the keys of the optional services, as described in [Set up in the browser](LOCAL.md#set-up-in-the-browser). The link is printed again at every start until set-up is finished.

Started this way, the library answers on that computer only, at <http://127.0.0.1:46173>.

## On a home server, with HTTPS

Other devices should reach the library through a proxy that adds HTTPS. Without it, passwords and service keys cross the network unprotected, and browsers switch off features that adding books relies on.

The `docker` folder has an example that runs the library behind [Caddy](https://caddyserver.com/). In that folder:

```sh
PINCE_HOST=books.example.org docker compose up -d --build
```

```sh
docker compose logs pince
```

`PINCE_HOST` is the name people type to open the library. It has to lead to that computer, and ports 80 and 443 have to be free. The example:

- tells the library its public address and that one proxy stands in front, so that it accepts changes only from pages at that address, keeps its session cookie to HTTPS, and prints the set-up link with that address;
- publishes no port for the library itself, so only Caddy can reach it;
- keeps the library's data and Caddy's certificates in volumes.

Where the certificate comes from depends on the name:

- **A public name** that points at your server: Caddy gets a certificate and renews it by itself.
- **A name that exists only on your home network**: add the line `tls internal` to the `Caddyfile`, as its comment explains. Caddy then signs the certificate itself, and each phone and computer has to be told once to trust Caddy's root certificate.

## Settings

Every [setting of a local library](CONFIGURATION.md#running-on-your-computer) works in a container. Pass one with `-e NAME=value`, or under `environment:` in a Compose file. The service keys are easiest to add in the set-up screen or under **Family settings → Services**; they are then saved in the data volume, and nothing has to be passed in.

The image sets three of them itself:

| Setting | Value in the image | Why |
| --- | --- | --- |
| `LIBRARY_HOST` | `0.0.0.0` | A container has to listen beyond itself. Which devices can connect is decided by how you publish the port |
| `LIBRARY_LOCAL_DIR` | `/data` | The folder to keep in a volume |
| `PORT` | `46173` | The port inside the container |

To open the set-up screen again, for example to choose both passwords anew, start the container once with `-e LIBRARY_SETUP=1` and read the new link from its log.

## Your data

Everything is in the volume mounted at `/data`: the catalogue, covers and shelf photos, and the service keys saved from the app. Treat a copy of the volume like a backup file that also holds those keys.

Keep `/data` on a disk of the server itself, not on a network share: the catalogue is an SQLite database.

To back up, use **Family settings → Download backup** in the app, or write the same file from the command line and copy it out:

```sh
docker exec pince node scripts/local-backup.mjs backup /data/backup.ndjson
```

```sh
docker cp pince:/data/backup.ndjson .
```

An existing file is never overwritten, so remove or rename the one in the volume before the next backup. [Backing up](LOCAL.md#backing-up) describes what the file holds and how to restore it.

## Upgrading

Get the new version of the repository, build the image again, and replace the container. The volume, and with it your library, is left alone:

```sh
docker build -t pince .
```

```sh
docker rm -f pince
```

Then start it with the same `docker run` command as before. With the Compose example, `docker compose up -d --build` does all three steps.

## Checking and stopping

`docker ps` shows the container as **healthy** once the library answers. For the full health check:

```sh
docker exec pince node scripts/doctor.mjs
```

It notes that the port is in use, which inside a running container is the library itself.

`docker stop pince` lets requests in progress finish and closes the database before the container ends.

## Limits

- **Not published.** There is no image to pull yet, and no promise about one; see [What is supported](SUPPORT.md).
- **What is tried.** Every change builds the image on Linux (x86-64), starts a container and uses it: set-up with the one-time link, sign-in, saving a book, running as behind an HTTPS proxy, and a clean stop. The image was also built and used by hand on ARM64. The Compose example was tried once with Caddy on a developer's computer, not on a home server.
- **One container per data volume.** Do not start two on the same volume.
- **Plain HTTP from another device** is enough to browse, but adding books needs HTTPS.
