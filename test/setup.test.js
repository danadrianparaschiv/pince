import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { makeApp } from '../api/src/app.js';
import { validModelEndpoint, validTextEndpoint } from '../api/src/endpoints.js';
import { report } from '../scripts/doctor.mjs';
import { loadSavedSettings, readSettings, settingsFile, writeSettings } from '../scripts/local-settings.js';
import { accessFile, makeLocalSetup } from '../scripts/local-setup.js';
import { startLibrary, tempStore } from './helpers.js';

// Setting up a library on your own computer from the browser: the one-time link, the two
// accounts, and the keys of the optional services. The outside services are stand-ins.

const origin = 'http://127.0.0.1:46173';

/**
 * A new local library as `npm start` leaves it: generated passwords in the sign-in details file,
 * and set-up waiting. `answer` stands in for the outside services; `requests` records what was
 * sent to them.
 */
async function newLibrary(
  t,
  { env: settings = {}, outside, open = true, answer = () => new Response('{}') } = {},
) {
  const { store } = await tempStore(t);
  const folder = await mkdtemp(join(tmpdir(), 'pince-setup-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const generated = { parent: randomUUID(), child: randomUUID() };
  await writeFile(
    accessFile(folder),
    JSON.stringify({
      parent: { username: 'parinte', password: generated.parent },
      child: { username: 'copil', password: generated.child },
    }),
  );
  const env = {
    BOOTSTRAP_PARENT_PASSWORD: generated.parent,
    BOOTSTRAP_CHILD_PASSWORD: generated.child,
    ...settings,
  };
  const requests = [];
  const fetcher = async (target, options) => {
    requests.push({ url: new URL(target), ...options });
    return answer(new URL(target));
  };
  const setup = makeLocalSetup({ store, env, folder, outside, open, fetcher });
  const handle = makeApp({ store, env, local: true, setup });
  async function call(path, { method = 'GET', data, cookie, token, headers = {} } = {}) {
    if (cookie) headers.cookie = cookie;
    if (token) headers['x-setup-token'] = token;
    if (data) headers['content-type'] = 'application/json';
    const response = await handle(
      new Request(origin + '/api/' + path, { method, headers, body: data && JSON.stringify(data) }),
    );
    return { status: response.status, data: await response.json(), headers: response.headers };
  }
  async function signin(username, password) {
    const result = await call('login', { method: 'POST', data: { username, password } });
    return result.status === 200 ? result.headers.get('set-cookie').split(';')[0] : null;
  }
  return { store, folder, env, generated, requests, setup, call, signin, token: setup.token };
}
const post = (data, token) => ({ method: 'POST', data, token });
const modelValues = {
  AZURE_OPENAI_ENDPOINT: 'https://library-test.openai.azure.com',
  AZURE_OPENAI_DEPLOYMENT: 'mini',
  AZURE_OPENAI_API_KEY: 'model-key-' + randomUUID(),
};

test('a deployed library has no set-up screen and takes no keys from the browser', async (t) => {
  const { call, signin } = await startLibrary(t);
  const token = { 'x-setup-token': 'anything' };
  for (const path of ['setup', 'setup/state'])
    assert.equal((await call(path, 'GET', undefined, null, token)).status, 401);
  assert.equal((await call('setup/accounts', 'POST', {}, null, token)).status, 401);
  const parent = await signin();
  assert.equal((await call('setup/state', 'GET', undefined, parent, token)).status, 404);
  assert.equal(
    (
      await call(
        'admin/services',
        'PATCH',
        { service: 'googleBooks', values: { GOOGLE_BOOKS_API_KEY: 'k' } },
        parent,
      )
    ).status,
    404,
  );
  assert(!('services' in (await call('admin/settings', 'GET', undefined, parent)).data));
});

test('set-up needs the one-time link, and the link stops working once set-up is finished', async (t) => {
  const { call, token, folder, setup } = await newLibrary(t);
  assert.match(token, /^[\w-]{43}$/);
  // Anyone may learn that set-up is waiting; nothing else is open without the link.
  assert.deepEqual((await call('setup')).data, { pending: true });
  for (const wrong of [undefined, 'x', token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A')]) {
    assert.equal((await call('setup/state', { token: wrong })).status, 401);
    assert.equal((await call('setup/accounts', post({}, wrong))).status, 401);
    assert.equal((await call('setup/services', post({}, wrong))).status, 401);
    assert.equal((await call('setup/finish', post({}, wrong))).status, 401);
  }
  const state = await call('setup/state', { token });
  assert.equal(state.status, 200);
  assert.deepEqual(state.data.accounts, {
    parent: { username: 'parinte', fixed: false },
    child: { username: 'copil', fixed: false },
    chosen: false,
    file: accessFile(folder),
  });
  assert.deepEqual(
    state.data.services.map((service) => [service.id, service.state, service.fixed]),
    [
      ['recognition', 'unset', false],
      ['textDetection', 'unset', false],
      ['googleBooks', 'unset', false],
      ['braveSearch', 'unset', false],
    ],
  );
  // A page on another site cannot use the link, even if it learned the token.
  const foreign = await call('setup/finish', {
    ...post({}, token),
    headers: { origin: 'https://elsewhere.example' },
  });
  assert.equal(foreign.status, 403);
  assert.equal((await call('setup/unknown', post({}, token))).status, 404);

  writeSettings(folder, { setup: 'pending', values: {} });
  assert.deepEqual((await call('setup/finish', post({}, token))).data, { username: 'parinte' });
  assert.equal(readSettings(folder).setup, 'done');
  assert.equal(setup.token, null);
  assert.deepEqual((await call('setup')).data, { pending: false });
  assert.equal((await call('setup/state', { token })).status, 404);
  assert.equal((await call('setup/accounts', post({}, token))).status, 404);
});

test('an established library starts with set-up closed', async (t) => {
  const { call, setup } = await newLibrary(t, { open: false });
  assert.equal(setup.token, null);
  assert.deepEqual((await call('setup')).data, { pending: false });
  assert.equal((await call('setup/state', { token: 'null' })).status, 404);
});

test('set-up gives both accounts the chosen names and passwords, and ends what came before', async (t) => {
  const { call, signin, token, generated, folder, env, store } = await newLibrary(t);
  const earlier = await signin('parinte', generated.parent);
  assert.equal((await call('books', { cookie: earlier })).status, 200);
  const chosen = { parent: 'parent-' + randomUUID(), child: 'child-' + randomUUID() };
  const accounts = (parent, child, parentPassword = chosen.parent, childPassword = chosen.child) =>
    call(
      'setup/accounts',
      post(
        {
          parent: { username: parent, password: parentPassword },
          child: { username: child, password: childPassword },
        },
        token,
      ),
    );

  for (const [parent, child, error, parentPassword] of [
    ['', 'copil', 'username'],
    ['ana maria', 'copil', 'username'],
    ['ana', 'ANA', 'sameUsername'],
    ['ana', 'copil', 'passwordLength', 'too-short'],
    ['ana', 'copil', 'passwordLength', 'x'.repeat(129)],
  ]) {
    const refused = await accounts(parent, child, parentPassword);
    assert.deepEqual([refused.status, refused.data.error], [400, error], parent + ' / ' + child);
  }
  assert.equal((await call('setup/accounts', post({}, token))).status, 400);
  // A refused request changes nothing: the session and the generated password still work.
  assert.equal((await call('books', { cookie: earlier })).status, 200);
  assert.equal((await call('setup/state', { token })).data.accounts.chosen, false);

  assert.deepEqual((await accounts('Ana', 'copil')).data, { ok: true });
  assert.equal((await call('books', { cookie: earlier })).status, 401);
  assert.equal(await signin('parinte', generated.parent), null);
  assert.equal(await signin('ana', generated.parent), null);
  assert.equal(await signin('copil', generated.child), null);
  const parent = await signin('ana', chosen.parent);
  const child = await signin('copil', chosen.child);
  assert.equal((await call('admin/settings', { cookie: parent })).status, 200);
  assert.equal((await call('books', { cookie: child })).status, 200);
  assert.equal((await call('admin/settings', { cookie: child })).status, 403);

  // The sign-in details file keeps the names and no password, generated or chosen.
  const file = await readFile(accessFile(folder), 'utf8');
  assert.deepEqual(
    [JSON.parse(file).parent, JSON.parse(file).child],
    [{ username: 'ana' }, { username: 'copil' }],
  );
  for (const secret of [...Object.values(generated), ...Object.values(chosen)])
    assert(!file.includes(secret));
  assert.equal(env.BOOTSTRAP_PARENT_PASSWORD, undefined);
  assert.equal(env.BOOTSTRAP_CHILD_PASSWORD, undefined);
  assert.notEqual((await store.get('users', 'ana')).value.password, chosen.parent);
  const state = (await call('setup/state', { token })).data.accounts;
  assert.deepEqual([state.parent.username, state.child.username, state.chosen], ['ana', 'copil', true]);

  // Choosing again, as after `npm start -- --setup`, replaces the passwords and the sessions.
  const again = randomUUID();
  assert.equal((await accounts('ana', 'copil', again)).status, 200);
  assert.equal((await call('books', { cookie: parent })).status, 401);
  assert.equal(await signin('ana', chosen.parent), null);
  assert(await signin('ana', again));
});

test('account names set in the shell or in .env cannot be changed from the set-up screen', async (t) => {
  const { call, signin, token } = await newLibrary(t, {
    env: { PARENT_USERNAME: 'mama' },
    outside: new Set(['PARENT_USERNAME']),
  });
  const password = randomUUID();
  const accounts = (parent, child) =>
    call(
      'setup/accounts',
      post({ parent: { username: parent, password }, child: { username: child, password } }, token),
    );
  const state = (await call('setup/state', { token })).data.accounts;
  assert.deepEqual(
    [state.parent, state.child],
    [
      { username: 'mama', fixed: true },
      { username: 'copil', fixed: false },
    ],
  );
  const refused = await accounts('ana', 'copil');
  assert.deepEqual([refused.status, refused.data.error], [400, 'usernameFixed']);
  assert.equal((await accounts('mama', 'fiu')).status, 200);
  assert(await signin('mama', password));
  assert(await signin('fiu', password));
});

test('a service key is tried before it is saved, works at once, and is never sent back', async (t) => {
  const { call, token, requests, env, folder } = await newLibrary(t);
  const keys = {
    vision: 'vision-key-' + randomUUID(),
    google: 'google-key-' + randomUUID(),
    brave: 'brave-key-' + randomUUID(),
  };
  const save = (service, values) => call('setup/services', post({ service, values }, token));
  const sent = [];
  const answered = async (service, values) => {
    const result = await save(service, values);
    assert.equal(result.status, 200, service);
    sent.push(JSON.stringify(result.data));
    return [requests.at(-1), result.data.services.find((entry) => entry.id === service)];
  };

  // The model: a few tokens of text to the deployment, in the shape a scan uses.
  let [request, status] = await answered('recognition', modelValues);
  assert.equal(request.url.href, 'https://library-test.openai.azure.com/openai/v1/chat/completions');
  assert.equal(request.headers['api-key'], modelValues.AZURE_OPENAI_API_KEY);
  assert.equal(request.redirect, 'error');
  const body = JSON.parse(request.body);
  assert.deepEqual([body.model, body.max_completion_tokens], ['mini', 16]);
  assert.deepEqual(status, {
    id: 'recognition',
    state: 'set',
    fixed: false,
    details: {
      AZURE_OPENAI_ENDPOINT: modelValues.AZURE_OPENAI_ENDPOINT,
      AZURE_OPENAI_DEPLOYMENT: 'mini',
    },
  });

  // The text detector: one blank picture.
  [request, status] = await answered('textDetection', {
    AZURE_VISION_ENDPOINT: ' https://pince-ocr-test.cognitiveservices.azure.com/ ',
    AZURE_VISION_KEY: keys.vision,
  });
  assert.equal(request.url.host, 'pince-ocr-test.cognitiveservices.azure.com');
  assert.equal(request.url.pathname, '/computervision/imageanalysis:analyze');
  assert.equal(request.headers['Ocp-Apim-Subscription-Key'], keys.vision);
  assert.deepEqual([...request.body.subarray(0, 2)], [0xff, 0xd8]);
  assert.deepEqual(status.details, {
    AZURE_VISION_ENDPOINT: 'https://pince-ocr-test.cognitiveservices.azure.com/',
  });

  [request, status] = await answered('googleBooks', { GOOGLE_BOOKS_API_KEY: keys.google });
  assert.equal(request.url.host, 'www.googleapis.com');
  assert.equal(request.headers['X-Goog-Api-Key'], keys.google);
  assert.deepEqual([status.state, status.details], ['set', {}]);

  [request, status] = await answered('braveSearch', { BRAVE_SEARCH_API_KEY: keys.brave });
  assert.equal(request.url.host, 'api.search.brave.com');
  assert.equal(request.headers['X-Subscription-Token'], keys.brave);
  assert.equal(status.state, 'set');
  assert.equal(requests.length, 4);

  // The running library uses them at once; nothing the browser received holds a key.
  assert.equal(env.GOOGLE_BOOKS_API_KEY, keys.google);
  assert.equal(env.BRAVE_SEARCH_API_KEY, keys.brave);
  assert.equal(env.AZURE_VISION_KEY, keys.vision);
  assert.equal(env.AZURE_OPENAI_API_KEY, modelValues.AZURE_OPENAI_API_KEY);
  sent.push(JSON.stringify((await call('setup/state', { token })).data));
  for (const key of [...Object.values(keys), modelValues.AZURE_OPENAI_API_KEY])
    for (const text of sent) assert(!text.includes(key));

  // They are kept in the data folder, for the owner only, and set-up is still waiting.
  const saved = readSettings(folder);
  assert.equal(saved.values.BRAVE_SEARCH_API_KEY, keys.brave);
  assert.equal(Object.keys(saved.values).length, 7);
  if (process.platform !== 'win32') assert.equal((await stat(settingsFile(folder))).mode & 0o777, 0o600);
  const restarted = {};
  assert.equal(loadSavedSettings(restarted, folder).length, 7);
  assert.equal(restarted.AZURE_OPENAI_DEPLOYMENT, 'mini');

  // Removing a service forgets its settings here and in the file, without asking the service.
  const removed = await call('setup/services', post({ service: 'recognition', remove: true }, token));
  assert.equal(removed.data.services[0].state, 'unset');
  assert.equal(env.AZURE_OPENAI_API_KEY, undefined);
  assert.deepEqual(
    Object.keys(readSettings(folder).values).filter((name) => name.startsWith('AZURE_OPENAI')),
    [],
  );
  assert.equal(requests.length, 4);
});

test('a key the service refuses, or an address that is not the service, saves nothing', async (t) => {
  let reply = () => new Response('{}', { status: 401 });
  const { call, token, requests, env, folder } = await newLibrary(t, { answer: (url) => reply(url) });
  const save = (service, values) => call('setup/services', post({ service, values }, token));
  const untouched = () => {
    assert.equal(readSettings(folder), null);
    for (const name of [
      'AZURE_OPENAI_API_KEY',
      'AZURE_VISION_KEY',
      'GOOGLE_BOOKS_API_KEY',
      'BRAVE_SEARCH_API_KEY',
    ])
      assert.equal(env[name], undefined);
  };

  let refused = await save('googleBooks', { GOOGLE_BOOKS_API_KEY: 'wrong' });
  assert.deepEqual([refused.status, refused.data], [400, { error: 'serviceCheck', status: 401 }]);
  reply = () => new Response('{}', { status: 429 });
  refused = await save('braveSearch', { BRAVE_SEARCH_API_KEY: 'spent' });
  assert.deepEqual(refused.data, { error: 'serviceCheck', status: 429 });
  // No answer at all is reported as status 0.
  reply = () => {
    throw new Error('offline');
  };
  refused = await save('recognition', modelValues);
  assert.deepEqual(refused.data, { error: 'serviceCheck', status: 0 });
  assert.equal(requests.length, 3);
  untouched();

  // A key is only ever sent to the service it belongs to: these never leave the computer.
  for (const [service, values, name] of [
    [
      'recognition',
      { ...modelValues, AZURE_OPENAI_ENDPOINT: 'https://example.org' },
      'AZURE_OPENAI_ENDPOINT',
    ],
    [
      'recognition',
      { ...modelValues, AZURE_OPENAI_ENDPOINT: 'http://library-test.openai.azure.com' },
      'AZURE_OPENAI_ENDPOINT',
    ],
    ['recognition', { ...modelValues, AZURE_OPENAI_DEPLOYMENT: 'a/b' }, 'AZURE_OPENAI_DEPLOYMENT'],
    ['recognition', { ...modelValues, AZURE_OPENAI_API_KEY: undefined }, 'AZURE_OPENAI_API_KEY'],
    [
      'textDetection',
      { AZURE_VISION_ENDPOINT: 'https://library-test.openai.azure.com', AZURE_VISION_KEY: 'k' },
      'AZURE_VISION_ENDPOINT',
    ],
    ['googleBooks', { GOOGLE_BOOKS_API_KEY: 'two words' }, 'GOOGLE_BOOKS_API_KEY'],
    ['googleBooks', { GOOGLE_BOOKS_API_KEY: 7 }, 'GOOGLE_BOOKS_API_KEY'],
    ['braveSearch', { BRAVE_SEARCH_API_KEY: 'k'.repeat(301) }, 'BRAVE_SEARCH_API_KEY'],
    ['braveSearch', undefined, 'BRAVE_SEARCH_API_KEY'],
  ]) {
    const malformed = await save(service, values);
    assert.deepEqual([malformed.status, malformed.data], [400, { error: 'serviceValue', name }], name);
  }
  for (const service of ['unknown', 'constructor', undefined])
    assert.deepEqual((await save(service, {})).data, { error: 'invalid' });
  assert.equal(requests.length, 3);
  untouched();
});

test('after set-up only the signed-in parent can change service keys', async (t) => {
  const { call, signin, token, generated, env } = await newLibrary(t);
  await call('setup/finish', post({}, token));
  const change = { service: 'recognition', values: modelValues };
  assert.equal((await call('setup/services', post(change, token))).status, 404);
  assert.equal((await call('admin/services', { method: 'PATCH', data: change })).status, 401);
  const child = await signin('copil', generated.child);
  assert.equal((await call('admin/services', { method: 'PATCH', data: change, cookie: child })).status, 403);
  assert.equal(env.AZURE_OPENAI_API_KEY, undefined);

  const parent = await signin('parinte', generated.parent);
  let settings = (await call('admin/settings', { cookie: parent })).data;
  assert.equal(settings.usage.configured, false);
  assert.equal(settings.services.find((service) => service.id === 'recognition').state, 'unset');
  const saved = await call('admin/services', { method: 'PATCH', data: change, cookie: parent });
  assert.equal(saved.status, 200);
  assert(!JSON.stringify(saved.data).includes(modelValues.AZURE_OPENAI_API_KEY));
  // Recognition can now be switched on, without starting the library again.
  settings = (await call('admin/settings', { cookie: parent })).data;
  assert.equal(settings.usage.configured, true);
  assert.equal(settings.services[0].state, 'set');
  assert(!JSON.stringify(settings).includes(modelValues.AZURE_OPENAI_API_KEY));
  assert.equal(
    (await call('admin/settings', { method: 'PATCH', data: { enabled: true }, cookie: parent })).status,
    200,
  );
});

test('settings from the shell or .env win over saved ones and cannot be changed from the app', async (t) => {
  const { call, token, requests, env, folder } = await newLibrary(t, {
    env: { BRAVE_SEARCH_API_KEY: 'from-the-shell', AZURE_OPENAI_DEPLOYMENT: 'from-the-shell' },
    outside: new Set(['BRAVE_SEARCH_API_KEY', 'AZURE_OPENAI_DEPLOYMENT']),
  });
  const services = (await call('setup/state', { token })).data.services;
  assert.deepEqual(
    services.map((service) => [service.id, service.state, service.fixed]),
    [
      ['recognition', 'partial', true],
      ['textDetection', 'unset', false],
      ['googleBooks', 'unset', false],
      ['braveSearch', 'set', true],
    ],
  );
  for (const body of [
    { service: 'braveSearch', values: { BRAVE_SEARCH_API_KEY: 'from-the-app' } },
    { service: 'braveSearch', remove: true },
    { service: 'recognition', values: modelValues },
  ]) {
    const refused = await call('setup/services', post(body, token));
    assert.deepEqual([refused.status, refused.data.error], [409, 'serviceFixed']);
  }
  assert.equal(env.BRAVE_SEARCH_API_KEY, 'from-the-shell');
  assert.equal(requests.length, 0);

  // At start, a saved setting fills in only what the shell and `.env` left unset.
  writeSettings(folder, {
    setup: 'done',
    values: { BRAVE_SEARCH_API_KEY: 'saved', GOOGLE_BOOKS_API_KEY: 'saved', PORT: '1', AZURE_VISION_KEY: '' },
  });
  const started = { BRAVE_SEARCH_API_KEY: 'from-the-shell', GOOGLE_BOOKS_API_KEY: '' };
  assert.deepEqual(loadSavedSettings(started, folder), ['GOOGLE_BOOKS_API_KEY']);
  assert.deepEqual(started, { BRAVE_SEARCH_API_KEY: 'from-the-shell', GOOGLE_BOOKS_API_KEY: 'saved' });
});

test('the health check names saved settings without their values, and explains a damaged file', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'pince-setup-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const line = async () =>
    (await report({ LIBRARY_LOCAL_DIR: folder, PORT: '0' })).find(
      (check) => check.name === 'Settings saved in the app',
    );
  assert.equal(readSettings(folder), null);
  assert.deepEqual(loadSavedSettings({}, folder), []);
  assert.equal((await line()).state, 'note');

  const key = 'google-key-' + randomUUID();
  writeSettings(folder, { setup: 'pending', values: { GOOGLE_BOOKS_API_KEY: key } });
  assert.equal(readSettings(folder).setup, 'pending');
  const checks = await report({ LIBRARY_LOCAL_DIR: folder, PORT: '0' });
  assert.deepEqual(await line(), {
    state: 'ok',
    name: 'Settings saved in the app',
    detail: 'Supply GOOGLE_BOOKS_API_KEY',
  });
  assert.equal(checks.find((check) => check.name === 'Google Books').detail, 'Set.');
  assert(!JSON.stringify(checks).includes(key));

  await writeFile(settingsFile(folder), '{ not json');
  assert.throws(() => readSettings(folder), /cannot be read/);
  const damaged = await line();
  assert.equal(damaged.state, 'problem');
  assert.match(damaged.detail, /settings\.json cannot be read/);
});

test('a key for an Azure service only goes to an HTTPS address of that service', () => {
  for (const good of [
    'https://library-test.openai.azure.com',
    'https://library-test.cognitiveservices.azure.com/',
    'https://library-test.services.ai.azure.com/models',
  ])
    assert(validModelEndpoint(good), good);
  assert(validTextEndpoint('https://pince-ocr-test.cognitiveservices.azure.com/'));
  for (const bad of [
    'http://library-test.openai.azure.com',
    'https://openai.azure.com.example.org',
    'https://user:pw@library-test.openai.azure.com',
    'https://library-test.openai.azure.com:8443',
    'not an address',
    '',
    undefined,
  ]) {
    assert(!validModelEndpoint(bad), String(bad));
    assert(!validTextEndpoint(bad), String(bad));
  }
  assert(!validTextEndpoint('https://library-test.openai.azure.com'));
});
