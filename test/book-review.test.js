import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { makeApp } from '../api/src/app.js';
import { addBooks, editBook, view } from '../api/src/books.js';
import {
  reviewBook,
  rankCandidates,
  searchBookDetails,
  validatePhotoReviews,
} from '../api/src/book-review.js';
import { tempStore } from './helpers.js';
const entered = { title: 'Matilds', authors: 'Roald Dahl', isbn: '' };
const match = {
  title: 'Matilda',
  authors: 'Roald Dahl',
  isbn: '',
  source: 'googlebooks',
  sourceUrl: 'https://books.google.com/books?id=matilda',
  exact: false,
};
const library = tempStore;

test('catalog review suggests OCR corrections without treating uncertain matches as verified', () => {
  const ranked = rankCandidates(entered, [
    { ...match, authors: ['Roald Dahl'] },
    {
      title: 'Charlie and the Chocolate Factory',
      authors: ['Roald Dahl'],
      source: 'openlibrary',
      sourceUrl: 'https://openlibrary.org/works/OL1W',
    },
  ]);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].title, 'Matilda');
  assert.equal(ranked[0].exact, false);
  const exact = rankCandidates({ ...entered, title: 'Matilda' }, [{ ...match, authors: ['Roald Dahl'] }]);
  assert.equal(exact[0].exact, true);
  const corrected = rankCandidates({ title: 'Matilda', authors: 'Wrong Author', isbn: '' }, [
    { ...match, authors: [' Roald Dahl '] },
  ]);
  assert.equal(corrected[0].authors, 'Roald Dahl');
  assert.equal(corrected[0].exact, false);
});

test('web review uses bounded metadata requests, shares Google quota, and never fetches images', async () => {
  const calls = [];
  let reserved = 0;
  const result = await searchBookDetails(
    { ...entered, title: 'Matilda' },
    {
      apiKey: 'test-key',
      beforeGoogleQuery: async () => reserved++,
      fetcher: async (url, options) => {
        calls.push({ url, options });
        return Response.json({
          items: [
            {
              id: 'matilda',
              volumeInfo: {
                title: 'Matilda',
                authors: ['Roald Dahl'],
                imageLinks: { thumbnail: 'https://evil.example/photo' },
              },
            },
          ],
        });
      },
    },
  );
  assert.equal(result.status, 'matched');
  assert.equal(reserved, 1);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).hostname, 'www.googleapis.com');
  assert.equal(calls[0].options.redirect, 'error');
  assert.ok(!new URL(calls[0].url).searchParams.get('fields').includes('imageLinks'));
  assert.ok(!calls[0].url.includes('test-key'));
});

test('unavailable or unrelated catalogs stay unverified and fallback redirects fail closed', async () => {
  let blocked;
  const result = await searchBookDetails(entered, {
    apiKey: 'key',
    blockGoogle: async (reason) => {
      blocked = reason;
    },
    fetcher: async (url, options) => {
      if (new URL(url).hostname === 'www.googleapis.com') return new Response(null, { status: 429 });
      assert.equal(options.redirect, 'error');
      return Response.json({
        docs: [{ key: '/works/OL1W', title: 'Unrelated', author_name: ['Roald Dahl'] }],
      });
    },
  });
  assert.equal(blocked, 'quota');
  assert.equal(result.status, 'unavailable');
  assert.deepEqual(result.candidates, []);
});

test('photo save is blocked before review; only confirmed fields can start cover lookup', async (t) => {
  const { store, queue } = await library(t),
    password = randomUUID();
  let searches = 0;
  const app = makeApp({
    store,
    env: { BOOTSTRAP_PARENT_PASSWORD: password },
    reviewProvider: async () => {
      searches++;
      return { status: 'suggestions', candidates: [match], warnings: [] };
    },
  });
  let cookie;
  const call = async (path, body) => {
    const r = await app(
      new Request('https://family.example/api/' + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
        body: JSON.stringify(body),
      }),
    );
    if (path === 'login') cookie = r.headers.get('set-cookie')?.split(';')[0];
    return { status: r.status, data: await r.json() };
  };
  assert.equal((await call('book-review', entered)).status, 401);
  await call('login', { username: 'parinte', password });
  const id = randomUUID();
  assert.equal(
    (await call('books', { books: [{ id, ...entered, source: 'photo' }] })).data.error,
    'reviewRequired',
  );
  assert.equal(queue.length, 0);
  assert.equal((await store.list('books')).length, 0);
  const review = (await call('book-review', entered)).data;
  const again = (await call('book-review', entered)).data;
  assert.equal(review.key, again.key);
  assert.equal(searches, 1);
  assert.equal(queue.length, 0);
  const proof = { key: review.key, choice: 1 };
  assert.equal(
    (await call('books', { books: [{ id, ...entered, source: 'photo', photoReview: proof }] })).data.error,
    'reviewRequired',
  );
  const payload = {
    books: [
      { id, title: match.title, authors: match.authors, isbn: '', source: 'photo', photoReview: proof },
    ],
  };
  const saved = await call('books', payload);
  assert.equal(saved.status, 201);
  assert.equal(queue.length, 1);
  assert.equal(saved.data.books[0].title, 'Matilda');
  assert.equal(saved.data.books[0].catalogSource.source, 'googlebooks');
  assert.equal((await call('books', payload)).status, 201);
  assert.equal(queue.length, 1);
});

test('manual confirmation works for no-match results; cached receipts survive refresh and serialize requests', async (t) => {
  const { store } = await library(t);
  // The first review is held inside its catalogue request until the second has been refused.
  let release, started;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const underway = new Promise((resolve) => {
    started = resolve;
  });
  const first = reviewBook(store, {}, entered, {
    provider: async () => {
      started();
      await gate;
      return { status: 'unmatched', candidates: [], warnings: [] };
    },
  });
  await underway;
  await assert.rejects(reviewBook(store, {}, { ...entered, title: 'Other' }), (e) => e.code === 'reviewBusy');
  release();
  const review = await first;
  await validatePhotoReviews(store, [
    { ...entered, source: 'photo', photoReview: { key: review.key, choice: 0 } },
  ]);
  await assert.rejects(
    validatePhotoReviews(store, [
      { ...entered, authors: 'Changed', source: 'photo', photoReview: { key: review.key, choice: 0 } },
    ]),
    (e) => e.code === 'reviewRequired',
  );
  assert.equal((await store.list('book-review-receipts')).length, 1);
  assert.equal((await store.get('system', 'book-review-lock')).value.until, 0);
});

test('accepted Google metadata keeps attribution through restore and clears after a title edit', async (t) => {
  const { store } = await library(t);
  const row = {
    id: randomUUID(),
    title: 'Matilda',
    authors: 'Roald Dahl',
    createdAt: new Date().toISOString(),
    catalogSource: { source: 'googlebooks', sourceId: 'matilda' },
  };
  const book = (await addBooks(store, [row], true)).books[0];
  assert.equal(book.catalogSource.sourceUrl, match.sourceUrl);
  const publicBook = view((await store.get('books', row.id)).value, true);
  assert.equal(publicBook.catalogSource.sourceId, 'matilda');
  assert.ok(!Object.hasOwn(publicBook, 'note'));
  await editBook(store, row.id, { base: { note: '' }, changes: { note: 'Private' } });
  assert.equal(view((await store.get('books', row.id)).value).catalogSource.sourceId, 'matilda');
  await editBook(store, row.id, { base: { title: 'Matilda' }, changes: { title: 'Matilda, my edition' } });
  assert.equal(view((await store.get('books', row.id)).value).catalogSource, undefined);
});

test('distinctive Romanian titles and numbered volumes outrank series-only evidence', () => {
  const series = 'Enciclopedia micilor curioși';
  const books = ['Corpul omenesc', 'Ferma'].map((title) => ({
    title: series + ': ' + title,
    authors: [],
    publisher: 'RAO',
  }));
  for (const candidates of [books, [...books].reverse()]) {
    for (const title of ['Ferma', series + ': Ferma']) {
      const [top] = rankCandidates({ title, series, publisher: 'RAO' }, candidates);
      assert.equal(top.title, series + ': Ferma');
    }
  }
  const suggestions = rankCandidates({ title: series, series, publisher: 'RAO' }, books);
  assert.equal(suggestions.length, 2);
  assert.ok(suggestions.every((c) => !c.exact));
  const numbered = [{ title: 'Cum funcționează? (Nr. 9)', authors: ['Autor'], isbns: ['9781234567890'] }];
  assert.deepEqual(
    rankCandidates({ title: 'Cum funcționează?', volume: '8', isbn: '9781234567890' }, numbered),
    [],
  );
});

test('ranks editions before deduplicating and retains the reported date precision', () => {
  const input = { title: 'Ferma', publisher: 'RAO', publishedDate: '2019-05-15', authors: 'Autor' };
  const books = ['2018', '2019'].map((publishedDate) => ({
    title: 'Ferma',
    authors: ['Autor'],
    publisher: 'RAO',
    publishedDate,
  }));
  const [top, other] = rankCandidates(input, books);
  assert.equal(top.publishedDate, '2019-05-15');
  assert.equal(top.exact, true);
  assert.equal(other.exact, false);
  assert.equal(other.publishedDate, '2018');
});

test('catalog suggestions bind publisher and publication date to the chosen edition and receipt', async (t) => {
  const { store } = await library(t);
  const input = { title: 'Ferma', series: 'Enciclopedia micilor curioși', publisher: 'RAO' };
  const provider = (entry, options) =>
    searchBookDetails(entry, {
      ...options,
      apiKey: 'key',
      fetcher: async (url) => {
        if (new URL(url).hostname !== 'www.googleapis.com') return Response.json({ docs: [] });
        assert.match(new URL(url).searchParams.get('q'), /Ferma.*micilor curioși/);
        return Response.json({
          items: [
            {
              id: 'test',
              volumeInfo: {
                title: entry.series,
                subtitle: 'Ferma',
                publisher: 'RAO',
                publishedDate: '2019-02',
              },
            },
          ],
        });
      },
    });
  const result = await reviewBook(store, {}, input, { provider, wait: async () => {} });
  const chosen = result.candidates[0];
  assert.equal(chosen.title, input.series + ': Ferma');
  assert.equal(chosen.publishedDate, '2019-02');
  const row = { ...chosen, source: 'photo', photoReview: { key: result.key, choice: 1 } };
  await validatePhotoReviews(store, [row]);
  for (const field of ['publishedDate', 'publisher'])
    await assert.rejects(
      validatePhotoReviews(store, [{ ...row, [field]: '' }]),
      (e) => e.code === 'reviewRequired',
    );
  const different = await reviewBook(
    store,
    {},
    { ...input, volume: '8' },
    { provider, wait: async () => {} },
  );
  assert.notEqual(different.key, result.key);
});

test('legacy books, backups and receipts accept absent optional edition fields', async (t) => {
  const { store } = await library(t),
    id = randomUUID(),
    key = randomUUID();
  const row = { id, title: 'Carte', authors: '', isbn: '', version: 1, createdAt: new Date().toISOString() };
  await store.cas('books', id, undefined, row);
  await store.cas('book-review-receipts', key, undefined, { input: row, result: { candidates: [] } });
  await validatePhotoReviews(store, [{ ...row, source: 'photo', photoReview: { key, choice: 0 } }]);
  let edited = await editBook(store, id, {
    base: { publisher: '', publishedDate: '' },
    changes: { publisher: 'Casa', publishedDate: '2024-02-29' },
  });
  assert.equal(edited.publisher, 'Casa');
  await assert.rejects(
    editBook(store, id, { base: { publishedDate: '2024-02-29' }, changes: { publishedDate: '2023-02-29' } }),
    (e) => e.code === 'invalidPublishedDate',
  );
  await assert.rejects(
    editBook(store, id, { base: { publisher: '' }, changes: { publisher: 'RAO' } }),
    (e) => e.code === 'conflict',
  );
  for (const date of ['2024', '2024-02', '2024-02-29', '']) {
    const restored = await addBooks(store, [{ ...edited, id: randomUUID(), publishedDate: date }], true);
    assert.equal(restored.books[0].publishedDate, date);
    assert.equal(restored.books[0].publisher, 'Casa');
  }
});

test('edition metadata stays with its Open Library edition', async () => {
  const input = { title: 'Ferma', series: 'Enciclopedia micilor curioși', publisher: 'RAO' };
  const result = await searchBookDetails(input, {
    fetcher: async () =>
      Response.json({
        docs: [
          {
            key: '/works/OL1W',
            title: 'Farm',
            author_name: [],
            first_publish_year: 1962,
            editions: {
              docs: [{ title: input.series, subtitle: 'Ferma', publisher: ['RAO'], publish_date: ['2019'] }],
            },
          },
        ],
      }),
  });
  assert.equal(result.candidates[0].publishedDate, '2019');
  assert.equal(result.candidates[0].publisher, 'RAO');
});

test('ranks each of the 24 hand-read titles against the other shelf books', async () => {
  const fixture = JSON.parse(
    await readFile(new URL('./fixtures/shelf-benchmark.json', import.meta.url), 'utf8'),
  );
  const labels = fixture.images.flatMap((sample) => sample.books);
  const candidates = labels.map((book) => ({
    title: [book.series, book.title].filter(Boolean).join(': '),
    authors: book.authors?.split(', ') || [],
    publisher: book.publisher,
  }));
  for (const [i, input] of labels.entries()) {
    const ranked = rankCandidates(input, [...candidates].reverse());
    assert.equal(ranked[0]?.title, candidates[i].title, input.title);
  }
});
