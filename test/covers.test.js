import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { addBooks, editBook, deleteBook, coverBytes, view, getBook } from '../api/src/books.js';
import { requestCovers, runCoverJob, scheduleSaved } from '../api/src/cover-jobs.js';
import { openLibraryCovers } from '../api/src/cover-source.js';
import { picture as plainPicture, sharp, tempStore } from './helpers.js';
const picture = (background) => plainPicture({ width: 100, height: 160, background });
async function setup(t) {
  const { store, queue } = await tempStore(t);
  const red = await picture('#b22f28'),
    blue = await picture('#234daa');
  const provider = async () => [
    { data: red, source: 'openlibrary', sourceId: '1', sourceUrl: 'https://openlibrary.org/works/OL1W' },
    { data: blue, source: 'openlibrary', sourceId: '2', sourceUrl: 'https://openlibrary.org/works/OL1W' },
  ];
  const add = async (data = {}) =>
    (
      await scheduleSaved(
        store,
        await addBooks(store, [{ id: randomUUID(), title: 'Luna mică', authors: 'Mara Pop', ...data }]),
      )
    ).books[0];
  const read = async (id) => view(await getBook(store, id));
  return { store, queue, provider, add, read, red, blue };
}

test('saving a book queues one lookup: its covers become suggestions, the first is chosen, and only the chosen one is public', async (t) => {
  const { store, queue, provider, add, read } = await setup(t),
    b = await add();
  assert.equal(b.cover, null);
  assert.equal(b.coverLookup.status, 'queued');
  assert.equal(queue.length, 1);
  await runCoverJob(store, queue[0], { provider });
  const ready = await read(b.id);
  assert.equal(ready.coverLookup.status, 'ready');
  assert.equal(ready.coverOptions.length, 2);
  assert.equal(ready.cover, ready.coverOptions[0].cover);
  await runCoverJob(store, queue[0], {
    provider: () => {
      throw Error('Must not repeat');
    },
  });
  const other = ready.coverOptions[1].cover;
  await assert.rejects(coverBytes(store, b.id, other.split('/').pop(), false), (e) => e.status === 404);
  assert.ok((await coverBytes(store, b.id, other.split('/').pop(), false, true)).length);
  const edited = await editBook(store, b.id, { changes: { cover: other }, base: { cover: ready.cover } });
  assert.equal(edited.cover, other);
  assert.equal(edited.coverOptions.length, 2);
  const current = await read(b.id);
  await deleteBook(store, b.id, current.version);
  assert.deepEqual(await readdir(store.images), []);
});

test('a lookup that finishes late keeps an uploaded cover, a removed cover and edits made meanwhile', async (t) => {
  const { store, queue, provider, add, read, red } = await setup(t);
  const b = await add({ coverData: red }),
    original = b.cover;
  // A book with its own picture is searched only on request.
  assert.equal(queue.length, 0);
  await requestCovers(store, b.id, { retry: true });
  await runCoverJob(store, queue[0], {
    provider: async () => {
      await editBook(store, b.id, {
        changes: { note: 'Keep my note', favorite: true },
        base: { note: '', favorite: false },
      });
      return provider();
    },
  });
  const ready = await read(b.id);
  assert.equal(ready.cover, original);
  assert.equal(ready.coverOptions.length, 3);
  assert.equal(ready.note, 'Keep my note');
  assert.equal(ready.favorite, true);
  const c = await add();
  await runCoverJob(store, queue[1], {
    provider: async () => {
      await editBook(store, c.id, { changes: { cover: null }, base: { cover: null } });
      return provider();
    },
  });
  assert.equal((await read(c.id)).cover, null);
  assert.equal((await read(c.id)).coverOptions.length, 2);
});

test("a book showing the reader's own picture is searched for covers only when asked", async (t) => {
  const { store, queue, provider, add, read, red, blue } = await setup(t);
  const edit = async (book, changes, base) =>
    (await scheduleSaved(store, { books: [await editBook(store, book.id, { changes, base })] })).books[0];

  // Saved with a photo of its cover: nothing is queued, then or when its details are corrected.
  const own = await add({ coverData: red });
  assert.ok(own.cover);
  assert.equal(own.coverLookup, null);
  const renamed = await edit(own, { title: 'Luna cea mică' }, { title: own.title });
  assert.equal(renamed.coverLookup, null);
  assert.equal(queue.length, 0);

  // Asking is all it takes. The two pictures found sit beside the photo, which stays the cover.
  const asked = await requestCovers(store, own.id, { retry: true });
  assert.equal(asked.coverLookup.status, 'queued');
  assert.equal(queue.length, 1);
  await runCoverJob(store, queue[0], { provider });
  const found = await read(own.id);
  assert.equal(found.cover, own.cover);
  assert.equal(found.coverOptions.length, 3);
  // Having been asked once does not make later searches automatic.
  await edit(found, { authors: 'Mara Popa' }, { authors: found.authors });
  assert.equal(queue.length, 1);

  // A book saved without a cover is still searched by itself, and takes the first cover found.
  const bare = await add({ title: 'Soarele mare' });
  assert.equal(bare.coverLookup.status, 'queued');
  assert.equal(queue.length, 2);
  await runCoverJob(store, queue[1], { provider });
  const web = await read(bare.id);
  assert.equal(web.cover, web.coverOptions[0].cover);
  // While a found cover is the chosen one, a corrected title is searched again.
  assert.equal(
    (await edit(web, { title: 'Soarele cel mare' }, { title: web.title })).coverLookup.status,
    'queued',
  );
  assert.equal(queue.length, 3);
  await runCoverJob(store, queue[2], { provider });

  // Once the reader uploads their own picture, the searches stop; removing it brings them back.
  const now = await read(bare.id);
  const uploaded = await edit(now, { cover: blue }, { cover: now.cover });
  assert.equal(uploaded.coverOptions.find((c) => c.cover === uploaded.cover).source, 'upload');
  await edit(uploaded, { title: 'Soarele' }, { title: uploaded.title });
  assert.equal(queue.length, 3);
  const mine = await read(bare.id);
  // The title changed while the picture was the reader's own, so the search starts at once.
  const removed = await edit(mine, { cover: null }, { cover: mine.cover });
  assert.equal(removed.cover, null);
  assert.equal(removed.coverLookup.status, 'queued');
  assert.equal(queue.length, 4);

  // Restoring a backup follows the same rule: only the book without its own picture is searched.
  const rows = [
    { id: randomUUID(), title: 'Cu fotografie', createdAt: new Date().toISOString(), coverData: red },
    { id: randomUUID(), title: 'Fără copertă', createdAt: new Date().toISOString() },
  ];
  const restored = (await scheduleSaved(store, await addBooks(store, rows, true))).books;
  assert.deepEqual(
    restored.map((b) => b.coverLookup?.status ?? null),
    [null, 'queued'],
  );
  assert.equal(queue.length, 5);
});

test('deleted books and superseded metadata cannot receive stale covers', async (t) => {
  const { store, queue, provider, add, read } = await setup(t),
    b = await add();
  await runCoverJob(store, queue[0], {
    provider: async () => {
      await deleteBook(store, b.id, 1);
      return provider();
    },
  });
  assert.deepEqual(await readdir(store.images), []);
  const c = await add(),
    oldJob = queue[1];
  await runCoverJob(store, oldJob, {
    provider: async () => {
      await editBook(store, c.id, { changes: { title: 'New title' }, base: { title: c.title } });
      await requestCovers(store, c.id);
      return provider();
    },
  });
  assert.equal((await read(c.id)).cover, null);
  assert.equal((await read(c.id)).coverLookup.status, 'queued');
  assert.deepEqual(await readdir(store.images), []);
});

test('a queue failure does not lose the save, retries stop, and finding nothing is a valid result', async (t) => {
  const { store, queue, add, read } = await setup(t);
  const enqueue = store.enqueueCover;
  store.enqueueCover = async () => {
    throw Error('Queue down');
  };
  const b = await add();
  assert.equal((await read(b.id)).title, b.title);
  assert.equal(b.coverLookup.status, 'failed');
  store.enqueueCover = enqueue;
  const c = await add();
  for (let i = 0; i < 3; i++)
    await runCoverJob(store, queue.at(-1), {
      provider: async () => {
        throw Error('Offline');
      },
    });
  assert.equal((await read(c.id)).coverLookup.status, 'failed');
  assert.equal(queue.length, 3);
  const d = await add();
  await runCoverJob(store, queue.at(-1), { provider: async () => [] });
  assert.equal((await read(d.id)).coverLookup.status, 'empty');
});

test('Open Library covers come only from matching works, fixed hosts and distinct pictures', async (t) => {
  const { red, blue } = await setup(t),
    calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    if (url.includes('/search.json'))
      return Response.json({
        docs: [
          { key: '/works/OL1W', title: 'Wrong book', author_name: ['Mara Pop'], cover_i: 5 },
          { key: '/works/OL2W', title: 'Luna mică', author_name: ['Mara Pop'], cover_i: 1 },
        ],
      });
    if (url.includes('/works/OL2W.json')) return Response.json({ covers: [1, 2, 3] });
    if (url.includes('/b/id/'))
      return new Response(Buffer.from((url.includes('/3-') ? blue : red).split(',')[1], 'base64'));
    throw Error('Unexpected URL');
  };
  const found = await openLibraryCovers({ title: 'Luna mica', authors: 'Mara Pop', isbn: '' }, { fetcher });
  assert.equal(found.length, 2);
  assert.deepEqual(
    found.map((x) => x.sourceId),
    ['1', '3'],
  );
  assert.ok(calls.every((u) => ['openlibrary.org', 'covers.openlibrary.org'].includes(new URL(u).hostname)));
  const empty = await openLibraryCovers(
    { title: 'Other', authors: 'Other', isbn: '' },
    {
      fetcher: async () =>
        Response.json({
          docs: [
            { key: 'http://169.254.169.254', title: 'Other', author_name: ['Not the author'], cover_i: 1 },
          ],
        }),
    },
  );
  assert.equal(empty.length, 0);
});

test('a book with an ISBN is looked up by it, and its other editions fill in a second cover', async (t) => {
  const { red, blue } = await setup(t),
    calls = [];
  const bytes = (cover) => Buffer.from(cover.split(',')[1], 'base64');
  const fetcher = async (url) => {
    const { pathname } = new URL(url);
    calls.push(pathname);
    if (pathname === '/isbn/9780142410370.json')
      return Response.json({ covers: [11], works: [{ key: '/works/OL7W' }] });
    if (pathname === '/works/OL7W.json') return Response.json({ covers: [11] });
    // Another edition of the same work has a different picture; a differently titled one is ignored.
    if (pathname === '/works/OL7W/editions.json')
      return Response.json({
        entries: [
          { title: 'Luna mică', covers: [12] },
          { title: 'Soarele mare', covers: [13] },
        ],
      });
    if (pathname === '/b/id/11-L.jpg') return new Response(bytes(red));
    if (pathname === '/b/id/12-L.jpg') return new Response(bytes(blue));
    throw Error('Unexpected request for ' + pathname);
  };
  const book = { title: 'Luna mică', authors: 'Mara Pop', isbn: '978-0-14-241037-0' };
  const found = await openLibraryCovers(book, { fetcher });
  assert.deepEqual(
    found.map((cover) => [cover.sourceId, cover.sourceUrl]),
    [
      ['11', 'https://openlibrary.org/works/OL7W'],
      ['12', 'https://openlibrary.org/works/OL7W'],
    ],
  );
  // The ISBN answered the question: no title search was needed.
  assert.equal(
    calls.some((path) => path === '/search.json'),
    false,
  );

  // An ISBN the catalogue does not know falls back to searching by title and author.
  const searched = [];
  const unknown = await openLibraryCovers(book, {
    fetcher: async (url) => {
      searched.push(new URL(url).pathname);
      return url.includes('/isbn/') ? new Response('', { status: 404 }) : Response.json({ docs: [] });
    },
  });
  assert.deepEqual([unknown, searched], [[], ['/isbn/9780142410370.json', '/search.json']]);
});

test('official archive redirects are allowed; off-site redirects are rejected before a fetch', async (t) => {
  const { red, blue } = await setup(t),
    calls = [];
  const provider =
    (evil, legacy = false) =>
    async (url) => {
      calls.push(url);
      if (url.includes('/search.json'))
        return Response.json({
          docs: [{ key: '/works/OL2W', title: 'Luna mică', author_name: ['Mara Pop'], cover_i: 1 }],
        });
      if (url.includes('/works/OL2W.json')) return Response.json({ covers: [1, 2] });
      const archive = legacy ? 'olcovers638/olcovers638-L.zip' : 'l_covers_0001/l_covers_0001_01.zip';
      // The stand-in answers for exactly these hosts, as the real ones would.
      const host = new URL(url).hostname;
      if (host === 'covers.openlibrary.org')
        return new Response(null, {
          status: 302,
          headers: {
            location: evil
              ? 'https://169.254.169.254/metadata'
              : 'https://archive.org/download/' +
                archive +
                '/000000000' +
                (url.includes('/2-') ? '2' : '1') +
                '-L.jpg',
          },
        });
      if (host === 'archive.org')
        return new Response(null, {
          status: 302,
          headers: {
            location:
              'https://ia800505.us.archive.org/view_archive.php?' +
              new URLSearchParams({ archive: '/14/items/' + archive, file: url.split('/').pop() }),
          },
        });
      if (url.startsWith('https://ia800505.us.archive.org/view_archive.php'))
        return new Response(Buffer.from((url.includes('0000000002') ? blue : red).split(',')[1], 'base64'));
      throw Error('Unsafe destination');
    };
  const book = { title: 'Luna mică', authors: 'Mara Pop', isbn: '' };
  assert.equal((await openLibraryCovers(book, { fetcher: provider(false) })).length, 2);
  assert.equal((await openLibraryCovers(book, { fetcher: provider(false, true) })).length, 2);
  calls.length = 0;
  await assert.rejects(openLibraryCovers(book, { fetcher: provider(true) }), /Unexpected cover redirect/);
  assert.ok(calls.every((u) => !u.includes('169.254')));
});

test('backups restore selected and alternate covers with family-only access', async (t) => {
  const { store, red, blue } = await setup(t),
    id = randomUUID();
  const row = {
    id,
    title: 'Backup',
    createdAt: new Date().toISOString(),
    coverData: red,
    alternateCovers: [blue],
  };
  const restored = (await addBooks(store, [row], true)).books[0];
  assert.equal(restored.coverOptions.length, 2);
  assert.equal(restored.cover, restored.coverOptions[0].cover);
  await deleteBook(store, id, restored.version);
  assert.deepEqual(await readdir(store.images), []);
});
