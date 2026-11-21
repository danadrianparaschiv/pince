// Shared building blocks for the tests: a throwaway store, a running copy of the API, and pictures.
// Everything here is local and offline. See test/README.md for how the suite is organised.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { LocalStore } from '../scripts/local-store.js';
import { makeApp } from '../api/src/app.js';

/** The image library the API itself uses, for building and inspecting test pictures. */
export const sharp = createRequire(new URL('../api/package.json', import.meta.url))('sharp');

/** Settings that make the API treat photo recognition as configured. The model itself is a stand-in. */
export const modelSettings = {
  AZURE_OPENAI_ENDPOINT: 'https://library-test.openai.azure.com',
  AZURE_OPENAI_DEPLOYMENT: 'mini',
  AZURE_OPENAI_API_KEY: 'test-only',
};

/**
 * A real SQLite store in a temporary folder, removed when the test ends.
 * Cover lookups it is asked to queue are collected in `queue` instead of being run.
 */
export async function tempStore(t) {
  const directory = await mkdtemp(join(tmpdir(), 'pince-test-'));
  const store = new LocalStore(directory),
    queue = [];
  store.enqueueCover = async (job, seconds = 0) => queue.push({ ...job, seconds });
  t.after(async () => {
    store.db.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { store, queue };
}

/** JPEG bytes of a plain rectangle. `metadata` keeps the kind of embedded data a camera adds. */
export async function jpeg({ width = 64, height = 80, background = '#407261', metadata = false } = {}) {
  const image = sharp({ create: { width, height, channels: 3, background } }).jpeg();
  return (metadata ? image.withMetadata() : image).toBuffer();
}
export const dataUrl = (bytes) => 'data:image/jpeg;base64,' + bytes.toString('base64');
/** A small cover picture as the browser would upload it. */
export const picture = async (options) => dataUrl(await jpeg(options));

/**
 * The whole API on a temporary store, as deployed: HTTPS, production cookie attributes.
 * `services` replaces the outside world: `model`, `readText` and `reviewProvider` stand-ins.
 *
 * `call(path, method, body, cookie, headers)` sends one request and returns its status, parsed
 * body (bytes for an image) and headers. `signin(username)` returns a session cookie.
 */
export async function startLibrary(
  t,
  { env: settings = {}, origin = 'https://example.test', ...services } = {},
) {
  const { store, queue } = await tempStore(t);
  const env = {
    BOOTSTRAP_PARENT_PASSWORD: randomUUID(),
    BOOTSTRAP_CHILD_PASSWORD: randomUUID(),
    ...settings,
  };
  const handle = makeApp({ store, env, ...services });
  async function call(path, method = 'GET', body, cookie, headers = {}) {
    const response = await handle(
      new Request(origin + '/api/' + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    const data = response.headers.get('content-type')?.startsWith('image/')
      ? Buffer.from(await response.arrayBuffer())
      : await response.json();
    return { status: response.status, data, headers: response.headers };
  }
  async function signin(username = 'parinte') {
    const password = username === 'copil' ? env.BOOTSTRAP_CHILD_PASSWORD : env.BOOTSTRAP_PARENT_PASSWORD;
    const result = await call('login', 'POST', { username, password });
    assert.equal(result.status, 200, 'sign-in as ' + username);
    return result.headers.get('set-cookie').split(';')[0];
  }
  /** Sign the parent in and switch photo recognition on, as a parent would in Family settings. */
  async function parentWithScanning() {
    const cookie = await signin();
    assert.equal((await call('admin/settings', 'PATCH', { enabled: true }, cookie)).status, 200);
    return cookie;
  }
  return { store, queue, env, handle, call, signin, parentWithScanning };
}
