import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { makeApp } from '../api/src/app.js';
import { report } from '../scripts/doctor.mjs';
import {
  callerAddress,
  networkNotes,
  networkSettings,
  pageHeaders,
  reachable,
  shownAddress,
  stopOnSignal,
} from '../scripts/local-network.js';
import { tempStore } from './helpers.js';

// A library on your own computer that other devices reach: the address it listens on, the
// address people open, proxies in front of it, the browser policy of its pages, and stopping.

test('left alone, the library listens on this computer only', () => {
  assert.deepEqual(networkSettings({}), { host: '127.0.0.1', origin: null, proxies: 0 });
  // Settings left empty, as in a half-filled settings file, change nothing.
  assert.deepEqual(
    networkSettings({ LIBRARY_HOST: ' ', PUBLIC_APP_ORIGIN: '', LIBRARY_TRUSTED_PROXIES: '' }),
    {
      host: '127.0.0.1',
      origin: null,
      proxies: 0,
    },
  );
  for (const host of ['127.0.0.1', '::1']) assert.equal(reachable({ host }), false, host);
  for (const host of ['0.0.0.0', '::', '192.168.1.20']) assert.equal(reachable({ host }), true, host);
});

test('the network settings are read as written, and the public address is reduced to its origin', () => {
  assert.deepEqual(
    networkSettings({
      LIBRARY_HOST: '0.0.0.0',
      PUBLIC_APP_ORIGIN: 'HTTPS://Books.Example.org/',
      LIBRARY_TRUSTED_PROXIES: '2',
    }),
    { host: '0.0.0.0', origin: 'https://books.example.org', proxies: 2 },
  );
  assert.equal(
    networkSettings({ PUBLIC_APP_ORIGIN: 'http://nas.local:46173' }).origin,
    'http://nas.local:46173',
  );
});

test('a network setting that cannot be right stops the start with an explanation', () => {
  for (const host of ['nas.local', 'localhost', '300.1.1.1', '0.0.0.0:80'])
    assert.throws(() => networkSettings({ LIBRARY_HOST: host }), /LIBRARY_HOST must be an IP address/, host);
  for (const origin of [
    'books.example.org',
    'https://books.example.org/library',
    'https://books.example.org/?a=1',
    'https://books.example.org/#top',
    'https://user:pw@books.example.org',
    'ftp://books.example.org',
    'not an address',
  ])
    assert.throws(
      () => networkSettings({ PUBLIC_APP_ORIGIN: origin }),
      /PUBLIC_APP_ORIGIN must be the address the library is opened at/,
      origin,
    );
  for (const proxies of ['-1', '1.5', '6', 'one', 'true'])
    assert.throws(
      () => networkSettings({ LIBRARY_TRUSTED_PROXIES: proxies }),
      /LIBRARY_TRUSTED_PROXIES must be the number of proxies/,
      proxies,
    );
});

test('the printed address is one that works: the public one, or this computer on the port', () => {
  const shown = (host, origin = null) => shownAddress({ host, origin }, 46173);
  assert.equal(shown('127.0.0.1'), 'http://127.0.0.1:46173');
  // Listening on every address includes this computer's own.
  assert.equal(shown('0.0.0.0'), 'http://127.0.0.1:46173');
  assert.equal(shown('::'), 'http://127.0.0.1:46173');
  assert.equal(shown('192.168.1.20'), 'http://192.168.1.20:46173');
  assert.equal(shown('fd00::20'), 'http://[fd00::20]:46173');
  assert.equal(shown('0.0.0.0', 'https://books.example.org'), 'https://books.example.org');
});

test('a library that other devices can reach says so at the start, and warns when nothing adds HTTPS', () => {
  const notes = (host, origin = null) => networkNotes({ host, origin }, 46173).join('\n');
  assert.equal(notes('127.0.0.1'), '');
  assert.match(
    notes('0.0.0.0'),
    /Other devices can reach this library \(LIBRARY_HOST=0\.0\.0\.0\), at the address of this computer/,
  );
  assert.match(notes('0.0.0.0'), /Without HTTPS in front, passwords and keys cross the network unprotected/);
  assert.match(notes('0.0.0.0', 'http://nas.local:46173'), /Without HTTPS in front/);
  // Behind a proxy on the same computer there is nothing to warn about, only the port to name.
  assert.equal(
    notes('127.0.0.1', 'https://books.example.org'),
    'It listens on 127.0.0.1:46173; the address above is where browsers open it.',
  );
  const proxied = notes('::', 'https://books.example.org');
  assert.match(proxied, /It listens on \[::\]:46173/);
  assert.match(proxied, /Other devices can reach this library \(LIBRARY_HOST=::\)\.$/m);
  assert.doesNotMatch(proxied, /Without HTTPS/);
});

test('pages get the browser policy of the deployed site, from the same file', async (t) => {
  const deployed = JSON.parse(
    await readFile(new URL('../web/staticwebapp.config.json', import.meta.url), 'utf8'),
  ).globalHeaders;
  assert.deepEqual(pageHeaders(), deployed);
  assert.match(pageHeaders()['Content-Security-Policy'], /^default-src 'self'; script-src 'self';/);
  assert.equal(pageHeaders()['X-Frame-Options'], 'DENY');
  const folder = await mkdtemp(join(tmpdir(), 'pince-network-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  await writeFile(join(folder, 'config.json'), JSON.stringify({ globalHeaders: { 'X-Test': 'yes' } }));
  assert.deepEqual(pageHeaders(join(folder, 'config.json')), { 'X-Test': 'yes' });
});

test("without proxies the caller is the connection; with them, only what the proxies' own entries say", () => {
  const caller = (forwarded, proxies) =>
    callerAddress(
      new Headers(forwarded === undefined ? {} : { 'x-forwarded-for': forwarded }),
      '192.168.1.50',
      proxies,
    );
  // Nothing a caller sends is believed when no proxy was declared.
  assert.equal(caller('203.0.113.7', 0), '192.168.1.50');
  assert.equal(caller(undefined, 0), '192.168.1.50');
  // One proxy appends the address it was called from; anything further left came from the caller.
  assert.equal(caller('203.0.113.7', 1), '203.0.113.7');
  assert.equal(caller('198.51.100.1, 203.0.113.7', 1), '203.0.113.7');
  assert.equal(caller('198.51.100.1, 203.0.113.7, 10.0.0.2', 2), '203.0.113.7');
  assert.equal(caller('2001:db8:1:2:3:4:5:6', 1), '2001:db8:1:2');
  // A request that did not come through the proxies shares one allowance with all such requests.
  assert.equal(caller(undefined, 1), 'shared');
  assert.equal(caller('203.0.113.7', 2), 'shared');
  assert.equal(caller('not an address', 1), 'shared');
});

test('the health check describes the network settings and explains a wrong one', async (t) => {
  const data = await mkdtemp(join(tmpdir(), 'pince-network-'));
  t.after(() => rm(data, { recursive: true, force: true }));
  const network = async (env) =>
    (await report({ LIBRARY_LOCAL_DIR: data, PORT: '0', ...env })).find((check) => check.name === 'Network');
  assert.deepEqual(await network({}), { state: 'ok', name: 'Network', detail: 'This computer only.' });
  assert.deepEqual(await network({ LIBRARY_HOST: '0.0.0.0' }), {
    state: 'note',
    name: 'Network',
    detail:
      'Other devices can reach it (listens on 0.0.0.0). Without HTTPS in front, passwords and keys cross the network unprotected.',
  });
  assert.equal(
    (
      await network({
        LIBRARY_HOST: '0.0.0.0',
        PUBLIC_APP_ORIGIN: 'https://books.example.org',
        LIBRARY_TRUSTED_PROXIES: '1',
      })
    ).detail,
    'Other devices can reach it (listens on 0.0.0.0), opened at https://books.example.org, behind 1 proxy.',
  );
  assert.equal(
    (await network({ PUBLIC_APP_ORIGIN: 'https://books.example.org', LIBRARY_TRUSTED_PROXIES: '2' })).detail,
    'This computer only, opened at https://books.example.org, behind 2 proxies.',
  );
  const wrong = await network({ LIBRARY_HOST: 'nas.local' });
  assert.equal(wrong.state, 'problem');
  assert.match(wrong.detail, /LIBRARY_HOST must be an IP address/);
});

test('a local library opened at an HTTPS address keeps its session cookie to HTTPS and takes writes only from there', async (t) => {
  const site = 'https://books.example.org';
  // The proxy calls the port over plain HTTP; the browser's own address arrives in `Origin`.
  async function library(settings) {
    const { store } = await tempStore(t);
    const env = {
      BOOTSTRAP_PARENT_PASSWORD: randomUUID(),
      BOOTSTRAP_CHILD_PASSWORD: randomUUID(),
      ...settings,
    };
    const handle = makeApp({ store, env, local: true });
    const send = (path, origin, body, cookie) =>
      handle(
        new Request('http://127.0.0.1:46173/api/' + path, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: origin,
            ...(cookie ? { Cookie: cookie } : {}),
          },
          body: JSON.stringify(body),
        }),
      );
    return { send, account: { username: 'parinte', password: env.BOOTSTRAP_PARENT_PASSWORD } };
  }
  const proxied = await library({ PUBLIC_APP_ORIGIN: site });
  const signedIn = await proxied.send('login', site, proxied.account);
  assert.equal(signedIn.status, 200);
  assert.match(signedIn.headers.get('set-cookie'), /; Max-Age=15552000; Secure$/);
  const cookie = signedIn.headers.get('set-cookie').split(';')[0];
  // A page served from the port itself, or from anywhere else, cannot sign in or change anything.
  for (const origin of ['http://127.0.0.1:46173', 'http://books.example.org', 'https://elsewhere.example'])
    assert.equal((await proxied.send('login', origin, proxied.account)).status, 403, origin);
  const signedOut = await proxied.send('logout', site, {}, cookie);
  assert.match(signedOut.headers.get('set-cookie'), /^library_session=; .*; Max-Age=0; Secure$/);

  // Without a public address, or with a plain HTTP one, the cookie has to work over HTTP.
  const direct = await library({});
  const plain = await direct.send('login', 'http://127.0.0.1:46173', direct.account);
  assert.match(plain.headers.get('set-cookie'), /; Max-Age=15552000$/);
  // Here the HTTPS address is unknown to the library, so the proxy's browsers are turned away.
  assert.equal((await direct.send('login', site, direct.account)).status, 403);
  const lan = await library({ PUBLIC_APP_ORIGIN: 'http://nas.local:46173' });
  assert.match(
    (await lan.send('login', 'http://nas.local:46173', lan.account)).headers.get('set-cookie'),
    /; Max-Age=15552000$/,
  );
});

/** A request to a server on this computer. `fetch` is switched off in the tests. */
const request = (port, path) =>
  new Promise((resolve) => {
    http
      .get({ host: '127.0.0.1', port, path, agent: false }, (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode));
      })
      .on('error', () => resolve('cut'));
  });

async function listening(handler) {
  const server = http.createServer(handler);
  await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
  return { server, port: server.address().port };
}
/** Stands in for the program itself: it receives the signals and records the exit. */
function program() {
  const target = new EventEmitter();
  target.exited = new Promise((resolve) => (target.exit = resolve));
  return target;
}

test('asked to stop, the library closes its database once and leaves without an error', async () => {
  const { server, port } = await listening((request, response) => response.end('ok'));
  const target = program();
  let closed = 0;
  stopOnSignal(server, () => closed++, { target, grace: 60_000 });
  assert.equal(await request(port, '/'), 200);
  target.emit('SIGTERM');
  // A second signal, as from an impatient Ctrl+C, does not close anything twice.
  target.emit('SIGINT');
  assert.equal(await target.exited, 0);
  assert.equal(closed, 1);
  assert.equal(server.listening, false);
});

test('a request that never finishes does not keep the library from stopping', async () => {
  let arrived;
  const waiting = new Promise((resolve) => (arrived = resolve));
  // This request is never answered, as a stalled upload would be.
  const { server, port } = await listening(() => arrived());
  const target = program();
  let closed = 0;
  stopOnSignal(server, () => closed++, { target, grace: 50 });
  const stalled = request(port, '/stalled');
  await waiting;
  target.emit('SIGINT');
  assert.equal(await target.exited, 0);
  assert.equal(await stalled, 'cut');
  assert.equal(closed, 1);
});
