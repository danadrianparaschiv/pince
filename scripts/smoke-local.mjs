// Starts the local library the way `npm start` does, on a free port and in a throwaway folder,
// and checks that it answers: the page, sign-in, saving a book, its public address, and setting
// the library up in the browser with the one-time link.
// Used by CI on every supported system, and handy after an upgrade: npm run smoke
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const data = await mkdtemp(join(tmpdir(), 'pince-smoke-'));
const server = spawn(process.execPath, [fileURLToPath(new URL('./dev.js', import.meta.url))], {
  // Port 0 asks the system for any free port.
  env: { ...process.env, PORT: '0', LIBRARY_LOCAL_DIR: data },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
const started = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('The server did not start within 30 seconds.\n' + output)), 30_000);
  const read = (chunk) => {
    output += chunk;
    const address = /Library: (http:\/\/127\.0\.0\.1:\d+)/.exec(output);
    if (address) { clearTimeout(timer); resolve(address[1]); }
  };
  server.stdout.on('data', read);
  server.stderr.on('data', read);
  server.on('exit', (code) => reject(new Error('The server stopped early with code ' + code + '.\n' + output)));
});

let failed = false;
try {
  const origin = await started;
  const json = { 'Content-Type': 'application/json' };
  const page = await fetch(origin + '/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<title>Pince<\/title>/);
  assert.deepEqual(await (await fetch(origin + '/api/me')).json(), { user: null });
  assert.equal((await fetch(origin + '/api/books')).status, 401);

  const { parent } = JSON.parse(await readFile(join(data, 'local-access.json'), 'utf8'));
  const login = await fetch(origin + '/api/login', { method: 'POST', headers: json, body: JSON.stringify(parent) });
  assert.equal(login.status, 200);
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
  const token = /\/setup#([\w-]+)/.exec(output)?.[1];
  assert(token, 'The set-up link was not printed.');
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
  assert(!(await readFile(join(data, 'local-access.json'), 'utf8')).includes(chosen.parent.password));
  console.log('The local library started and answered correctly.');
} catch (error) {
  failed = true;
  console.error(error.message);
} finally {
  server.removeAllListeners('exit');
  const stopped = new Promise((resolve) => server.once('exit', resolve));
  server.kill();
  await stopped;
  await rm(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
process.exit(failed ? 1 : 0);
