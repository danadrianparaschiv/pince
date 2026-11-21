import test from 'node:test';
import assert from 'node:assert/strict';
import {
  countBooks,
  fold,
  hasMessage,
  localeChoice,
  pageOf,
  shelfChoices,
  shelfLabel,
  tr,
  visibleBooks,
} from '../web/strings.js';

// The bookshelf's logic lives in pure functions so that it can be tested without a browser.
const everything = { search: '', read: '', fav: false, cover: '', shelf: '', sort: 'tAsc' };
const book = (title, extra = {}) => ({
  id: title,
  title,
  authors: '',
  cover: null,
  shelfPhoto: null,
  read: false,
  favorite: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...extra,
});
const titles = (books, filters, lang = 'ro') =>
  visibleBooks(books, { ...everything, ...filters }, lang).map((b) => b.title);

test('books are found by title or author, ignoring case and diacritics', () => {
  const books = [
    book('Făt-Frumos din lacrimă', { authors: 'Mihai Eminescu' }),
    book('Amintiri din copilărie', { authors: 'Ion Creangă' }),
    book('Matilda', { authors: 'Roald Dahl' }),
  ];
  assert.deepEqual(titles(books, { search: 'FAT-FRUMOS' }), ['Făt-Frumos din lacrimă']);
  assert.deepEqual(titles(books, { search: 'creanga' }), ['Amintiri din copilărie']);
  assert.deepEqual(titles(books, { search: '  dahl ' }), ['Matilda']);
  assert.deepEqual(titles(books, { search: 'nimic' }), []);
  assert.equal(fold('  ȘTIINȚĂ Și Tehnică '), 'stiinta si tehnica');
});

test("books sort by title, author or date added, in the reader's alphabet", () => {
  const books = [
    book('Zâna Zorilor', { authors: 'Ioan Slavici', createdAt: '2026-03-01T10:00:00.000Z' }),
    book('Șoricelul', { authors: '', createdAt: '2026-01-01T10:00:00.000Z' }),
    book('Abecedar', { authors: 'Ștefan Pop', createdAt: '2026-02-01T10:00:00.000Z' }),
    book('Cartea 10', { authors: 'Ana Blandiana', createdAt: '2026-04-01T10:00:00.000Z' }),
    book('Cartea 2', { authors: 'Ana Blandiana', createdAt: '2026-05-01T10:00:00.000Z' }),
  ];
  // Romanian puts Ș after S, and numbers inside a title count as numbers.
  assert.deepEqual(titles(books, { sort: 'tAsc' }), [
    'Abecedar',
    'Cartea 2',
    'Cartea 10',
    'Șoricelul',
    'Zâna Zorilor',
  ]);
  assert.deepEqual(titles(books, { sort: 'tDesc' }), [
    'Zâna Zorilor',
    'Șoricelul',
    'Cartea 10',
    'Cartea 2',
    'Abecedar',
  ]);
  // Books without an author come last either way; the same author's books stay in title order.
  assert.deepEqual(titles(books, { sort: 'aAsc' }), [
    'Cartea 2',
    'Cartea 10',
    'Zâna Zorilor',
    'Abecedar',
    'Șoricelul',
  ]);
  assert.deepEqual(titles(books, { sort: 'aDesc' }), [
    'Abecedar',
    'Zâna Zorilor',
    'Cartea 2',
    'Cartea 10',
    'Șoricelul',
  ]);
  assert.deepEqual(titles(books, { sort: 'newest' }), [
    'Cartea 2',
    'Cartea 10',
    'Zâna Zorilor',
    'Abecedar',
    'Șoricelul',
  ]);
  assert.deepEqual(titles(books, { sort: 'oldest' }), [
    'Șoricelul',
    'Abecedar',
    'Zâna Zorilor',
    'Cartea 10',
    'Cartea 2',
  ]);
  // Sorting never changes the list it was given.
  assert.equal(books[0].title, 'Zâna Zorilor');
});

test('read and favourite filters combine', () => {
  const books = [
    book('A', { read: true, favorite: true }),
    book('B', { read: true }),
    book('C', { favorite: true }),
    book('D'),
  ];
  assert.deepEqual(titles(books, { read: 'read' }), ['A', 'B']);
  assert.deepEqual(titles(books, { read: 'unread' }), ['C', 'D']);
  assert.deepEqual(titles(books, { fav: true }), ['A', 'C']);
  assert.deepEqual(titles(books, { fav: true, read: 'unread' }), ['C']);
});

test('the catalog filters by cover and by the shelf photo a book was scanned from', async () => {
  const book = (title, cover, shelf, createdAt) => ({
    id: title,
    title,
    authors: '',
    cover: cover ? '/api/covers/x/y' : null,
    shelfPhoto: shelf ? { id: shelf, url: '/api/shelf-photos/' + shelf, place: null } : null,
    createdAt,
    read: false,
    favorite: false,
  });
  const books = [
    book('Ana', true, 'later', '2026-11-19T12:00:00.000Z'),
    book('Barbu', false, 'later', '2026-11-19T12:00:01.000Z'),
    book('Cora', false, 'first', '2026-11-18T12:00:00.000Z'),
    book('Dan', true, null, '2026-11-01T12:00:00.000Z'),
    book('Emil', false, null, '2026-11-02T12:00:00.000Z'),
  ];
  const shown = (filters) =>
    visibleBooks(
      books,
      { search: '', read: '', fav: false, cover: '', shelf: '', sort: 'tAsc', ...filters },
      'ro',
    ).map((b) => b.title);
  assert.deepEqual(shown({}), ['Ana', 'Barbu', 'Cora', 'Dan', 'Emil']);
  assert.deepEqual(
    [shown({ cover: 'with' }), shown({ cover: 'without' })],
    [
      ['Ana', 'Dan'],
      ['Barbu', 'Cora', 'Emil'],
    ],
  );
  assert.deepEqual(
    [shown({ shelf: 'later' }), shown({ shelf: 'first' }), shown({ shelf: 'none' })],
    [['Ana', 'Barbu'], ['Cora'], ['Dan', 'Emil']],
  );
  // The filters combine with each other and with the search.
  assert.deepEqual(
    [
      shown({ shelf: 'later', cover: 'without' }),
      shown({ shelf: 'none', cover: 'with', search: 'da' }),
      shown({ shelf: 'first', cover: 'with' }),
    ],
    [['Barbu'], ['Dan'], []],
  );
  // Filters saved before these existed still show every book.
  assert.equal(visibleBooks(books, { search: '', read: '', fav: false, sort: 'tAsc' }, 'en').length, 5);
  // Shelves are numbered from the oldest photo, dated by the first book saved from each.
  const shelves = shelfChoices(books);
  assert.deepEqual(
    shelves.map((s) => [s.number, s.id, s.count, s.since]),
    [
      [1, 'first', 1, '2026-11-18T12:00:00.000Z'],
      [2, 'later', 2, '2026-11-19T12:00:00.000Z'],
    ],
  );
  assert.deepEqual(shelfChoices(books.slice(3)), []);
  assert.deepEqual(
    [
      shelfLabel(shelves[1], 'en'),
      shelfLabel(shelves[0], 'ro'),
      shelfLabel({ number: 3, count: 21, since: '' }, 'ro'),
    ],
    ['Shelf 2 · 19 Nov · 2 books', 'Raftul 1 · 18 nov. · 1 carte', 'Raftul 3 · 21 de cărți'],
  );
});

test('the catalog pages a long list and clamps a page number that no longer exists', async () => {
  const { pageSize, rangeLabel, pageLabel, selectedCount, deleteCount, deletedMany, keptChanged } =
    await import('../web/strings.js');
  const books = Array.from({ length: 50 }, (_, i) => i);
  assert.equal(pageSize, 24);
  assert.deepEqual(
    [pageOf(books, 0).items.length, pageOf(books, 1).items[0], pageOf(books, 2).items],
    [24, 24, [48, 49]],
  );
  assert.deepEqual(
    (({ index, pages, from, to }) => [index, pages, from, to])(pageOf(books, 9)),
    [2, 3, 49, 50],
  );
  assert.deepEqual((({ index, pages, from, to, items }) => [index, pages, from, to, items])(pageOf([], 3)), [
    0,
    1,
    0,
    0,
    [],
  ]);
  assert.equal(pageOf(books, -4).index, 0);
  assert.equal(pageOf(books.slice(0, 24), 1).pages, 1);
  assert.deepEqual([rangeLabel(25, 48, 50, 'ro'), pageLabel(2, 3, 'en')], ['25–48 din 50', 'Page 2 of 3']);
  assert.deepEqual(
    [selectedCount(1, 'ro'), selectedCount(25, 'ro'), selectedCount(3, 'en')],
    ['1 carte selectată', '25 de cărți selectate', '3 selected'],
  );
  assert.deepEqual([deleteCount(25, 'ro'), deleteCount(1, 'en')], ['Șterge 25 de cărți', 'Delete 1 book']);
  assert.deepEqual(
    [deletedMany(1, 'ro'), deletedMany(3, 'en'), keptChanged(1, 'en')],
    ['1 carte ștearsă.', '3 books deleted.', '1 book changed in the meantime and was kept.'],
  );
});

test('book counts follow Romanian and English plural rules', () => {
  assert.deepEqual(
    [0, 1, 2, 19, 20, 21, 100, 101, 119, 120].map((n) => countBooks(n, 'ro')),
    [
      '0 cărți',
      '1 carte',
      '2 cărți',
      '19 cărți',
      '20 de cărți',
      '21 de cărți',
      '100 de cărți',
      '101 cărți',
      '119 cărți',
      '120 de cărți',
    ],
  );
  assert.deepEqual(
    [0, 1, 2].map((n) => countBooks(n, 'en')),
    ['0 books', '1 book', '2 books'],
  );
});

test("the language is the saved one, else the browser's first supported one, else Romanian", () => {
  assert.equal(localeChoice('en', ['ro-RO']), 'en');
  assert.equal(localeChoice(null, ['de-DE', 'en-GB', 'ro']), 'en');
  assert.equal(localeChoice('fr', ['RO-ro']), 'ro');
  assert.equal(localeChoice(null, ['de', 'fr']), 'ro');
  assert.equal(localeChoice(undefined, undefined), 'ro');
});

test('every label exists in both languages, and an unknown one falls back to a general message', async () => {
  const source = await (
    await import('node:fs/promises')
  ).readFile(new URL('../web/strings.js', import.meta.url), 'utf8');
  const keys = [...source.slice(0, source.indexOf('\n};')).matchAll(/^  (\w+): \[/gm)].map(
    (match) => match[1],
  );
  assert(keys.length > 100);
  for (const key of keys) {
    assert(hasMessage(key), key);
    for (const lang of ['ro', 'en']) assert(tr(key, lang).trim().length > 0, key + ' in ' + lang);
  }
  assert.equal(hasMessage('noSuchLabel'), false);
  assert.equal(tr('noSuchLabel', 'en'), tr('error', 'en'));
});
