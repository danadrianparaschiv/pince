import test from 'node:test';
import assert from 'node:assert/strict';
import { AzureStore } from '../api/src/azure-store.js';
import { change } from '../api/src/store.js';
import { tempStore } from './helpers.js';

// The API talks to storage through one small interface. Both implementations must behave the
// same way: SQLite on a computer, and Azure Table, Blob and Queue Storage when deployed.
// The Azure one runs here against in-memory stand-ins for the three Azure clients.

const failure = (statusCode, code) =>
  Object.assign(new Error(code || String(statusCode)), { statusCode, code });

function azureWithStandIns() {
  // The local-emulator connection string builds the clients without contacting anything.
  const store = new AzureStore('UseDevelopmentStorage=true');
  const rows = new Map(),
    blobs = new Map(),
    sent = [];
  let version = 0;
  const key = (row) => row.partitionKey + '|' + row.rowKey;
  store.table = {
    async getEntity(group, id) {
      const row = rows.get(group + '|' + id);
      if (!row) throw failure(404, 'ResourceNotFound');
      return { ...row };
    },
    async createEntity(row) {
      if (rows.has(key(row))) throw failure(409, 'EntityAlreadyExists');
      rows.set(key(row), { ...row, etag: 'v' + ++version });
    },
    async updateEntity(row, mode, { etag }) {
      assert.equal(mode, 'Replace');
      if (rows.get(key(row))?.etag !== etag) throw failure(412, 'UpdateConditionNotSatisfied');
      rows.set(key(row), { ...row, etag: 'v' + ++version });
    },
    async *listEntities({ queryOptions }) {
      assert.deepEqual(queryOptions.select, ['data']);
      const group = /^PartitionKey eq '([a-z-]+)'$/.exec(queryOptions.filter)[1];
      for (const row of rows.values()) if (row.partitionKey === group) yield { data: row.data };
    },
  };
  store.images = {
    getBlockBlobClient: (name) => ({
      async uploadData(bytes, options) {
        blobs.set(name, { bytes, type: options.blobHTTPHeaders.blobContentType });
      },
      async downloadToBuffer() {
        if (!blobs.has(name)) throw failure(404, 'BlobNotFound');
        return blobs.get(name).bytes;
      },
      async deleteIfExists() {
        blobs.delete(name);
      },
    }),
  };
  store.coverQueue = {
    async sendMessage(text, options) {
      sent.push({ text, options });
    },
  };
  return { store, rows, blobs, sent };
}

const implementations = {
  'SQLite on a computer': async (t) => (await tempStore(t)).store,
  'Azure storage': async () => azureWithStandIns().store,
};

for (const [name, make] of Object.entries(implementations)) {
  test(name + ': records are written only when unchanged since they were read', async (t) => {
    const store = await make(t);
    assert.equal(await store.get('books', 'one'), null);
    assert.equal(await store.cas('books', 'one', undefined, { title: 'Prima' }), true);
    // A second create of the same record loses.
    assert.equal(await store.cas('books', 'one', undefined, { title: 'Alta' }), false);
    const first = await store.get('books', 'one');
    assert.deepEqual(first.value, { title: 'Prima' });
    assert.equal(await store.cas('books', 'one', first.etag, { title: 'A doua' }), true);
    // The etag from before that write is now stale.
    assert.equal(await store.cas('books', 'one', first.etag, { title: 'Pierdută' }), false);
    assert.deepEqual((await store.get('books', 'one')).value, { title: 'A doua' });
  });

  test(name + ': a change retries until it lands, and groups are listed apart', async (t) => {
    const store = await make(t);
    await store.cas('books', 'one', undefined, { count: 0 });
    await store.cas('users', 'one', undefined, { role: 'parent' });
    // Someone else writes between this change's read and its write, once.
    const write = store.cas.bind(store);
    let overtaken = false;
    store.cas = async (...args) => {
      if (!overtaken) {
        overtaken = true;
        assert.equal(
          await write('books', 'one', (await store.get('books', 'one')).etag, { count: 10 }),
          true,
        );
      }
      return write(...args);
    };
    const add = (current) => ({ count: current.count + 1 });
    // The first attempt loses to that write; the retry builds on it instead of overwriting it.
    assert.deepEqual(await change(store, 'books', 'one', add), { count: 11 });
    await Promise.all(Array.from({ length: 5 }, () => change(store, 'books', 'one', add)));
    assert.deepEqual((await store.get('books', 'one')).value, { count: 16 });
    await store.cas('books', 'two', undefined, { count: 9 });
    assert.deepEqual(
      (await store.list('books')).map((row) => row.count).sort((a, b) => a - b),
      [9, 16],
    );
    assert.deepEqual(await store.list('users'), [{ role: 'parent' }]);
    assert.deepEqual(await store.list('scans'), []);
  });

  test(name + ': images are stored, read back and removed by name', async (t) => {
    const store = await make(t),
      bytes = Buffer.from([255, 216, 255, 1, 2, 3]);
    await store.putImage('book-cover.jpg', bytes);
    assert.deepEqual(Buffer.from(await store.getImage('book-cover.jpg')), bytes);
    await store.deleteImage('book-cover.jpg');
    await assert.rejects(store.getImage('book-cover.jpg'));
    // Removing an image that is already gone is not an error.
    await store.deleteImage('book-cover.jpg');
  });
}

test('Azure storage: failures other than "not there" and "changed" are passed on, never hidden', async () => {
  const { store } = azureWithStandIns();
  // A missing table is a broken deployment, not an empty library.
  store.table.getEntity = async () => {
    throw failure(404, 'TableNotFound');
  };
  await assert.rejects(store.get('books', 'one'), { code: 'TableNotFound' });
  store.table.getEntity = async () => {
    throw failure(503, 'ServerBusy');
  };
  await assert.rejects(store.get('books', 'one'), { statusCode: 503 });
  store.table.createEntity = async () => {
    throw failure(403, 'AuthorizationFailure');
  };
  await assert.rejects(store.cas('books', 'one', undefined, {}), { statusCode: 403 });
});

test('Azure storage: covers are saved as JPEG, and a cover job is queued as a week-long message', async () => {
  const { store, blobs, sent } = azureWithStandIns();
  await store.putImage('a.jpg', Buffer.from([1]));
  assert.equal(blobs.get('a.jpg').type, 'image/jpeg');
  const job = { id: 'book', token: 'secret-for-this-job' };
  await store.enqueueCover(job);
  await store.enqueueCover(job, 60);
  assert.deepEqual(
    sent.map((message) => message.options),
    [
      { visibilityTimeout: 0, messageTimeToLive: 604800 },
      { visibilityTimeout: 60, messageTimeToLive: 604800 },
    ],
  );
  // The worker decodes the same shape.
  assert.deepEqual(JSON.parse(Buffer.from(sent[0].text, 'base64').toString('utf8')), job);
});
