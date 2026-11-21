import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { addBooks, editBook, getBook, view } from '../api/src/books.js';
import {
  deleteShelfPhoto,
  keepShelfPhoto,
  listShelfPhotos,
  restoreShelfPhotos,
} from '../api/src/shelf-photos.js';
import { change } from '../api/src/store.js';
import { readBackup, writeBackup } from '../scripts/local-backup.mjs';
import { dataUrl, jpeg, picture, sharp, startLibrary, tempStore } from './helpers.js';

// Backups that carry shelf photos, lending, the reading log and the wishlist: the parts of the
// library a family adds to after the catalogue itself.

const today = () => new Date().toISOString().slice(0, 10);
const place = { x: 0.5, y: 0.4, w: 0.3, h: 0.02, angle: -1.5708 };

test('a backup carries the shelf photos, so a restore elsewhere keeps where each book stands', async (t) => {
  const { store } = await tempStore(t);
  const photo = randomUUID(),
    unused = randomUUID(),
    ids = [randomUUID(), randomUUID()];
  await keepShelfPhoto(store, photo, await jpeg({ width: 320, height: 200 }));
  await keepShelfPhoto(store, unused, await jpeg({ width: 100, height: 60, background: '#884422' }));
  await addBooks(store, [
    { id: ids[0], title: 'Fram, ursul polar', shelfPhoto: photo, shelfPlace: place },
    { id: ids[1], title: 'Dorită', wanted: true },
  ]);
  await editBook(store, ids[0], {
    changes: { read: true, finishedAt: '2026-03-14', rating: 4, lentTo: ' Bunica ', lentAt: '2026-10-02' },
    base: { read: false, finishedAt: '', rating: 0, lentTo: '', lentAt: '' },
  });

  const lines = [];
  assert.equal(await writeBackup(store, async (line) => lines.push(line)), 2);
  assert.deepEqual(JSON.parse(lines[0]), { format: 'family-library', version: 4, count: 2, photos: 2 });
  // Photos come before the books that point at them.
  assert.deepEqual(
    lines.slice(1).map((line) => JSON.parse(line).type || 'book'),
    ['shelf-photo', 'shelf-photo', 'book', 'book'],
  );

  const other = (await tempStore(t)).store;
  const feed = () => lines.map((line) => line.trimEnd());
  assert.equal(await readBackup(other, feed()), 2);
  const restored = view(await getBook(other, ids[0]));
  assert.deepEqual(restored.shelfPhoto, {
    id: photo,
    url: '/api/shelf-photos/' + photo,
    place: { x: 0.5, y: 0.4, w: 0.3, h: 0.02, angle: -1.5708 },
  });
  assert.deepEqual(
    [restored.read, restored.finishedAt, restored.rating, restored.lentTo, restored.lentAt, restored.wanted],
    [true, '2026-03-14', 4, 'Bunica', '2026-10-02', false],
  );
  assert.equal(view(await getBook(other, ids[1])).wanted, true);
  const photos = await listShelfPhotos(other);
  assert.deepEqual(
    photos.map((p) => [p.id, p.width, p.height, p.books]).sort(),
    [
      [photo, 320, 200, 1],
      [unused, 100, 60, 0],
    ].sort(),
  );
  assert.equal(
    photos.find((p) => p.id === photo).at,
    (await listShelfPhotos(store)).find((p) => p.id === photo).at,
  );
  assert.equal((await sharp(await other.getImage('shelf-' + photo + '.jpg')).metadata()).format, 'jpeg');

  // Restoring again adds nothing and leaves a photo that is already there as it is.
  const before = await other.getImage('shelf-' + photo + '.jpg');
  await readBackup(other, feed());
  assert.equal((await listShelfPhotos(other)).length, 2);
  assert.deepEqual(await other.getImage('shelf-' + photo + '.jpg'), before);

  // A photo the parent deleted comes back with the backup, and so does the link to it.
  await deleteShelfPhoto(other, photo);
  assert.equal(view(await getBook(other, ids[0])).shelfPhoto, null);
  await readBackup(other, feed());
  assert.equal((await listShelfPhotos(other)).length, 2);
});

test('a backup with misplaced, repeated or missing shelf photos is refused', async (t) => {
  const { store } = await tempStore(t);
  const head = (version, count, photos) =>
    JSON.stringify({ format: 'family-library', version, count, photos });
  const book = JSON.stringify({ id: randomUUID(), title: 'O carte', createdAt: '2026-01-01T10:00:00.000Z' });
  const shot = JSON.stringify({
    type: 'shelf-photo',
    id: randomUUID(),
    at: '2026-01-01T09:00:00.000Z',
    data: await picture(),
  });
  const cases = {
    'not a backup file': [head(3, 1, 1), shot, book],
    'not a backup file ': [head(4, 1, -1), book],
    'out of place': [head(4, 1, 1), book, shot],
    'twice, out of place, or more photos': [head(4, 0, 1), shot, shot],
    'more photos than it declares': [head(4, 1, 0), shot, book],
    'declares 2 shelf photos and holds 1': [head(4, 0, 2), shot],
  };
  for (const [reason, lines] of Object.entries(cases))
    await assert.rejects(readBackup(store, lines), new RegExp(reason.trim()), reason);
  // A picture that is not one stops the restore with the library's own refusal.
  const broken = JSON.stringify({
    type: 'shelf-photo',
    id: randomUUID(),
    at: '2026-01-01T09:00:00.000Z',
    data: 'data:image/jpeg;base64,AAAA',
  });
  await assert.rejects(readBackup(store, [head(4, 0, 1), broken]), { code: 'invalidImage' });
  // A version 3 file, which has no photos, still restores.
  assert.equal(
    await readBackup(store, [JSON.stringify({ format: 'family-library', version: 3, count: 1 }), book]),
    1,
  );
});

test('the restore route takes shelf photos from the parent only, and checks each one', async (t) => {
  const { call, signin, store } = await startLibrary(t);
  const p = await signin(),
    c = await signin('copil');
  const id = randomUUID(),
    at = '2026-02-03T08:00:00.000Z';
  const send = (photos, cookie = p) => call('admin/restore', 'POST', { photos }, cookie);
  assert.equal((await send([{ id, at, data: await picture() }], c)).status, 403);
  const good = { id, at, data: await picture({ width: 2400, height: 1200, metadata: true }) };
  for (const bad of [
    'no list',
    [],
    [good, good, good, good, good],
    [{ ...good, id: 'not-an-id' }],
    // A new file is named in lower case only, so that it cannot land on another photo's file.
    [{ ...good, id: id.toUpperCase() }],
    [{ ...good, at: 'yesterday' }],
    [{ ...good, at: 5 }],
    [null],
  ])
    assert.equal((await send(bad)).status, 400, JSON.stringify(bad).slice(0, 40));
  assert.deepEqual(
    [(await send([{ ...good, data: 'data:text/html;base64,AAAA' }])).data.error],
    ['invalidImage'],
  );
  assert.equal((await send([{ ...good, data: dataUrl(Buffer.alloc(3_100_000)) }])).status, 413);
  assert.deepEqual((await listShelfPhotos(store)).length, 0);

  assert.deepEqual((await send([good])).data, { count: 1 });
  // Stored like an upload: no larger than a kept shelf photo, with the camera's data dropped.
  const kept = await sharp(await store.getImage('shelf-' + id + '.jpg')).metadata();
  assert.deepEqual([kept.width, kept.height, kept.format, kept.exif], [2048, 1024, 'jpeg', undefined]);
  assert.deepEqual((await send([good])).data, { count: 0 });

  const bookId = randomUUID();
  const restored = await call(
    'admin/restore',
    'POST',
    { books: [{ id: bookId, title: 'Legată', createdAt: at, shelfPhoto: id, shelfPlace: place }] },
    p,
  );
  assert.equal(restored.data.books[0].shelfPhoto.id, id);
  assert.deepEqual((await call('shelf-photos', 'GET', undefined, p)).data.photos[0].books, 1);
});

test('a scan cannot replace a photo that is already kept, and kept photos have a ceiling', async (t) => {
  const { store } = await tempStore(t);
  const restored = randomUUID(),
    at = '2026-02-03T08:00:00.000Z',
    row = async (id, background) => ({
      id,
      at,
      data: await picture({ width: 300, height: 200, background }),
    });
  assert.deepEqual(await restoreShelfPhotos(store, [await row(restored, '#224466')]), { count: 1 });
  const before = await store.getImage('shelf-' + restored + '.jpg');
  // A restored photo has no scan of its own. A scan sent under its id must not write over it.
  await assert.rejects(keepShelfPhoto(store, restored, await jpeg({ width: 640, height: 480 })), /exists/);
  assert.deepEqual(await store.getImage('shelf-' + restored + '.jpg'), before);
  // Nor under the id of a photo the parent deleted.
  await deleteShelfPhoto(store, restored);
  await assert.rejects(keepShelfPhoto(store, restored, await jpeg()), /exists/);

  // The ceiling counts kept photos only, for scans and for restores alike.
  const first = randomUUID();
  await keepShelfPhoto(store, first, await jpeg(), 2);
  await restoreShelfPhotos(store, [await row(randomUUID(), '#446622')], 2);
  await assert.rejects(keepShelfPhoto(store, randomUUID(), await jpeg(), 2), /no more/);
  await assert.rejects(restoreShelfPhotos(store, [await row(randomUUID(), '#662244')], 2), {
    status: 409,
    code: 'libraryFull',
  });
  // One already held is still skipped, not refused.
  assert.deepEqual(await restoreShelfPhotos(store, [await row(first, '#000000')], 2), { count: 0 });
  assert.equal((await listShelfPhotos(store)).length, 2);
});

test('lending: who has a book and since when, set and cleared by either account, never public', async (t) => {
  const { call, signin } = await startLibrary(t);
  const p = await signin(),
    c = await signin('copil');
  const id = randomUUID();
  await call('books', 'POST', { books: [{ id, title: 'Cartea junglei' }] }, p);
  const patch = (changes, base, cookie = c) => call('books/' + id, 'PATCH', { changes, base }, cookie);

  const lent = await patch({ lentTo: '  Mara  ' }, { lentTo: '' });
  assert.deepEqual([lent.status, lent.data.book.lentTo, lent.data.book.lentAt], [200, 'Mara', today()]);
  // The day can be corrected; a day without a borrower means nothing and is dropped.
  assert.equal(
    (await patch({ lentAt: '2026-09-30' }, { lentAt: today() }, p)).data.book.lentAt,
    '2026-09-30',
  );
  const back = await patch({ lentTo: '' }, { lentTo: 'Mara' });
  assert.deepEqual([back.data.book.lentTo, back.data.book.lentAt], ['', '']);
  assert.equal((await patch({ lentAt: '2026-09-30' }, { lentAt: '' })).data.book.lentAt, '');
  const both = await patch({ lentTo: 'Tudor', lentAt: '2026-11-01' }, { lentTo: '', lentAt: '' });
  assert.deepEqual([both.data.book.lentTo, both.data.book.lentAt], ['Tudor', '2026-11-01']);

  for (const [changes, base] of [
    [{ lentTo: 'x'.repeat(81) }, { lentTo: 'Tudor' }],
    [{ lentTo: 'two\nlines' }, { lentTo: 'Tudor' }],
    // A text-direction override or a line separator could change how the name reads.
    [{ lentTo: 'Mara\u202Eevil' }, { lentTo: 'Tudor' }],
    [{ lentTo: 'Mara\u2028Tudor' }, { lentTo: 'Tudor' }],
    // A day is not in the future, give or take the family's time zone.
    [{ lentAt: new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10) }, { lentAt: '2026-11-01' }],
    [{ lentAt: '9999-12-31' }, { lentAt: '2026-11-01' }],
    [{ lentTo: 7 }, { lentTo: 'Tudor' }],
    [{ lentAt: '2026-02-30' }, { lentAt: '2026-11-01' }],
    [{ lentAt: '30.09.2026' }, { lentAt: '2026-11-01' }],
    [{ lentAt: '1850-01-01' }, { lentAt: '2026-11-01' }],
    [{ lentAt: null }, { lentAt: '2026-11-01' }],
  ])
    assert.equal((await patch(changes, base)).status, 400, JSON.stringify(changes));
  // Someone else changed the borrower in the meantime.
  assert.equal((await patch({ lentTo: 'Ana' }, { lentTo: '' })).status, 409);

  const shared = (await call('public/' + id)).data.book;
  assert.deepEqual(Object.keys(shared).sort(), ['authors', 'cover', 'id', 'title']);
});

test('reading log: a finished day and a rating, without stamping books read long ago', async (t) => {
  const { call, signin, store } = await startLibrary(t);
  const c = await signin('copil');
  const id = randomUUID();
  await call('books', 'POST', { books: [{ id, title: 'Matilda' }] }, c);
  const patch = (changes, base) => call('books/' + id, 'PATCH', { changes, base }, c);

  // Marking a book read fills in today unless the reader says when.
  assert.equal((await patch({ read: true }, { read: false })).data.book.finishedAt, today());
  assert.equal((await patch({ read: false }, { read: true })).data.book.finishedAt, '');
  const dated = await patch({ read: true, finishedAt: '2026-08-15' }, { read: false, finishedAt: '' });
  assert.equal(dated.data.book.finishedAt, '2026-08-15');
  // The day can be removed when nobody remembers it, and stays removed.
  assert.equal((await patch({ finishedAt: '' }, { finishedAt: '2026-08-15' })).data.book.finishedAt, '');
  assert.equal((await patch({ favorite: true }, { favorite: false })).data.book.finishedAt, '');
  // A day on a book that is not read is dropped.
  await patch({ read: false }, { read: true });
  assert.equal((await patch({ finishedAt: '2026-08-15' }, { finishedAt: '' })).data.book.finishedAt, '');

  const rated = await patch({ rating: 5 }, { rating: 0 });
  assert.equal(rated.data.book.rating, 5);
  assert.equal((await patch({ rating: 0 }, { rating: 5 })).data.book.rating, 0);
  for (const rating of [6, -1, 2.5, '4', null])
    assert.equal((await patch({ rating }, { rating: 0 })).status, 400, String(rating));

  // A book marked read before finished days existed has none, and an unrelated edit adds none.
  await change(store, 'books', id, (book) => {
    const { finishedAt, rating, lentTo, lentAt, wanted, ...old } = book;
    return { ...old, read: true };
  });
  const old = (await call('books/' + id, 'GET', undefined, c)).data.book;
  assert.deepEqual(
    [old.read, old.finishedAt, old.rating, old.lentTo, old.lentAt, old.wanted],
    [true, '', 0, '', '', false],
  );
  assert.equal((await patch({ note: 'Recitită' }, { note: '' })).data.book.finishedAt, '');

  // A backup made before these fields existed restores a read book the same way.
  const legacy = randomUUID();
  await addBooks(
    store,
    [{ id: legacy, title: 'Veche', read: true, createdAt: '2025-01-01T00:00:00.000Z' }],
    true,
  );
  assert.equal(view(await getBook(store, legacy)).finishedAt, '');
  await assert.rejects(
    addBooks(
      store,
      [{ id: randomUUID(), title: 'Greșită', createdAt: '2025-01-01T00:00:00.000Z', rating: 9 }],
      true,
    ),
    { code: 'invalid' },
  );
});

test('wishlist: wanted books, their arrival on the shelf, and a link only the parent controls', async (t) => {
  const { call, signin } = await startLibrary(t);
  const p = await signin(),
    c = await signin('copil');
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const added = await call(
    'books',
    'POST',
    {
      books: [
        { id: ids[0], title: 'Zâna Măseluță', authors: 'A. B.', wanted: true, coverData: await picture() },
        { id: ids[1], title: 'Aventurile lui Tom Sawyer', wanted: true },
        { id: ids[2], title: 'Deja pe raft' },
      ],
    },
    c,
  );
  assert.deepEqual(
    added.data.books.map((b) => b.wanted),
    [true, true, false],
  );
  assert.equal(
    (await call('books', 'POST', { books: [{ id: randomUUID(), title: 'X', wanted: 'yes' }] }, c)).status,
    400,
  );

  // Off until the parent switches it on; the child cannot.
  const token = randomUUID();
  assert.equal((await call('public/wishlist/' + token)).status, 404);
  assert.deepEqual((await call('admin/settings', 'GET', undefined, p)).data.wishlist, {
    shared: false,
    token: null,
  });
  assert.equal((await call('admin/wishlist', 'PATCH', { shared: true }, c)).status, 403);
  for (const body of [{}, { shared: 'yes' }, { shared: true, renew: 1 }])
    assert.equal((await call('admin/wishlist', 'PATCH', body, p)).status, 400, JSON.stringify(body));

  const on = (await call('admin/wishlist', 'PATCH', { shared: true }, p)).data.wishlist;
  assert.match(on.token, /^[0-9a-f-]{36}$/);
  assert.deepEqual((await call('admin/wishlist', 'PATCH', { shared: true }, p)).data.wishlist, on);
  const list = await call('public/wishlist/' + on.token.toUpperCase());
  assert.equal(list.status, 200);
  // Wanted books only, in title order, each with no more than a shared book shows.
  assert.deepEqual(
    list.data.books.map((b) => b.title),
    ['Aventurile lui Tom Sawyer', 'Zâna Măseluță'],
  );
  assert.deepEqual(Object.keys(list.data.books[1]).sort(), ['authors', 'cover', 'id', 'title']);
  assert.equal(
    (await call(list.data.books[1].cover.replace('/api/', ''))).headers.get('content-type'),
    'image/jpeg',
  );
  assert.equal((await call('public/wishlist/' + token)).status, 404);
  assert.equal((await call('public/wishlist/not-a-token')).status, 404);

  // A new link replaces the old one; switching off ends every link.
  const renewed = (await call('admin/wishlist', 'PATCH', { shared: true, renew: true }, p)).data.wishlist;
  assert.notEqual(renewed.token, on.token);
  assert.equal((await call('public/wishlist/' + on.token)).status, 404);
  assert.equal((await call('public/wishlist/' + renewed.token)).status, 200);
  assert.deepEqual((await call('admin/wishlist', 'PATCH', { shared: false }, p)).data.wishlist, {
    shared: false,
    token: null,
  });
  assert.equal((await call('public/wishlist/' + renewed.token)).status, 404);
  const again = (await call('admin/wishlist', 'PATCH', { shared: true }, p)).data.wishlist;
  assert.notEqual(again.token, renewed.token);

  // The book arrives: it leaves the wishlist and joins the shelf as its newest book.
  const wished = added.data.books[1];
  await new Promise((resolve) => setTimeout(resolve, 5));
  const arrived = await call(
    'books/' + ids[1],
    'PATCH',
    { changes: { wanted: false }, base: { wanted: true } },
    c,
  );
  assert.equal(arrived.data.book.wanted, false);
  assert(arrived.data.book.createdAt > wished.createdAt);
  assert.deepEqual(
    (await call('public/wishlist/' + again.token)).data.books.map((b) => b.title),
    ['Zâna Măseluță'],
  );
  // Going the other way keeps the day it was first added.
  const wishedAgain = await call(
    'books/' + ids[1],
    'PATCH',
    { changes: { wanted: true }, base: { wanted: false } },
    c,
  );
  assert.equal(wishedAgain.data.book.createdAt, arrived.data.book.createdAt);
});

test('the bookshelf filters lent books, sorts by finished day and counts a year of reading', async () => {
  const { visibleBooks, finishedIn, finishedLabel, lentLabel, ratingLabel, localDay, tr } =
    await import('../web/strings.js');
  const book = (title, more = {}) => ({
    id: title,
    title,
    authors: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...more,
  });
  const books = [
    book('Alba', { finishedAt: '2026-03-01', lentTo: 'Mara' }),
    book('Bobo', { finishedAt: '2025-12-31' }),
    book('Cuc'),
    book('Dor', { finishedAt: '2026-11-20' }),
  ];
  const shown = (filters) =>
    visibleBooks(
      books,
      { search: '', read: '', fav: false, cover: '', shelf: '', sort: 'tAsc', ...filters },
      'ro',
    ).map((b) => b.title);
  assert.deepEqual(shown({ lent: true }), ['Alba']);
  assert.deepEqual(shown({ lent: false }), ['Alba', 'Bobo', 'Cuc', 'Dor']);
  // Latest finished first; a book with no finished day comes after those that have one.
  assert.deepEqual(shown({ sort: 'finished' }), ['Dor', 'Alba', 'Bobo', 'Cuc']);

  assert.deepEqual(
    [finishedIn(books, '2026'), finishedIn(books, '2025'), finishedIn(books, '2024')],
    [2, 1, 0],
  );
  assert.deepEqual(
    [finishedLabel(1, '2026', 'ro'), finishedLabel(5, '2026', 'ro'), finishedLabel(2, '2026', 'en')],
    ['1 terminată în 2026', '5 terminate în 2026', '2 finished in 2026'],
  );
  assert.equal(lentLabel('Mara', '', 'ro'), 'Împrumutată: Mara');
  assert.match(lentLabel('Mara', '2026-09-30', 'en'), /^Lent to Mara · since 30 Sept? 2026$/);
  assert.match(lentLabel('Mara', '2026-09-30', 'ro'), /^Împrumutată: Mara · din 30 sept\. 2026$/);
  assert.equal(lentLabel('Mara', 'nu e o zi', 'en'), 'Lent to Mara · since ');
  assert.deepEqual([ratingLabel(4, 'ro'), ratingLabel(4, 'en')], ['4 din 5', '4 of 5']);
  assert.equal(localDay(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  assert.match(localDay(), /^\d{4}-\d{2}-\d{2}$/);
  // Every new label exists in both languages.
  for (const key of ['lentOut', 'lend', 'returned', 'finishedAtField', 'ratingField', 'wishlist', 'gotIt'])
    assert.notEqual(tr(key, 'ro'), tr(key, 'en'), key);
});
