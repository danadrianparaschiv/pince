import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { addBooks } from '../api/src/books.js';
import { usage } from '../api/src/scans.js';
import { modelSettings as modelEnv, picture as plainPicture, sharp, startLibrary } from './helpers.js';

const setup = (t, env = {}, model) => startLibrary(t, { env, model });
// Uploaded with camera-style metadata, which the server must drop.
const picture = () => plainPicture({ metadata: true });

test('family roles, private sessions, cross-origin writes and account revocation', async (t) => {
  const { call, signin, env } = await setup(t);
  assert.equal((await call('books')).status, 401);
  const session = (
    await call('login', 'POST', { username: 'parinte', password: env.BOOTSTRAP_PARENT_PASSWORD })
  ).headers.get('set-cookie');
  for (const attribute of [/HttpOnly/, /Secure/, /SameSite=Lax/, /Path=\/api/])
    assert.match(session, attribute);
  const c = await signin('copil'),
    p = await signin();
  assert.equal((await call('admin/settings', 'GET', undefined, c)).status, 403);
  assert.equal(
    (await call('me', 'PATCH', { language: 'en' }, c, { Origin: 'https://external.test' })).status,
    403,
  );
  assert.equal((await call('me', 'PATCH', { language: 'en' }, c)).data.user.language, 'en');
  assert.equal((await call('me', 'GET', undefined, c)).data.user.language, 'en');
  const accounts = await call('admin/settings', 'GET', undefined, p);
  assert.equal(accounts.data.users.length, 2);
  assert.equal(JSON.stringify(accounts.data).includes(env.BOOTSTRAP_PARENT_PASSWORD), false);
  assert.equal((await call('admin/accounts', 'PATCH', { username: 'copil', enabled: false }, p)).status, 200);
  assert.equal((await call('books', 'GET', undefined, c)).status, 401);
  assert.equal(
    (await call('login', 'POST', { username: 'copil', password: env.BOOTSTRAP_CHILD_PASSWORD })).status,
    401,
  );
  assert.equal(
    (await call('admin/accounts', 'PATCH', { username: 'parinte', enabled: false }, p)).status,
    400,
  );
  await call('logout', 'POST', {}, p);
  assert.equal((await call('books', 'GET', undefined, p)).status, 401);
});

test('managed API accepts its public site origin but not a forged forwarding header', async (t) => {
  const origin = 'https://family.example';
  const { call, env } = await setup(t, { PUBLIC_APP_ORIGIN: origin });
  const body = { username: 'parinte', password: env.BOOTSTRAP_PARENT_PASSWORD };
  assert.equal((await call('login', 'POST', body, undefined, { Origin: origin })).status, 200);
  assert.equal(
    (
      await call('login', 'POST', body, undefined, {
        Origin: 'https://other.example',
        'X-Forwarded-Host': 'other.example',
      })
    ).status,
    403,
  );
});

test('public projection, real image validation, optimistic merging, idempotent imports and deletion', async (t) => {
  const { call, signin } = await setup(t);
  const p = await signin(),
    c = await signin('copil');
  const row = {
    id: randomUUID(),
    title: 'Micul Prinț',
    authors: 'Antoine de Saint-Exupéry',
    coverData: await picture(),
  };
  const add = () => call('books', 'POST', { books: [row] }, c);
  const [a, b] = await Promise.all([add(), add()]);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  const start = a.data.books[0];
  assert.equal(b.data.books[0].cover, start.cover);
  // Saved with its own picture, the book is not searched for other covers until someone asks.
  assert.equal(start.coverLookup, null);
  assert.equal((await call('books', 'GET', undefined, c)).data.books.length, 1);
  assert.equal((await call('books', 'POST', { books: [{ id: randomUUID(), title: '  ' }] }, c)).status, 400);
  assert.equal(
    (
      await call(
        'books',
        'POST',
        { books: [{ id: randomUUID(), title: 'X', coverData: 'data:image/jpeg;base64,PHN2Zz4=' }] },
        c,
      )
    ).status,
    400,
  );
  const endpoint = 'books/' + row.id;
  const patch = (changes, base) => call(endpoint, 'PATCH', { changes, base }, c);
  const [note, flag] = await Promise.all([
    patch({ note: 'Private\nnotes' }, { note: '' }),
    patch({ favorite: true }, { favorite: false }),
  ]);
  assert.equal(note.status, 200);
  assert.equal(flag.status, 200);
  const conflict = await patch({ note: 'Draft' }, { note: '' });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.data.book.note, 'Private\nnotes');
  assert.equal(conflict.data.book.favorite, true);
  const pub = (await call('public/' + row.id)).data.book;
  assert.deepEqual(Object.keys(pub).sort(), ['authors', 'cover', 'id', 'title']);
  const photo = await call(pub.cover.slice(5));
  assert.equal(photo.status, 200);
  const meta = await sharp(photo.data).metadata();
  assert.equal(meta.format, 'jpeg');
  assert.equal(meta.exif, undefined);
  assert.equal((await call(pub.cover.slice(5) + '/thumb')).status, 200);
  assert.equal((await call(endpoint, 'DELETE', { version: conflict.data.book.version }, c)).status, 403);
  assert.equal((await call(endpoint, 'DELETE', { version: start.version }, p)).status, 409);
  assert.equal((await call(endpoint, 'DELETE', { version: conflict.data.book.version }, p)).status, 200);
  assert.equal((await call('public/' + row.id)).status, 404);
  assert.equal((await call(pub.cover.slice(5))).status, 404);
  assert.equal((await add()).status, 409); // A stale create retry cannot resurrect it.
  const restore = {
    ...row,
    note: 'Private\nnotes',
    favorite: true,
    read: true,
    createdAt: start.createdAt,
  };
  const rr = await call('admin/restore', 'POST', { books: [restore] }, p);
  assert.equal(rr.data.books[0].note, restore.note);
  assert.equal(rr.data.books[0].createdAt, start.createdAt);
  assert.equal((await call('public/' + row.id)).data.book.title, row.title);
});

test('recognition caps survive concurrent requests and retries; settlement uses billed tokens', async (t) => {
  let calls = 0;
  const answer = async () => {
    calls++;
    return {
      usage: { prompt_tokens: 4000, completion_tokens: 1000 },
      choices: [
        {
          message: {
            content: JSON.stringify({
              books: [
                {
                  title: 'Șapte povești',
                  authors: '',
                  publisher: 'RAO',
                  publishedDate: '4–7 ani',
                  rawText: 'Șapte povești RAO 4–7 ani',
                  series: 'Povești',
                  volume: '8',
                },
              ],
            }),
          },
        },
      ],
    };
  };
  // Isolate the $1.50 model cap from the configurable combined-cost cutoff.
  const { call, signin, store, env } = await setup(
    t,
    { ...modelEnv, AZURE_MONTHLY_RESERVE_USD: '0.28' },
    answer,
  );
  const p = await signin(),
    image = await picture(),
    day = new Date().toISOString().slice(0, 10);
  const run = (requestId = randomUUID()) => call('scan', 'POST', { requestId, mode: 'shelf', image }, p);
  assert.equal((await run()).data.error, 'scanDisabled');
  await call('admin/settings', 'PATCH', { enabled: true }, p);
  let ledger = await store.get('system', 'spending');
  await store.cas('system', 'spending', ledger.etag, { enabled: true, days: { [day]: 1_490_500 } });
  const ids = [randomUUID(), randomUUID()];
  const results = await Promise.all(ids.map(run));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 429]);
  assert.equal(calls, 1);
  const successful = results.findIndex((r) => r.status === 200);
  const replay = await run(ids[successful]);
  assert.deepEqual(replay.data, {
    books: [
      {
        position: 1,
        title: 'Șapte povești',
        authors: '',
        publisher: 'RAO',
        publishedDate: '',
        rawText: 'Șapte povești RAO 4–7 ani',
        series: 'Povești',
        volume: '8',
        confidence: 'medium',
        note: '',
      },
    ],
    unreadable: 0,
    more: 0,
    partial: false,
    shelfPhoto: ids[successful],
  });
  assert.equal(calls, 1);
  ledger = await store.get('system', 'spending');
  assert.equal(ledger.value.days[day], 1_493_500);
  const now = new Date();
  now.setUTCDate(1);
  now.setUTCMonth(now.getUTCMonth() - 1);
  await store.cas('system', 'spending', ledger.etag, {
    enabled: true,
    days: { [now.toISOString().slice(0, 10)]: 11_999_000 },
  });
  assert.equal((await run()).data.error, 'budget');
  assert.equal(calls, 1);
  assert.equal((await call('admin/settings', 'PATCH', { monthlyInfrastructure: 2 }, p)).status, 200);
  ledger = await store.get('system', 'spending');
  assert(usage(ledger.value, env).totalMonth >= 2.25);
  assert.equal((await run()).data.error, 'budget');
  const manual = await call(
    'books',
    'POST',
    { books: [{ id: randomUUID(), title: 'A Wrinkle in Time' }] },
    p,
  );
  assert.equal(manual.status, 201);
});

test('provider timeout retains the reservation and does not retry the external call', async (t) => {
  let calls = 0;
  const { call, signin } = await setup(t, modelEnv, async () => {
    calls++;
    throw Error('timeout');
  });
  const p = await signin();
  await call('admin/settings', 'PATCH', { enabled: true }, p);
  const body = { requestId: randomUUID(), mode: 'cover', image: await picture() };
  assert.equal((await call('scan', 'POST', body, p)).status, 503);
  assert.equal((await call('scan', 'POST', body, p)).status, 503);
  assert.equal(calls, 1);
  const stats = (await call('admin/settings', 'GET', undefined, p)).data.usage;
  assert.equal(stats.month, 0.0035);
});

test('500 persistent books and three simultaneous family catalog requests', async (t) => {
  const { call, signin, store } = await setup(t);
  const sessions = await Promise.all([signin(), signin('copil'), signin()]);
  for (let i = 0; i < 25; i++)
    await addBooks(
      store,
      Array.from({ length: 20 }, (_, j) => ({
        id: randomUUID(),
        title: 'Cartea ' + (20 * i + j),
        authors: 'Autor',
      })),
    );
  const pages = await Promise.all(sessions.map((cookie) => call('books', 'GET', undefined, cookie)));
  assert(pages.every((p) => p.status === 200 && p.data.books.length === 500));
});

test('real scan request schema and cost holds use the same mode-specific output limit', async (t) => {
  const { call, signin } = await setup(t, modelEnv);
  const cookie = await signin(),
    image = await picture();
  await call('admin/settings', 'PATCH', { enabled: true }, cookie);
  const text = ['authors', 'publishedDate', 'publisher', 'rawText', 'series', 'title', 'volume'];
  for (const [mode, maxTokens, fields] of [
    ['cover', 1000, text],
    ['shelf', 4000, [...text, 'confidence', 'note'].sort()],
    ['covers', 4000, [...text, 'confidence', 'note'].sort()],
  ]) {
    const fetchMock = t.mock.method(globalThis, 'fetch', async (_url, options) => {
      const request = JSON.parse(options.body);
      assert.equal(request.max_completion_tokens, maxTokens);
      const schema = request.response_format.json_schema.schema.properties.books.items;
      assert.deepEqual(schema.required.sort(), fields);
      assert.deepEqual(Object.keys(schema.properties).sort(), schema.required);
      return Response.json({
        choices: [{ finish_reason: 'length', message: { content: JSON.stringify({ books: [] }) } }],
      });
    });
    const result = await call('scan', 'POST', { mode, image, requestId: randomUUID() }, cookie);
    assert.equal(result.status, 503);
    assert.equal(fetchMock.mock.callCount(), 1);
    // Assertions thrown inside fetch would also surface as scanUnavailable.
    assert.equal(fetchMock.mock.calls[0].error, undefined);
    await fetchMock.mock.calls[0].result;
    fetchMock.mock.restore();
  }
  const settings = await call('admin/settings', 'GET', undefined, cookie);
  assert.equal(settings.data.usage.month, 0.0225);
});

test('a parent deletes books in bulk; changed books are kept and repeats are harmless', async (t) => {
  const { call, signin, store } = await setup(t);
  const p = await signin(),
    c = await signin('copil');
  const ids = Array.from({ length: 22 }, () => randomUUID());
  for (const part of [ids.slice(0, 20), ids.slice(20)])
    await call('books', 'POST', { books: part.map((id, i) => ({ id, title: 'Cartea ' + i })) }, p);
  const withCover = (
    await call(
      'books',
      'POST',
      { books: [{ id: randomUUID(), title: 'Cu copertă', coverData: await picture() }] },
      p,
    )
  ).data.books[0];
  const rows = ids.map((id) => ({ id, version: 1 }));
  assert.equal((await call('books/delete', 'POST', { books: rows.slice(0, 2) }, c)).status, 403);
  assert.equal((await call('books/delete', 'POST', { books: rows.slice(0, 2) })).status, 401);
  for (const bad of [
    [],
    rows.slice(0, 21),
    [{ id: 'nope', version: 1 }],
    [{ id: ids[0] }],
    [rows[0], rows[0]],
    'all',
  ])
    assert.equal((await call('books/delete', 'POST', { books: bad }, p)).status, 400);
  assert.equal((await call('books', 'GET', undefined, p)).data.books.length, 23);

  // The child marks one book read after the parent loaded the list.
  await call('books/' + ids[1], 'PATCH', { changes: { read: true }, base: { read: false } }, c);
  const first = await call(
    'books/delete',
    'POST',
    { books: [...rows.slice(0, 5), { id: withCover.id, version: withCover.version }] },
    p,
  );
  assert.equal(first.status, 200);
  assert.deepEqual(first.data.deleted, [ids[0], ids[2], ids[3], ids[4], withCover.id]);
  assert.deepEqual(
    first.data.conflicts.map((b) => [b.id, b.read, b.version]),
    [[ids[1], true, 2]],
  );
  assert.equal((await call(withCover.cover.replace('/api/', ''), 'GET', undefined, p)).status, 404);
  assert.equal((await call('public/' + ids[0])).status, 404);
  assert.equal((await store.get('books', ids[0])).value.deleted, true);

  // A lost response is retried with the same rows plus the refreshed one.
  const again = await call(
    'books/delete',
    'POST',
    { books: [...rows.slice(0, 1), { id: ids[1], version: 2 }] },
    p,
  );
  assert.deepEqual(again.data, { deleted: [ids[0], ids[1]], conflicts: [] });
  const left = (await call('books', 'GET', undefined, p)).data.books;
  assert.equal(left.length, 17);
  assert(left.every((b) => ids.slice(5).includes(b.id)));
});

test('scanned shelf photos are kept for the family, linked from saved books, and removable by the parent', async (t) => {
  const shelfRows = {
    books: [
      {
        title: 'Florile',
        authors: '',
        publisher: '',
        publishedDate: '',
        rawText: 'Florile',
        series: '',
        volume: '',
        confidence: 'high',
        note: '',
      },
    ],
    unreadable: 0,
    more: 0,
  };
  const { call, signin, store } = await setup(t, modelEnv, async () => ({
    usage: { prompt_tokens: 4000, completion_tokens: 300 },
    choices: [{ message: { content: JSON.stringify(shelfRows) } }],
  }));
  const p = await signin(),
    c = await signin('copil');
  await call('admin/settings', 'PATCH', { enabled: true }, p);
  const image = await picture();
  const cover = await call('scan', 'POST', { requestId: randomUUID(), mode: 'cover', image }, p);
  assert.equal(cover.data.shelfPhoto, undefined);
  assert.deepEqual((await call('shelf-photos', 'GET', undefined, p)).data.photos, []);

  const scanId = randomUUID();
  const scanned = await call('scan', 'POST', { requestId: scanId, mode: 'shelf', image }, c);
  assert.equal(scanned.data.shelfPhoto, scanId);
  const url = 'shelf-photos/' + scanId;
  // Family members see the photo; signed-out readers never do, and it is not reachable as a cover.
  const bytes = await call(url, 'GET', undefined, c);
  assert.equal(bytes.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(
    [(await sharp(bytes.data).metadata()).width, bytes.headers.get('cache-control')],
    [64, 'private, no-store'],
  );
  assert.equal((await call(url)).status, 401);
  assert.equal((await call('covers/' + scanId + '/' + scanId)).status, 404);
  assert.equal((await call('shelf-photos/' + randomUUID(), 'GET', undefined, p)).status, 404);
  assert.equal((await call('shelf-photos', 'GET', undefined, c)).status, 403);

  const place = { x: 0.61234567, y: 0.4, w: 0.3, h: 0.02, angle: -1.5708 };
  const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const saved = await call(
    'books',
    'POST',
    {
      books: [
        { id: ids[0], title: 'Florile', shelfPhoto: scanId, shelfPlace: place },
        { id: ids[1], title: 'Insectele', shelfPhoto: scanId, shelfPlace: { ...place, x: 7 } },
        { id: ids[2], title: 'Din altă bibliotecă', shelfPhoto: randomUUID(), shelfPlace: place },
        { id: ids[3], title: 'Scrisă de mână' },
      ],
    },
    c,
  );
  assert.equal(saved.status, 201);
  assert.deepEqual(
    saved.data.books.map((b) => b.shelfPhoto),
    [
      { id: scanId, url: '/api/' + url, place: { x: 0.6123, y: 0.4, w: 0.3, h: 0.02, angle: -1.5708 } },
      { id: scanId, url: '/api/' + url, place: null },
      null,
      null,
    ],
  );
  assert.equal(
    (await call('books', 'POST', { books: [{ id: randomUUID(), title: 'X', shelfPhoto: 'nope' }] }, c))
      .status,
    400,
  );
  assert.equal('shelfPhoto' in (await call('public/' + ids[0])).data.book, false);
  // An edit keeps the link.
  const edited = await call(
    'books/' + ids[0],
    'PATCH',
    { changes: { read: true }, base: { read: false } },
    c,
  );
  assert.equal(edited.data.book.shelfPhoto.id, scanId);

  const listed = (await call('shelf-photos', 'GET', undefined, p)).data.photos;
  assert.deepEqual(
    listed.map((x) => [x.id, x.books, x.width, x.height, x.url]),
    [[scanId, 2, 64, 80, '/api/' + url]],
  );
  assert.equal((await call(url, 'DELETE', {}, c)).status, 403);
  assert.equal((await call(url, 'DELETE', {}, p)).status, 200);
  assert.equal((await call(url, 'GET', undefined, p)).status, 404);
  assert.equal((await call(url, 'DELETE', {}, p)).status, 404);
  await assert.rejects(store.getImage('shelf-' + scanId + '.jpg'));
  const after = (await call('books', 'GET', undefined, p)).data.books;
  assert.deepEqual(
    after.map((b) => b.shelfPhoto),
    [null, null, null, null],
  );
  assert.equal(after.find((b) => b.id === ids[0]).read, true);
  // A backup that still names the deleted photo restores the book without the link.
  await call('books/' + ids[0], 'DELETE', { version: after.find((b) => b.id === ids[0]).version }, p);
  const restored = await call(
    'admin/restore',
    'POST',
    {
      books: [
        {
          id: ids[0],
          title: 'Florile',
          createdAt: new Date().toISOString(),
          shelfPhoto: scanId,
          shelfPlace: place,
        },
      ],
    },
    p,
  );
  assert.equal(restored.data.books[0].shelfPhoto, null);
});

test('an unexpected storage failure is answered as "storage" and logged without any request details', async (t) => {
  const { call, signin, store } = await setup(t);
  const p = await signin();
  const logged = t.mock.method(console, 'error', () => {});
  store.list = async () => {
    throw Object.assign(new Error('connection detail that must stay private'), {
      name: 'RestError',
      statusCode: 500,
    });
  };
  const result = await call('books', 'GET', undefined, p);
  assert.deepEqual([result.status, result.data], [503, { error: 'storage' }]);
  assert.deepEqual(
    logged.mock.calls.map((entry) => entry.arguments),
    [['Library request failed', 'RestError', 500]],
  );
});
