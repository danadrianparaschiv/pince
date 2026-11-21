import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { makeApp } from '../api/src/app.js';
import { reassignConfiguredRoles } from '../api/src/auth.js';
import { addBooks, getBook, view } from '../api/src/books.js';
import { clientAddress } from '../api/src/client-address.js';
import { requestCovers } from '../api/src/cover-jobs.js';
import { drainCoverQueue, processQueuedCover } from '../api/src/cover-dispatch.js';
import { CoverSourceError } from '../api/src/google-covers.js';
import { tempStore } from './helpers.js';

const requireApi = createRequire(new URL('../api/package.json', import.meta.url));
const origin = 'https://family.example';
async function library(t) {
  const { store } = await tempStore(t);
  // These tests drive the real queue path themselves.
  delete store.enqueueCover;
  const env = { BOOTSTRAP_PARENT_PASSWORD: randomUUID(), BOOTSTRAP_CHILD_PASSWORD: randomUUID() };
  const handle = makeApp({ store, env });
  function call(path, { method = 'GET', cookie, data, ip, headers = {} } = {}) {
    if (cookie) headers.cookie = cookie;
    if (data) headers['content-type'] = 'application/json';
    return handle(new Request(origin + '/api/' + path, { method, headers, body: JSON.stringify(data) }), ip);
  }
  const login = (username, password, ip) =>
    call('login', { method: 'POST', data: { username, password }, ip });
  return { store, env, handle, call, login };
}
function cookie(res) {
  assert.equal(res.status, 200);
  return res.headers.get('set-cookie').split(';')[0];
}

test('configuration changes revoke sessions, including after rollback, and reused names require a password reset', async (t) => {
  const { env, call, login } = await library(t);
  const oldPassword = env.BOOTSTRAP_PARENT_PASSWORD;
  const formerParent = cookie(await login('parinte', oldPassword));
  env.PARENT_USERNAME = 'new-parent';
  env.BOOTSTRAP_PARENT_PASSWORD = randomUUID();
  assert.equal((await call('admin/settings', { cookie: formerParent })).status, 401);
  assert.equal((await login('parinte', oldPassword)).status, 401);
  env.PARENT_USERNAME = 'parinte';
  assert.equal((await call('admin/settings', { cookie: formerParent })).status, 401);
  env.PARENT_USERNAME = 'new-parent';
  env.CHILD_USERNAME = 'parinte';
  const parent = cookie(await login('new-parent', env.BOOTSTRAP_PARENT_PASSWORD));
  assert.equal((await login('parinte', oldPassword)).status, 401);
  const edit = (patch) =>
    call('admin/accounts', {
      method: 'PATCH',
      cookie: parent,
      data: { username: 'parinte', currentPassword: env.BOOTSTRAP_PARENT_PASSWORD, ...patch },
    });
  assert.equal((await edit({ enabled: true })).status, 400);
  assert.equal((await edit({ password: oldPassword })).status, 400);
  const newPassword = randomUUID();
  assert.equal((await edit({ password: newPassword })).status, 200);
  assert.equal((await login('parinte', oldPassword)).status, 401);
  const child = cookie(await login('parinte', newPassword));
  assert.equal((await call('books', { cookie: child })).status, 200);
  assert.equal((await call('admin/settings', { cookie: child })).status, 403);
  assert.equal((await call('books', { cookie: formerParent })).status, 401);
});

test('explicit operator handoff supports a direct role swap and is safe to repeat', async (t) => {
  const { env, login, store, call } = await library(t);
  const oldParentPassword = env.BOOTSTRAP_PARENT_PASSWORD,
    oldChildPassword = env.BOOTSTRAP_CHILD_PASSWORD;
  const oldChild = cookie(await login('copil', oldChildPassword));
  const oldParent = cookie(await login('parinte', oldParentPassword));
  env.PARENT_USERNAME = 'copil';
  env.CHILD_USERNAME = 'parinte';
  env.BOOTSTRAP_PARENT_PASSWORD = randomUUID();
  env.BOOTSTRAP_CHILD_PASSWORD = oldParentPassword;
  await assert.rejects(reassignConfiguredRoles(store, env), (e) => e.code === 'newPasswordRequired');
  assert.equal((await store.get('users', 'copil')).value.role, 'child');
  env.BOOTSTRAP_CHILD_PASSWORD = randomUUID();
  await reassignConfiguredRoles(store, env);
  assert.equal((await login('copil', oldChildPassword)).status, 401);
  assert.equal((await login('parinte', oldParentPassword)).status, 401);
  for (const session of [oldChild, oldParent])
    assert.equal((await call('books', { cookie: session })).status, 401);
  const newParent = cookie(await login('copil', env.BOOTSTRAP_PARENT_PASSWORD));
  const newChild = cookie(await login('parinte', env.BOOTSTRAP_CHILD_PASSWORD));
  await reassignConfiguredRoles(store, env);
  assert.equal((await call('admin/settings', { cookie: newParent })).status, 200);
  assert.equal((await call('admin/settings', { cookie: newChild })).status, 403);
});

test('account backoff is atomic across IPs, bounded, independent per account, and clears after recovery', async (t) => {
  const { env, login, store } = await library(t);
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-01-01') });
  const attempts = await Promise.all(
    Array.from({ length: 9 }, (_, n) => login('Parinte', 'incorrect', 'network-' + n)),
  );
  assert.equal(attempts.filter((res) => res.status === 401).length, 5);
  assert.equal(attempts.filter((res) => res.status === 429).length, 4);
  assert.equal((await login('parinte', env.BOOTSTRAP_PARENT_PASSWORD, 'new-ip')).status, 429);
  assert.equal((await login('copil', env.BOOTSTRAP_CHILD_PASSWORD, 'new-ip')).status, 200);
  for (const cooldown of [1000, 2000, 4000, 8000, 16000, 30000]) {
    const { value } = await store.get('limits', 'account-parinte');
    assert.equal(value.next - Date.now(), cooldown);
    t.mock.timers.tick(cooldown);
    assert.equal((await login('parinte', 'incorrect', 'another-' + cooldown)).status, 401);
  }
  t.mock.timers.tick(30000);
  assert.equal((await login('parinte', env.BOOTSTRAP_PARENT_PASSWORD, 'valid')).status, 200);
  assert.equal((await store.get('limits', 'account-parinte')).value.count, 0);
  await login('unknown-user', 'incorrect', 'unknown');
  assert.equal(await store.get('limits', 'account-unknown-user'), null);
});

test('wrong passwords sent from elsewhere cannot keep a browser that signed in before from signing in', async (t) => {
  const { env, call, login, store } = await library(t);
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-01-01') });
  const password = env.BOOTSTRAP_PARENT_PASSWORD;
  const signIn = (secret, { cookie, ip = 'home', username = 'parinte' } = {}) =>
    call('login', { method: 'POST', data: { username, password: secret }, cookie, ip });
  const first = await signIn(password);
  // The browser keeps the cookie for 180 days; the session behind it still ends after a week.
  assert.match(first.headers.get('set-cookie'), /; Max-Age=15552000; Secure$/);
  const remembered = cookie(first);
  const childs = cookie(await signIn(env.BOOTSTRAP_CHILD_PASSWORD, { username: 'copil' }));
  t.mock.timers.tick(8 * 86400_000);
  assert.equal((await call('books', { cookie: remembered })).status, 401);

  // Someone who knows the username keeps the account's shared allowance in its cooldown.
  for (let n = 0; n < 9; n++) await login('parinte', 'incorrect', 'elsewhere-' + n);
  assert.equal((await signIn(password, { ip: 'new-phone' })).status, 429);
  // Another account's cookie, or a made-up one, earns nothing.
  assert.equal((await signIn(password, { cookie: childs })).status, 429);
  assert.equal((await signIn(password, { cookie: 'library_session=parinte~' + 'a'.repeat(43) })).status, 429);
  // The browser that signed in before is not held up, and still needs the right password.
  assert.equal((await signIn('incorrect', { cookie: remembered })).status, 401);
  const back = await signIn(password, { cookie: remembered });
  assert.equal(back.status, 200);
  const current = cookie(back);
  assert.equal((await call('books', { cookie: current })).status, 200);
  // Its old cookie was replaced by the new one and no longer counts.
  assert.equal((await signIn(password, { cookie: remembered })).status, 429);

  // A known browser has limits of its own, so a copied cookie does not allow unlimited guesses.
  const guesses = [];
  for (let n = 0; n < 8; n++) guesses.push((await signIn('incorrect', { cookie: current })).status);
  assert.deepEqual(guesses, [401, 401, 401, 401, 401, 429, 429, 429]);
  assert.equal((await signIn(password, { cookie: current })).status, 429);
  const lanes = (await store.list('limits')).length;
  assert(lanes >= 2);

  // Changing the password forgets every known browser, as it ends every session.
  assert.equal((await store.get('users', 'parinte')).value.devices.length, 1);
  const changed = await call('admin/accounts', {
    method: 'PATCH',
    cookie: current,
    data: { username: 'parinte', password: 'a new long password', currentPassword: password },
    headers: { origin },
  });
  assert.equal(changed.status, 200);
  assert.deepEqual((await store.get('users', 'parinte')).value.devices, []);
  t.mock.timers.tick(600_000);
  for (let n = 0; n < 6; n++) await login('parinte', 'incorrect', 'later-' + n);
  assert.equal((await signIn('a new long password', { cookie: current })).status, 429);
});

test("a new password, for either account, needs the parent's own current password", async (t) => {
  const { env, call, login } = await library(t);
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-01-01') });
  const own = env.BOOTSTRAP_PARENT_PASSWORD;
  const parent = cookie(await login('parinte', own));
  const change = (data) =>
    call('admin/accounts', { method: 'PATCH', cookie: parent, data, headers: { origin } });
  const refused = async (data) => {
    const response = await change(data);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, 'currentPassword');
  };
  // Without it, with a wrong one, or with the child's own password, nothing changes.
  await refused({ username: 'copil', password: 'a new long password' });
  await refused({ username: 'copil', password: 'a new long password', currentPassword: 'incorrect' });
  await refused({
    username: 'parinte',
    password: 'a new long password',
    currentPassword: env.BOOTSTRAP_CHILD_PASSWORD,
  });
  await refused({ username: 'parinte', password: 'a new long password', currentPassword: 7 });
  assert.equal((await login('copil', env.BOOTSTRAP_CHILD_PASSWORD)).status, 200);
  assert.equal((await call('books', { cookie: parent })).status, 200);
  // Switching the other account off or on is not a password change.
  assert.equal((await change({ username: 'copil', enabled: false })).status, 200);
  assert.equal((await change({ username: 'copil', enabled: true })).status, 200);
  // The right one changes the child's password and leaves the parent signed in.
  assert.equal(
    (await change({ username: 'copil', password: 'a new long password', currentPassword: own })).status,
    200,
  );
  assert.equal((await login('copil', 'a new long password')).status, 200);
  assert.equal((await call('books', { cookie: parent })).status, 200);
  // A held session cannot be used to guess the password without end.
  await refused({ username: 'copil', password: 'another long password', currentPassword: 'incorrect' });
  await refused({ username: 'copil', password: 'another long password', currentPassword: 'incorrect' });
  assert.equal(
    (await change({ username: 'copil', password: 'another long password', currentPassword: own })).status,
    429,
  );
  t.mock.timers.tick(600_000);
  assert.equal(
    (await change({ username: 'parinte', password: 'another long password', currentPassword: own })).status,
    200,
  );
  assert.equal((await call('books', { cookie: parent })).status, 401);
  assert.equal((await login('parinte', 'another long password')).status, 200);
});

test("a scan is refused under the upper-case form of an id, which could name another photo's file", async (t) => {
  const { env, call, login } = await library(t);
  const parent = cookie(await login('parinte', env.BOOTSTRAP_PARENT_PASSWORD));
  const scan = (requestId) =>
    call('scan', { method: 'POST', cookie: parent, data: { requestId, mode: 'shelf' }, headers: { origin } });
  const id = randomUUID();
  const upper = await scan(id.toUpperCase());
  assert.equal(upper.status, 400);
  assert.equal((await upper.json()).error, 'invalid');
  // In lower case the same request gets past that check, to the next one.
  const lower = await scan(id);
  assert.equal(lower.status, 403);
  assert.equal((await lower.json()).error, 'scanDisabled');
});

test('the catalogue has a ceiling, counted in books that are not already held', async (t) => {
  const { store } = await tempStore(t);
  const row = (title) => ({ id: randomUUID(), title });
  const held = [row('One'), row('Two')];
  await addBooks(store, held, false, 3);
  await assert.rejects(
    addBooks(store, [row('Three'), row('Four')], false, 3),
    (e) => e.status === 409 && e.code === 'libraryFull',
  );
  assert.equal((await store.list('books')).length, 2);
  // Sending books the library already holds is still answered, and one more still fits.
  assert.equal((await addBooks(store, [...held, row('Three')], false, 3)).books.length, 3);
  // A restore is held to the same ceiling.
  await assert.rejects(
    addBooks(store, [{ ...row('Four'), createdAt: '2026-01-01T00:00:00.000Z' }], true, 3),
    (e) => e.code === 'libraryFull',
  );
});

test("the caller's address comes only from what the platform itself adds to the request", () => {
  const address = (forwarded, extra = {}) =>
    clientAddress(
      new Headers({ ...(forwarded === undefined ? {} : { 'x-forwarded-for': forwarded }), ...extra }),
    );
  // The platform appends the caller, then its own edge, each with a port.
  assert.equal(address('203.0.113.7:51234, 10.0.0.9:443'), '203.0.113.7');
  // The same caller on another connection is the same address.
  assert.equal(address('203.0.113.7:40000, 10.0.0.9:8080'), '203.0.113.7');
  // Entries the caller sent sit further left and are ignored, as is any other address header.
  assert.equal(address('198.51.100.1, 198.51.100.2, 203.0.113.7:51234, 10.0.0.9:443'), '203.0.113.7');
  assert.equal(
    address('203.0.113.7:51234, 10.0.0.9:443', { 'x-azure-clientip': '198.51.100.1' }),
    '203.0.113.7',
  );
  // IPv6 callers are counted by network, with or without brackets and a port.
  assert.equal(address('[2001:db8:1:2:3:4:5:6]:51234, 10.0.0.9:443'), '2001:db8:1:2');
  assert.equal(address('2001:DB8:1:2::9, 10.0.0.9:443'), '2001:db8:1:2');
  // Without both platform entries nothing in the request can be trusted; everyone shares one allowance.
  for (const forwarded of [
    undefined,
    '',
    '203.0.113.7',
    'not an address, 10.0.0.9:443',
    '<script>, 10.0.0.9:443',
  ])
    assert.equal(address(forwarded, { 'x-azure-clientip': '198.51.100.1' }), 'shared');
});

test('Azure HTTP entry authenticates before reading and rejects declared or streamed login overflow', async (t) => {
  const { app, HttpRequest } = requireApi('@azure/functions');
  let handler;
  t.mock.method(app, 'http', (_name, config) => {
    handler = config.handler;
  });
  const streaming = t.mock.fn();
  t.mock.getter(app, 'setup', () => streaming);
  const previous = process.env.AZURE_STORAGE_CONNECTION_STRING;
  process.env.AZURE_STORAGE_CONNECTION_STRING = 'UseDevelopmentStorage=true';
  t.after(() => {
    if (previous === undefined) delete process.env.AZURE_STORAGE_CONNECTION_STRING;
    else process.env.AZURE_STORAGE_CONNECTION_STRING = previous;
  });
  await import('../api/src/azure.js');
  assert.deepEqual(streaming.mock.calls[0].arguments[0], { enableHttpStream: true });
  const request = (path, headers = {}) =>
    new HttpRequest({
      url: origin + '/api/' + path,
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: { string: '{}' },
    });
  const privateRequest = request('books');
  assert.equal((await handler(privateRequest)).status, 401);
  assert.equal(privateRequest.bodyUsed, false);
  const oversized = request('login', { 'content-length': '4097' });
  assert.equal((await handler(oversized)).status, 413);
  assert.equal(oversized.bodyUsed, false);
  let pulls = 0,
    cancelled = false;
  const stream = new ReadableStream(
    {
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array(2048));
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const nativeRequest = new Request(origin + '/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: stream,
    duplex: 'half',
  });
  assert.equal((await handler(new HttpRequest({ nativeRequest }))).status, 413);
  assert.equal(pulls, 3);
  assert.equal(cancelled, true);
});

test('authorized uploads keep their larger ceiling and reject streamed overflow before persistence', async (t) => {
  const { env, login, handle, call } = await library(t);
  const session = cookie(await login('parinte', env.BOOTSTRAP_PARENT_PASSWORD));
  const books = Array.from({ length: 18 }, () => ({ id: randomUUID(), title: 'a'.repeat(270) }));
  assert.equal((await call('books', { cookie: session, method: 'POST', data: { books } })).status, 201);
  let reads = 0;
  async function* chunks() {
    for (let n = 0; n < 12; n++) {
      reads++;
      yield Buffer.alloc(1_000_000);
    }
  }
  const res = await handle({
    method: 'POST',
    url: origin + '/api/admin/restore',
    body: chunks(),
    headers: new Headers({ 'content-type': 'application/json', cookie: session }),
  });
  assert.equal(res.status, 413);
  assert.equal(reads, 10);
  assert.equal((await (await call('books', { cookie: session })).json()).books.length, 18);
});

test('worker can finish its queued cover through the API without access to accounts, notes, or other jobs', async (t) => {
  const { store, handle, call } = await library(t);
  const queue = [];
  store.enqueueCover = async (job) => queue.push(job);
  const ids = [randomUUID(), randomUUID()];
  for (const id of ids) {
    await addBooks(
      store,
      [
        {
          id,
          title: 'Demo',
          authors: 'Author',
          isbn: '123456789X',
          note: 'family only',
          favorite: true,
          createdAt: new Date().toISOString(),
        },
      ],
      true,
    );
    await requestCovers(store, id);
  }
  const [job, other] = queue;
  const headers = { 'x-library-cover-token': job.token };
  assert.equal((await call('admin/settings', { headers })).status, 401);
  assert.equal((await call('books/' + job.id, { headers })).status, 401);
  assert.equal((await call('cover-jobs/' + job.id + '/claim', { method: 'POST' })).status, 401);
  const wrong = await call('cover-jobs/' + other.id + '/claim', { method: 'POST', headers });
  assert.deepEqual(await wrong.json(), { state: 'done' });
  assert.equal((await getBook(store, other.id)).coverLookup.attempts, 0);
  const img = await requireApi('sharp')({
    create: { width: 60, height: 80, channels: 3, background: '#494' },
  })
    .jpeg()
    .toBuffer();
  const cover = {
    data: 'data:image/jpeg;base64,' + img.toString('base64'),
    source: 'googlebooks',
    sourceId: 'abc',
    sourceUrl: 'https://books.google.com/books?id=abc',
  };
  const fetcher = (url, options) => handle(new Request(url, options));
  const status = await processQueuedCover(
    job,
    { LIBRARY_API_ORIGIN: origin },
    async (metadata, options) => {
      assert.deepEqual(metadata, { title: 'Demo', authors: 'Author', isbn: '123456789X', publisher: '' });
      await options.beforeBraveQuery();
      await options.beforeGoogleQuery();
      const complete = (id, data) =>
        call('cover-jobs/' + id + '/complete', {
          method: 'POST',
          data,
          headers: { ...headers, 'x-cover-attempt': '1' },
        });
      assert.equal((await complete(other.id, { covers: [cover] })).status, 409);
      assert.equal((await complete(job.id, { covers: [{ ...cover, sourceUrl: origin }] })).status, 400);
      return { covers: [cover], warnings: [] };
    },
    fetcher,
  );
  assert.equal(status, 'done');
  const saved = await getBook(store, job.id);
  assert.equal(saved.coverLookup.status, 'ready');
  assert.equal(saved.note, 'family only');
  assert.equal(saved.favorite, true);
  assert.ok(saved.image);
  assert.ok(!JSON.stringify(view(saved)).includes(job.token));
  assert.equal(await processQueuedCover(job, { LIBRARY_API_ORIGIN: origin }, assert.fail, fetcher), 'done');
});

test('the worker reports a failed lookup, and the library decides whether a paid request may be made', async (t) => {
  const { store, handle, call } = await library(t);
  const queue = [];
  store.enqueueCover = async (job) => queue.push(job);
  const id = randomUUID();
  await addBooks(store, [{ id, title: 'Demo', authors: 'Author' }]);
  await requestCovers(store, id);
  const [job] = queue,
    fetcher = (url, options) => handle(new Request(url, options));
  const action = (name, data) =>
    call('cover-jobs/' + id + '/' + name, {
      method: 'POST',
      data,
      headers: { 'x-library-cover-token': job.token, 'x-cover-attempt': '1' },
    });
  // Nothing is accepted for an attempt that was never claimed.
  assert.equal((await action('brave-query')).status, 409);
  const state = await processQueuedCover(
    job,
    { LIBRARY_API_ORIGIN: origin },
    async (_book, options) => {
      assert.equal((await action('brave-refund')).status, 404);
      assert.equal((await action('brave-block', { reason: 'because' })).status, 400);
      assert.equal((await action('fail', { reason: 'quota' })).status, 400);
      await options.beforeBraveQuery();
      await options.beforeGoogleQuery();
      // After a service refuses the key or the quota, the library answers "blocked" for an hour.
      await options.blockBrave('quota');
      await assert.rejects(
        options.beforeBraveQuery(),
        (error) =>
          error instanceof CoverSourceError &&
          error.reason === 'quota' &&
          error.source === 'bravesearch' &&
          error.retryable === false,
      );
      await options.blockGoogle('access');
      await assert.rejects(
        options.beforeGoogleQuery(),
        (error) => error.reason === 'access' && error.source === 'googlebooks',
      );
      throw new CoverSourceError('quota', false, 'bravesearch');
    },
    fetcher,
  );
  assert.equal(state, 'done');
  const { coverLookup } = await getBook(store, id);
  assert.deepEqual(
    [coverLookup.status, coverLookup.failureSource, coverLookup.failureReason],
    ['failed', 'bravesearch', 'quota'],
  );
  // One request was counted for each service before it was blocked; the blocked ones were not.
  for (const record of ['brave-cover-usage', 'google-cover-usage']) {
    const usage = (await store.get('system', record)).value;
    assert.deepEqual(Object.values(usage.days), [1]);
    assert(usage.blockedUntil > Date.now() + 3_500_000 && usage.blockedUntil <= Date.now() + 3_600_000);
  }
  // A reason the worker makes up is not stored as given.
  const other = randomUUID();
  await addBooks(store, [{ id: other, title: 'Altă carte' }]);
  await requestCovers(store, other);
  await processQueuedCover(
    queue[1],
    { LIBRARY_API_ORIGIN: origin },
    async () => {
      throw Object.assign(new Error('odd'), {
        source: 'somewhere else',
        reason: '<script>',
        retryable: false,
      });
    },
    fetcher,
  );
  const odd = (await getBook(store, other)).coverLookup;
  assert.deepEqual([odd.status, odd.failureSource, odd.failureReason], ['failed', null, 'unavailable']);
});

test('expired claims fence late results and exhausted deliveries terminate without spawning queue messages', async (t) => {
  const { call, store } = await library(t);
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-01-01') });
  const queue = [];
  store.enqueueCover = async (job) => queue.push(job);
  const id = randomUUID();
  await addBooks(store, [{ id, title: 'Book' }]);
  await requestCovers(store, id);
  const worker = (action, attempt, data) =>
    call('cover-jobs/' + id + '/' + action, {
      method: 'POST',
      headers: { 'x-library-cover-token': queue[0].token, 'x-cover-attempt': String(attempt) },
      data,
    });
  const claim = async () => (await worker('claim')).json();
  assert.equal((await claim()).attempt, 1);
  assert.equal((await claim()).state, 'waiting');
  t.mock.timers.tick(360_000);
  assert.equal((await claim()).attempt, 2);
  assert.equal((await worker('complete', 1, { covers: [] })).status, 409);
  assert.equal((await (await worker('fail', 2, { retryable: true })).json()).state, 'waiting');
  assert.equal((await claim()).attempt, 3);
  t.mock.timers.tick(360_000);
  assert.equal((await claim()).state, 'done');
  assert.equal((await getBook(store, id)).coverLookup.status, 'failed');
  assert.equal(queue.length, 1);
});

test('one drain processes a backlog sequentially and preserves the original message across retry and interruption', async () => {
  const jobs = Array.from({ length: 40 }, () => ({ id: randomUUID(), token: randomUUID() }));
  const pending = new Map(jobs.map((job) => [job.id, { job, visible: 0, receipt: 0 }]));
  let now = 0,
    active = false;
  const queue = {
    async receiveMessages({ numberOfMessages, visibilityTimeout }) {
      assert.equal(numberOfMessages, 1);
      assert.equal(active, false);
      const row = [...pending.values()].find((r) => r.visible <= now);
      if (!row) return { receivedMessageItems: [] };
      row.visible = now + 1000 * visibilityTimeout;
      return {
        receivedMessageItems: [
          {
            messageId: row.job.id,
            popReceipt: String(++row.receipt),
            messageText: Buffer.from(JSON.stringify(row.job)).toString('base64'),
          },
        ],
      };
    },
    async deleteMessage(id, receipt) {
      assert.equal(receipt, String(pending.get(id).receipt));
      pending.delete(id);
    },
  };
  let processed = 0;
  await drainCoverQueue(
    queue,
    async (job) => {
      active = true;
      await Promise.resolve();
      active = false;
      processed++;
      return job.id === jobs[0].id ? 'waiting' : 'done';
    },
    () => now,
  );
  assert.equal(processed, jobs.length);
  assert.equal(pending.size, 1);
  now += 360_000;
  await assert.rejects(
    drainCoverQueue(
      queue,
      async () => {
        throw Error('network');
      },
      () => now,
    ),
    /network/,
  );
  assert.equal(pending.size, 1);
  now += 360_000;
  await drainCoverQueue(
    queue,
    async (job) => {
      assert.deepEqual(job, jobs[0]);
      return 'done';
    },
    () => now,
  );
  assert.equal(pending.size, 0);
});

test("the hosting platform's own sign-in pages are switched off; the library has its own", async () => {
  const config = JSON.parse(
    await readFile(new URL('../web/staticwebapp.config.json', import.meta.url), 'utf8'),
  );
  // The platform ignores a wildcard here, so each of its providers is named.
  assert.deepEqual(
    config.routes,
    ['github', 'aad', 'twitter'].map((provider) => ({ route: '/.auth/login/' + provider, statusCode: 404 })),
  );
});

test('deployment confines worker identity to its own host blobs and the family job queue', async () => {
  const read = (name) => readFile(new URL('../' + name, import.meta.url), 'utf8');
  const [infra, main, worker, deploy] = await Promise.all([
    read('infra/covers.bicep'),
    read('infra/main.bicep'),
    read('worker/main.js'),
    read('scripts/deploy.sh'),
  ]);
  assert.doesNotMatch(infra, /listKeys\(|StorageAccountConnectionString|AZURE_STORAGE_CONNECTION_STRING/);
  assert.match(infra, /scope: hostStorage\s+name: guid\(hostStorage.id, identity.id, blobOwner\)/);
  assert.match(infra, /scope: jobs\s+name: guid\(jobs.id, identity.id, queueProcessor\)/);
  assert.equal([...infra.matchAll(/Microsoft.Authorization\/roleAssignments@/g)].length, 2);
  assert.match(infra, /8a0f0c08-91a1-4084-bc3d-661d67233fed/);
  // The worker cannot be published to with a password, over either endpoint.
  for (const name of ['scm', 'ftp'])
    assert.match(
      infra,
      new RegExp(
        "basicPublishingCredentialsPolicies@[\\d-]+' = \\{\\s+parent: worker\\s+name: '" +
          name +
          "'[^}]*properties: \\{ allow: false \\}",
      ),
    );
  assert.match(worker, /app.timer\(/);
  assert.doesNotMatch(worker, /AzureStore|storageQueue\(|CONNECTION_STRING/);
  // Managed Static Web Apps rejects this reserved host setting. The HTTP
  // adapter tests above verify the application's streaming request limits.
  assert.doesNotMatch(main, /FUNCTIONS_REQUEST_BODY_SIZE_LIMIT:/);
  assert.doesNotMatch(deploy, /--setting-names FUNCTIONS_REQUEST_BODY_SIZE_LIMIT=/);
});
