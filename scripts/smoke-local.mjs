// Starts the local library the way `npm start` does, on a free port and in a throwaway folder,
// and checks that it answers: the page, sign-in, saving a book, its public address, and setting
// the library up in the browser with the one-time link. It then starts the same library again as
// it would run behind an HTTPS proxy, and checks that it stops cleanly when asked.
// Used by CI on every supported system, and handy after an upgrade: npm run smoke
//
// With SMOKE_IMAGE set to the name of a container image, the same checks run against a container
// of that image instead, with its data in a throwaway volume: SMOKE_IMAGE=pince npm run smoke
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const image = process.env.SMOKE_IMAGE;
const pause = (milliseconds) => new Promise((next) => setTimeout(next, milliseconds));
const cleanups = [];

/** What both ways of running share: the printed lines, and waiting for one of them. */
function printed() {
  const library = { output: '' };
  library.read = (chunk) => { library.output += chunk; };
  /** Waits for a line the library prints, and gives the match. */
  library.shows = async (pattern, problem, seconds = 5) => {
    for (let tries = 0; tries < seconds * 50 && !pattern.test(library.output); tries++) await pause(20);
    return pattern.exec(library.output) ?? assert.fail(problem + '\n' + library.output);
  };
  return library;
}

/** Starts the library as a program on this computer, with these settings. */
async function startProgram(data, settings) {
  const server = spawn(process.execPath, [fileURLToPath(new URL('./dev.js', import.meta.url))], {
    // Port 0 asks the system for any free port.
    env: { ...process.env, PORT: '0', LIBRARY_LOCAL_DIR: data, ...settings },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const library = printed();
  let stopped = false;
  const exited = new Promise((resolve) => server.once('exit', (code) => { stopped = true; resolve(code); }));
  cleanups.push(() => stopped || new Promise((resolve) => { server.once('exit', resolve); server.kill(); }));
  server.stdout.on('data', library.read);
  server.stderr.on('data', library.read);
  exited.then((code) => library.read('\nThe server stopped with code ' + code + '.'));
  // Behind a proxy the first line names the public address, and the next one the port.
  const [, listens] = await library.shows(/(?:Library: http:\/\/|It listens on )(127\.0\.0\.1:\d+)/, 'The server did not start within 30 seconds.', 30);
  library.address = 'http://' + listens;
  library.file = (name) => readFile(join(data, name), 'utf8');
  /** Asks the library to stop, as Ctrl+C does, and gives its exit code. */
  library.stop = () => { server.kill(); return exited; };
  return library;
}

/** Starts the library as a container of the image, with these settings and its data in `volume`. */
async function startContainer(volume, settings) {
  const docker = async (...args) => (await promisify(execFile)('docker', args)).stdout.trim();
  const name = 'pince-smoke-' + randomUUID().slice(0, 8);
  // The port is published on this computer only, on any free port.
  await docker('run', '-d', '--name', name, '-p', '127.0.0.1::46173', '-v', volume + ':/data',
    ...Object.entries(settings).flatMap(([key, value]) => ['-e', key + '=' + value]), image);
  cleanups.push(() => docker('rm', '-f', name).catch(() => {}));
  const library = printed();
  const logs = spawn('docker', ['logs', '-f', name], { stdio: ['ignore', 'pipe', 'pipe'] });
  logs.stdout.on('data', library.read);
  logs.stderr.on('data', library.read);
  await library.shows(/^Library: /m, 'The container did not start within 30 seconds.', 30);
  library.address = 'http://' + (await docker('port', name, '46173/tcp')).split('\n')[0];
  // The image's own health check must come to the same conclusion as these checks.
  let health;
  for (let tries = 0; tries < 150 && health !== 'healthy'; tries++) {
    health = await docker('inspect', '-f', '{{.State.Health.Status}}', name);
    if (health !== 'healthy') await pause(200);
  }
  assert.equal(health, 'healthy', 'The container did not report itself healthy within 30 seconds.');
  assert.notEqual(await docker('exec', name, 'id', '-u'), '0', 'The library runs as root in the container.');
  library.file = (file) => docker('exec', name, 'cat', '/data/' + file);
  /** Asks the container to stop, as `docker stop` does, and gives the library's exit code. */
  library.stop = async () => {
    await docker('stop', name);
    return Number(await docker('inspect', '-f', '{{.State.ExitCode}}', name));
  };
  return library;
}

let start;
if (image) {
  const volume = 'pince-smoke-' + randomUUID().slice(0, 8);
  cleanups.push(() => promisify(execFile)('docker', ['volume', 'rm', '-f', volume]).catch(() => {}));
  start = (settings = {}) => startContainer(volume, settings);
} else {
  const data = await mkdtemp(join(tmpdir(), 'pince-smoke-'));
  cleanups.push(() => rm(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  start = (settings = {}) => startProgram(data, settings);
}

let failed = false;
try {
  const library = await start();
  const origin = library.address;
  const json = { 'Content-Type': 'application/json' };
  const page = await fetch(origin + '/');
  assert.equal(page.status, 200);
  // Pages carry the same browser policy as the deployed site.
  assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  assert.match(await page.text(), /<title>Pince<\/title>/);
  assert.deepEqual(await (await fetch(origin + '/api/me')).json(), { user: null });
  assert.equal((await fetch(origin + '/api/books')).status, 401);

  const { parent } = JSON.parse(await library.file('local-access.json'));
  const login = await fetch(origin + '/api/login', { method: 'POST', headers: json, body: JSON.stringify(parent) });
  assert.equal(login.status, 200);
  // Served over plain HTTP on this computer, the session cookie carries no `Secure` flag.
  assert.doesNotMatch(login.headers.get('set-cookie'), /Secure/);
  const Cookie = login.headers.get('set-cookie').split(';')[0];

  const id = randomUUID();
  const saved = await fetch(origin + '/api/books', {
    method: 'POST', headers: { ...json, Cookie }, body: JSON.stringify({ books: [{ id, title: 'Amintiri din copilărie', authors: 'Ion Creangă' }] }),
  });
  assert.equal(saved.status, 201);
  const { books } = await (await fetch(origin + '/api/books', { headers: { Cookie } })).json();
  assert.deepEqual(books.map((book) => book.title), ['Amintiri din copilărie']);
  // Anyone may read the public page of that one book, and only its public details.
  assert.deepEqual(await (await fetch(origin + '/api/public/' + id)).json(),
    { book: { id, title: 'Amintiri din copilărie', authors: 'Ion Creangă', cover: null } });

  // A new library waits to be set up. The one-time link from the terminal chooses the passwords,
  // which ends the earlier session and the generated passwords, and then stops working.
  assert.deepEqual(await (await fetch(origin + '/api/setup')).json(), { pending: true });
  const [, token] = await library.shows(/\/setup#([\w-]+)/, 'The set-up link was not printed.');
  const setup = (path, body) => fetch(origin + '/api/setup/' + path, {
    method: body ? 'POST' : 'GET', headers: { ...json, 'X-Setup-Token': token }, body: body && JSON.stringify(body),
  });
  assert.equal((await fetch(origin + '/api/setup/state')).status, 401);
  assert.equal((await fetch(origin + '/setup')).status, 200);
  const chosen = { parent: { username: 'ana', password: randomUUID() }, child: { username: 'copil', password: randomUUID() } };
  assert.equal((await setup('accounts', chosen)).status, 200);
  assert.deepEqual(await (await setup('finish', {})).json(), { username: 'ana' });
  assert.equal((await setup('state')).status, 404);
  assert.equal((await fetch(origin + '/api/books', { headers: { Cookie } })).status, 401);
  const again = await fetch(origin + '/api/login', { method: 'POST', headers: json, body: JSON.stringify(chosen.parent) });
  assert.equal(again.status, 200);
  const kept = await (await fetch(origin + '/api/books', { headers: { Cookie: again.headers.get('set-cookie').split(';')[0] } })).json();
  assert.deepEqual(kept.books.map((book) => book.title), ['Amintiri din copilărie']);
  assert(!(await library.file('local-access.json')).includes(chosen.parent.password));

  // Asked to stop, it closes the database and leaves without an error. Windows ends a program
  // outright, so there is no exit code to check there.
  const code = await library.stop();
  if (image || process.platform !== 'win32') assert.equal(code, 0, 'The server did not stop cleanly.');

  // The same library as a home server runs it: behind a proxy that adds HTTPS, with set-up opened
  // again by a setting. Browsers open the public address; the proxy calls the port.
  const site = 'https://books.example.org';
  const proxied = await start({ PUBLIC_APP_ORIGIN: site + '/', LIBRARY_TRUSTED_PROXIES: '1', LIBRARY_SETUP: '1' });
  assert.match(proxied.output, /^Library: https:\/\/books\.example\.org$/m);
  await proxied.shows(/https:\/\/books\.example\.org\/setup#[\w-]+/, 'The set-up link does not use the public address.');
  const through = (headers) => ({ ...json, 'X-Forwarded-For': '203.0.113.7', ...headers });
  const secure = await fetch(proxied.address + '/api/login', {
    method: 'POST', headers: through({ Origin: site }), body: JSON.stringify(chosen.parent),
  });
  assert.equal(secure.status, 200);
  assert.match(secure.headers.get('set-cookie'), /; Secure$/);
  // A page from any other address, the port's own included, cannot change anything.
  const foreign = await fetch(proxied.address + '/api/login', {
    method: 'POST', headers: through({ Origin: proxied.address }), body: JSON.stringify(chosen.parent),
  });
  assert.equal(foreign.status, 403);
  // What was saved before the stop is still there.
  const after = await (await fetch(proxied.address + '/api/books', { headers: { Cookie: secure.headers.get('set-cookie').split(';')[0] } })).json();
  assert.deepEqual(after.books.map((book) => book.title), ['Amintiri din copilărie']);
  console.log('The ' + (image ? 'container' : 'local library') + ' started, answered correctly and stopped cleanly.');
} catch (error) {
  failed = true;
  console.error(error.message);
} finally {
  // Stop what still runs, then remove the data: the last thing started is cleaned up first.
  for (const cleanup of cleanups.reverse()) await cleanup();
}
process.exit(failed ? 1 : 0);
