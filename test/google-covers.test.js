import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { googleBooksCovers, safeGoogleImage, CoverSourceError } from '../api/src/google-covers.js';
import { findCovers, googleRequestBudget } from '../api/src/cover-providers.js';
import { addBooks, getBook, view } from '../api/src/books.js';
import { requestCovers, runCoverJob } from '../api/src/cover-jobs.js';
import { jpeg, tempStore } from './helpers.js';
const book = { title: 'Luna mică', authors: 'Mara Pop', isbn: '9780142410370' };
const picture = (background) => jpeg({ width: 100, height: 160, background });
const cover = (bytes, source, sourceId) => ({
  data: 'data:image/jpeg;base64,' + bytes.toString('base64'),
  source,
  sourceId,
  sourceUrl:
    source === 'googlebooks'
      ? 'https://books.google.com/books?id=' + sourceId
      : 'https://openlibrary.org/works/OL1W',
});
const item = (id, title = book.title, authors = [book.authors]) => ({
  id,
  volumeInfo: {
    title,
    authors,
    imageLinks: { thumbnail: 'http://books.google.com/books/content?id=' + id + '&zoom=1' },
  },
});

test('possessive punctuation and a combined author/illustrator name still match the correct book', async () => {
  const bytes = await picture('red');
  const scenarios = [
    {
      title: "The Scarecrow's Wedding",
      authors: 'Julia Donaldson',
      actual: 'The Scarecrows’ Wedding',
      actualAuthors: ['Julia Donaldson'],
    },
    {
      title: "Pooh's Little Instruction Book",
      authors: 'Milne & Shepard',
      actual: "Pooh's Little Instruction Book",
      actualAuthors: ['A. A. Milne'],
    },
  ];
  for (const scenario of scenarios) {
    let queries = 0;
    const found = await googleBooksCovers(
      { ...scenario, isbn: '' },
      {
        apiKey: 'key',
        fetcher: async (url) => {
          const u = new URL(url);
          if (u.hostname === 'www.googleapis.com') {
            queries++;
            return Response.json({
              items: u.searchParams.get('q').includes('inauthor:')
                ? []
                : [
                    item('right', scenario.actual, scenario.actualAuthors),
                    item('wrong', scenario.actual, ['Unrelated Writer']),
                  ],
            });
          }
          return new Response(bytes);
        },
      },
    );
    assert.equal(queries, 2);
    assert.deepEqual(
      found.map((c) => c.sourceId),
      ['right'],
    );
  }
});
const storeFor = tempStore;

test('Google matches title and author, deduplicates images, and keeps the key off image requests', async () => {
  const red = await picture('red'),
    blue = await picture('blue'),
    calls = [];
  const found = await googleBooksCovers(book, {
    apiKey: 'private-test-key',
    fetcher: async (url, options) => {
      calls.push({ url, options });
      if (new URL(url).hostname === 'www.googleapis.com')
        return Response.json({
          items: [
            item('wrong', 'Different book'),
            item('author', book.title, ['Another Author']),
            item('one'),
            item('duplicate'),
            item('two'),
          ],
        });
      return new Response(new URL(url).searchParams.get('id') === 'two' ? blue : red);
    },
  });
  assert.deepEqual(
    found.map((c) => c.sourceId),
    ['one', 'two'],
  );
  assert.equal(calls.length, 4);
  assert.equal(calls[0].options.headers['X-Goog-Api-Key'], 'private-test-key');
  assert.ok(
    calls
      .slice(1)
      .every((c) => !JSON.stringify(c).includes('private-test-key') && c.url.startsWith('https:')),
  );
  assert.equal(safeGoogleImage('https://evil.example/books/content?id=one', 'one'), null);
  assert.equal(safeGoogleImage('https://books.google.com/books/content?id=other', 'one'), null);
});

test('Google image attempts remain bounded across ISBN and title queries, and rejects unsafe redirects', async () => {
  let queries = 0,
    images = 0;
  const fetcher = async (url) => {
    if (new URL(url).hostname === 'www.googleapis.com') {
      queries++;
      return Response.json({ items: Array.from({ length: 10 }, (_, i) => item(String(i))) });
    }
    images++;
    return new Response(null, { status: 404 });
  };
  assert.deepEqual(await googleBooksCovers(book, { apiKey: 'key', fetcher }), []);
  assert.equal(queries, 2);
  assert.equal(images, 4);
  const calls = [];
  await assert.rejects(
    googleBooksCovers(
      { ...book, isbn: '' },
      {
        apiKey: 'key',
        fetcher: async (url) => {
          calls.push(url);
          return new URL(url).hostname === 'www.googleapis.com'
            ? Response.json({ items: [item('one')] })
            : new Response(null, { status: 302, headers: { location: 'https://169.254.169.254/metadata' } });
        },
      },
    ),
    (e) => e.reason === 'unsafeImage',
  );
  assert.ok(calls.every((url) => !url.includes('169.254')));
});

test('fallback fills missing covers and handles either provider being unavailable', async () => {
  const red = cover(await picture('red'), 'openlibrary', '1'),
    same = cover(await picture('red'), 'googlebooks', '1'),
    blue = cover(await picture('blue'), 'googlebooks', '2');
  const result = await findCovers(book, {
    openLibrary: async () => [red],
    googleBooks: async () => [same, blue],
  });
  assert.deepEqual(result.covers, [red, blue]);
  assert.deepEqual(
    (
      await findCovers(book, {
        openLibrary: async () => [red, blue],
        googleBooks: () => assert.fail('Unnecessary query'),
      })
    ).covers,
    [red, blue],
  );
  const recovered = await findCovers(book, {
    openLibrary: async () => {
      throw Error('OL offline');
    },
    googleBooks: async () => [blue],
  });
  assert.deepEqual(recovered.covers, [blue]);
  assert.deepEqual(recovered.warnings, ['openlibrary']);
  const partial = await findCovers(book, {
    openLibrary: async () => [red],
    googleBooks: async () => {
      throw new CoverSourceError('quota', false);
    },
  });
  assert.deepEqual(partial.covers, [red]);
  assert.deepEqual(partial.warnings, ['googlebooks']);
});

test('Google quota failures stop automatic retries and the shared budget blocks subsequent queries', async (t) => {
  const { store, queue } = await storeFor(t),
    id = randomUUID();
  await addBooks(store, [{ id, ...book }]);
  await requestCovers(store, id);
  let calls = 0;
  await runCoverJob(store, queue[0], {
    provider: async (_book, options) =>
      googleBooksCovers(book, {
        ...options,
        apiKey: 'key',
        beforeRequest: async () => {},
        fetcher: async () => {
          calls++;
          return new Response(null, { status: 429 });
        },
      }),
  });
  assert.equal((await getBook(store, id)).coverLookup.status, 'failed');
  assert.equal(queue.length, 1);
  assert.equal(calls, 1);
  await assert.rejects(googleRequestBudget(store).beforeGoogleQuery(), (e) => e.reason === 'quota');
  const usage = await store.get('system', 'google-cover-usage'),
    day = new Date().toISOString().slice(0, 10);
  await store.cas('system', 'google-cover-usage', usage.etag, { days: { [day]: 900 } });
  await assert.rejects(googleRequestBudget(store).beforeGoogleQuery(), (e) => e.reason === 'localLimit');
});

test('Google suggestions preserve an existing default even when source IDs collide', async (t) => {
  const { store, queue } = await storeFor(t),
    id = randomUUID(),
    red = cover(await picture('red'), 'openlibrary', '1'),
    blue = cover(await picture('blue'), 'googlebooks', '1');
  await addBooks(store, [{ id, ...book }]);
  await requestCovers(store, id);
  await runCoverJob(store, queue[0], { provider: async () => [red] });
  const before = await store.get('books', id),
    selected = before.value.image;
  await store.cas('books', id, before.etag, {
    ...before.value,
    coverLookup: { ...before.value.coverLookup, updatedAt: '2020-01-01' },
  });
  await requestCovers(store, id, { retry: true });
  await runCoverJob(store, queue.at(-1), { provider: async () => [blue] });
  const after = await getBook(store, id);
  assert.equal(after.image, selected);
  assert.equal(after.coverOptions.length, 2);
  assert.notEqual(after.coverOptions[0].key, after.coverOptions[1].key);
});

test('Google attribution survives backup restore and public views expose only the selected source', async (t) => {
  const { store } = await storeFor(t),
    red = cover(await picture('red'), 'googlebooks', 'one'),
    blue = cover(await picture('blue'), 'googlebooks', 'two');
  const b = (
    await addBooks(
      store,
      [
        {
          id: randomUUID(),
          ...book,
          createdAt: new Date().toISOString(),
          note: 'Private',
          coverData: red.data,
          coverProvenance: { ...red, sourceUrl: 'https://evil.example' },
          alternateCovers: [blue],
        },
      ],
      true,
    )
  ).books[0];
  const publicBook = view(await getBook(store, b.id), true);
  assert.equal(publicBook.coverAttribution.sourceUrl, 'https://books.google.com/books?id=one');
  assert.equal(publicBook.note, undefined);
  assert.equal(publicBook.coverOptions, undefined);
  assert.equal(b.coverOptions[1].source, 'googlebooks');
  assert.equal(b.coverOptions[1].sourceId, 'two');
});
