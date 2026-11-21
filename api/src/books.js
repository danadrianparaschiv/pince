import { bookFields, readBookField } from './book-metadata.js';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { change, reject } from './store.js';
import { bookPage } from './brave-covers.js';
export const isId = (value) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
// An id that will name a new file is taken in lower case only. Some file systems fold case, and
// there the upper-case form of an existing id would otherwise overwrite that file.
export const isNewId = (value) => isId(value) && value === value.toLowerCase();
export function coverOptions(book) {
  const options = book.coverOptions || [];
  return book.image && !options.some((c) => c.key === book.image)
    ? [{ key: book.image, source: 'upload' }, ...options] : options;
}
export const coverUrl = (id, key) => '/api/covers/' + id + '/' + key;
// Restore only known provenance, rebuilding Google links from a validated ID.
export function coverProvenance(cover) {
  if (cover?.source === 'googlebooks' && /^[A-Za-z0-9_-]{1,80}$/.test(cover.sourceId || ''))
    return { source: 'googlebooks', sourceId: cover.sourceId,
      sourceUrl: 'https://books.google.com/books?id=' + cover.sourceId };
  if (cover?.source === 'openlibrary' && /^\d{1,16}$/.test(cover.sourceId || '') &&
      /^https:\/\/openlibrary\.org\/(?:works\/OL\d+W|isbn\/(?:\d{9}[\dX]|\d{13}))$/.test(cover.sourceUrl || ''))
    return { source: cover.source, sourceId: cover.sourceId, sourceUrl: cover.sourceUrl };
  // An image-search cover links only to a known bookshop or publisher page.
  if (cover?.source === 'bravesearch' && /^[0-9a-f]{32}$/.test(cover.sourceId || '') &&
      typeof cover.sourceUrl === 'string' && bookPage(cover.sourceUrl) === cover.sourceUrl)
    return { source: cover.source, sourceId: cover.sourceId, sourceUrl: cover.sourceUrl };
  return {};
}
function textValue(key, value) {
  if (key !== 'note') return readBookField(key, value);
  if (typeof value !== 'string' || value.length > 4000) reject(400, 'invalid');
  return value;
}
function booleanValue(value) {
  if (typeof value !== 'boolean') reject(400, 'invalid');
  return value;
}
// A whole calendar day, as the family's own clock wrote it, or '' for none.
function dayValue(value) {
  if (value === '') return '';
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01') reject(400, 'invalid');
  const day = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== value) reject(400, 'invalid');
  // Not in the future. The family's clock may be most of a day ahead of the server's.
  if (day.getTime() > Date.now() + 86400_000) reject(400, 'invalid');
  return value;
}
// Who has the book: a short name on one line, or '' when it is at home.
function borrowerValue(value) {
  // No control characters, line separators or text-direction overrides, which could reorder what is shown.
  if (typeof value !== 'string' || value.length > 80 || /[\p{Cc}\u2028\u2029\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069]/u.test(value)) reject(400, 'invalid');
  return value.trim();
}
function ratingValue(value) {
  if (!Number.isInteger(value) || value < 0 || value > 5) reject(400, 'invalid');
  return value;
}
const today = () => new Date().toISOString().slice(0, 10);
// Keeps the fields that depend on each other in step, whichever of them a request changed.
// `before` is the book as it was; a day is filled in only at the moment a book is lent or read,
// so a book read long ago is not stamped with today by an unrelated edit.
function settle(book, before = {}) {
  if (!book.lentTo) book.lentAt = '';
  else if (!book.lentAt && !before.lentTo) book.lentAt = today();
  if (!book.read) book.finishedAt = '';
  else if (!book.finishedAt && !before.read) book.finishedAt = today();
  // A wished-for book that arrives joins the shelf as its newest book.
  if (before.wanted && !book.wanted) book.createdAt = new Date().toISOString();
  return book;
}
export function view(book, publicOnly = false) {
  const cover = book.image ? '/api/covers/' + book.id + '/' + book.image : null;
  const result = { id: book.id, title: book.title, authors: book.authors, cover };
  const selected = coverProvenance(coverOptions(book).find(c => c.key === book.image));
  if (selected.source === 'googlebooks') result.coverAttribution = selected;
  const catalog = coverProvenance(book.catalogSource);
  if (catalog.source === 'googlebooks') result.catalogSource = catalog;
  if (publicOnly) return result;
  return {
    ...result,
    thumbnail: cover ? cover + '/thumb' : null,
    isbn: book.isbn,
    publisher: book.publisher ?? '',
    publishedDate: book.publishedDate ?? '',
    note: book.note,
    read: book.read,
    favorite: book.favorite,
    // Family only: when it was finished and how it was liked, who borrowed it, and whether it is
    // still only wished for. Books saved before these existed read as empty.
    finishedAt: book.finishedAt || '',
    rating: book.rating || 0,
    lentTo: book.lentTo || '',
    lentAt: book.lentAt || '',
    wanted: Boolean(book.wanted),
    createdAt: book.createdAt,
    version: book.version,
    // Family only: the shelf photo this book was scanned from, and where its title is in it.
    shelfPhoto: book.shelfPhoto
      ? { id: book.shelfPhoto, url: '/api/shelf-photos/' + book.shelfPhoto, place: book.shelfPlace || null }
      : null,
    coverOptions: coverOptions(book).map((c) => ({
      cover: coverUrl(book.id, c.key), thumbnail: coverUrl(book.id, c.key) + '/thumb',
      source: c.source, sourceId: c.sourceId || null, sourceUrl: c.sourceUrl || null,
    })),
    coverLookup: book.coverLookup ? {
      status: book.coverLookup.status, updatedAt: book.coverLookup.updatedAt,
      warnings: book.coverLookup.warnings || [],
    } : null,
  };
}
export async function getBook(store, id) {
  if (!isId(id)) reject(404, 'missing');
  const row = (await store.get('books', id))?.value;
  if (!row || row.deleted) reject(404, 'missing');
  return row;
}
export async function imageBytes(data, maxWidth, quality, maxBytes = 1_600_000) {
  // Base64 is four characters for three bytes; the rest allows for the prefix and padding.
  if (typeof data !== 'string' || data.length > Math.ceil(maxBytes / 3) * 4 + 16_664) reject(413, 'tooLarge');
  const match = /^data:image\/(?:jpeg|png|webp);base64,([\w+/=]+)$/.exec(data);
  if (!match) reject(400, 'invalidImage');
  const input = Buffer.from(match[1], 'base64');
  if (!input.length || input.length > maxBytes) reject(413, 'tooLarge');
  try {
    const img = sharp(input, { limitInputPixels: 20_000_000, failOn: 'error' });
    const meta = await img.metadata();
    if (!['jpeg', 'webp', 'png'].includes(meta.format) || (meta.pages || 1) > 1)
      reject(400, 'invalidImage');
    return await img
      .rotate()
      .resize({ width: maxWidth, height: maxWidth, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
  } catch (e) {
    if (e.code === 'invalidImage') throw e;
    reject(400, 'invalidImage');
  }
}
const filename = (id, key, thumb = false) => id + '-' + key + (thumb ? '-thumb' : '') + '.jpg';
export async function discard(store, id, image) {
  if (image)
    await Promise.allSettled([false, true].map((t) => store.deleteImage(filename(id, image, t))));
}
export async function saveImage(store, id, data) {
  if (!data) return null;
  const full = await imageBytes(data, 900, 81);
  const thumb = await sharp(full)
    .resize({ width: 220, height: 280, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 73 })
    .toBuffer();
  const key = randomUUID();
  // Wait for both writes even if one fails before cleaning the unpublished pair.
  const uploaded = await Promise.allSettled([
    store.putImage(filename(id, key), full),
    store.putImage(filename(id, key, true), thumb),
  ]);
  const error = uploaded.find((x) => x.status === 'rejected');
  if (error) {
    await discard(store, id, key);
    throw error.reason;
  }
  return key;
}
export async function coverBytes(store, id, key, thumb, family = false) {
  const book = await getBook(store, id);
  if (!isId(key) || (book.image !== key && !(family && coverOptions(book).some(c => c.key === key)))) reject(404, 'missing');
  return store.getImage(filename(id, key, thumb));
}
function newBook(row, restore) {
  if (!row || !isId(row.id)) reject(400, 'invalid');
  const b = {
    id: row.id,
    title: textValue('title', row.title),
    authors: textValue('authors', row.authors ?? ''),
    isbn: textValue('isbn', row.isbn ?? ''),
    publisher: readBookField('publisher', row.publisher ?? ''),
    publishedDate: readBookField('publishedDate', row.publishedDate ?? ''),
    note: '',
    favorite: false,
    read: false,
    version: 1,
    createdAt: new Date().toISOString(),
    image: null,
    coverRevision: 0,
    catalogSource: coverProvenance(row.catalogSource),
    shelfPhoto: null,
    shelfPlace: null,
    finishedAt: '',
    rating: 0,
    lentTo: '',
    lentAt: '',
    // A book can be added straight to the wishlist.
    wanted: booleanValue(row.wanted ?? false),
  };
  if (restore) {
    b.note = textValue('note', row.note ?? '');
    b.favorite = booleanValue(row.favorite ?? false);
    b.read = booleanValue(row.read ?? false);
    b.finishedAt = dayValue(row.finishedAt ?? '');
    b.rating = ratingValue(row.rating ?? 0);
    b.lentTo = borrowerValue(row.lentTo ?? '');
    b.lentAt = dayValue(row.lentAt ?? '');
    if (!Number.isFinite(Date.parse(row.createdAt))) reject(400, 'invalid');
    b.createdAt = new Date(row.createdAt).toISOString();
    // Days are kept as the backup has them; one made before they existed restores without any.
    settle(b, b);
  }
  return b;
}
// Where the title sits in its shelf photo, as fractions of the photo's width and height.
function shelfPlace(value) {
  const place = value && typeof value === 'object' ? [value.x, value.y, value.w, value.h, value.angle] : [];
  const [x, y, w, h, angle] = place;
  if (place.length !== 5 || !place.every(Number.isFinite) || x < 0 || x > 1 || y < 0 || y > 1 || w <= 0 || w > 2 ||
      h <= 0 || h > 2 || Math.abs(angle) > Math.PI) return null;
  const round = (n) => Math.round(n * 10000) / 10000;
  return { x: round(x), y: round(y), w: round(w), h: round(h), angle: round(angle) };
}
// A ceiling on the catalogue, so that a looping client cannot grow storage without end.
export const maxBooks = 5000;
export async function addBooks(store, rows, restore = false, limit = maxBooks) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 20) reject(400, 'invalid');
  const drafts = rows.map((r) => newBook(r, restore));
  const held = new Set((await store.list('books')).filter((b) => !b.deleted).map((b) => b.id));
  if (held.size + new Set(drafts.map((b) => b.id).filter((id) => !held.has(id))).size > limit) reject(409, 'libraryFull');
  for (const [index, book] of drafts.entries()) {
    const id = rows[index].shelfPhoto;
    if (id == null) continue;
    if (!isId(id)) reject(400, 'invalid');
    // A book can only point at a photo this library holds; a backup from elsewhere loses the link.
    const photo = (await store.get('shelf-photos', id))?.value;
    if (!photo || photo.deleted) continue;
    book.shelfPhoto = id;
    book.shelfPlace = shelfPlace(rows[index].shelfPlace);
  }
  const result = [];
  for (const [index, book] of drafts.entries()) {
    const old = await store.get('books', book.id);
    if (old && !old.value.deleted) {
      result.push(view(old.value));
      continue;
    }
    if (old && !restore) reject(409, 'deleted');
    book.image = await saveImage(store, book.id, rows[index].coverData);
    book.coverOptions = coverOptions(book);
    if (restore && book.image) Object.assign(book.coverOptions[0], coverProvenance(rows[index].coverProvenance));
    if (restore && rows[index].alternateCovers !== undefined) {
      const alternatives = rows[index].alternateCovers;
      if (!Array.isArray(alternatives) || alternatives.length > 3) {
        await discard(store, book.id, book.image); reject(400, 'invalid');
      }
      try {
        for (const alternative of alternatives) {
          const key = await saveImage(store, book.id, typeof alternative === 'string' ? alternative : alternative?.data);
          if (!key) reject(400, 'invalidImage');
          book.coverOptions.push({ key, source: 'backup', ...coverProvenance(alternative) });
        }
      } catch (error) {
        for (const c of book.coverOptions) await discard(store, book.id, c.key);
        throw error;
      }
    }
    if (await store.cas('books', book.id, old?.etag, book)) result.push(view(book));
    else {
      for (const c of book.coverOptions) await discard(store, book.id, c.key);
      result.push(view(await getBook(store, book.id)));
    }
  }
  return { count: result.length, books: result };
}
export async function editBook(store, id, body) {
  const { changes, base } = body;
  if (
    !changes ||
    !base ||
    typeof changes !== 'object' ||
    typeof base !== 'object' ||
    Array.isArray(changes)
  )
    reject(400, 'invalid');
  const patch = {};
  const keys = Object.keys(changes);
  if (!keys.length) reject(400, 'invalid');
  for (const key of keys) {
    if (!Object.hasOwn(base, key)) reject(400, 'invalid');
    if (key === 'note' || Object.hasOwn(bookFields, key)) patch[key] = textValue(key, changes[key]);
    else if (['read', 'favorite', 'wanted'].includes(key)) patch[key] = booleanValue(changes[key]);
    else if (['finishedAt', 'lentAt'].includes(key)) patch[key] = dayValue(changes[key]);
    else if (key === 'lentTo') patch[key] = borrowerValue(changes[key]);
    else if (key === 'rating') patch[key] = ratingValue(changes[key]);
    else if (key !== 'cover' || (changes.cover !== null && typeof changes.cover !== 'string'))
      reject(400, 'invalid');
  }
  function validate(book) {
    if (!book || book.deleted) reject(404, 'missing');
    const original = view(book);
    if (keys.some((k) => base[k] !== original[k] && (k === 'cover' || patch[k] !== original[k])))
      reject(409, 'conflict', { book: original });
  }
  const before = await getBook(store, id);
  if (keys.some(key => Object.hasOwn(bookFields, key))) patch.catalogSource = null;
  validate(before);
  let uploaded = false;
  if (Object.hasOwn(changes, 'cover')) {
    const selected = coverOptions(before).find(c => coverUrl(id, c.key) === changes.cover);
    if (selected) patch.image = selected.key;
    else {
      patch.image = await saveImage(store, id, changes.cover);
      uploaded = Boolean(patch.image);
    }
  }
  let saved;
  try {
    saved = await change(store, 'books', id, (book) => {
      validate(book);
      let options = coverOptions(book);
      if (uploaded) options = [...options.filter(c => c.source !== 'upload'), { key: patch.image, source: 'upload' }];
      if (patch.image && !options.some(c => c.key === patch.image)) reject(409, 'conflict', { book: view(book) });
      return settle({ ...book, ...patch, coverOptions: options, version: book.version + 1,
        coverRevision: (book.coverRevision || 0) + (Object.hasOwn(patch, 'image') ? 1 : 0) }, book);
    });
  } catch (e) {
    // On an uncertain storage response a committed image may now be referenced.
    if (e.status && uploaded) await discard(store, id, patch.image);
    throw e;
  }
  for (const c of coverOptions(before)) {
    if (!coverOptions(saved).some(next => next.key === c.key)) await discard(store, id, c.key);
  }
  return view(saved);
}
export async function deleteBook(store, id, version) {
  const before = await getBook(store, id);
  await change(store, 'books', id, (book) => {
    if (!book || book.deleted) reject(404, 'missing');
    if (version !== book.version) reject(409, 'conflict', { book: view(book) });
    return { id, deleted: true };
  });
  for (const c of coverOptions(before)) await discard(store, id, c.key);
}
/**
 * Delete up to 20 books in one request. A book that is already gone counts as deleted;
 * one edited since it was listed is kept and returned so the family can look again.
 */
export async function deleteBooks(store, rows) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 20) reject(400, 'invalid');
  if (rows.some((row) => !row || !isId(row.id) || !Number.isInteger(row.version))) reject(400, 'invalid');
  if (new Set(rows.map((row) => row.id.toLowerCase())).size !== rows.length) reject(400, 'invalid');
  const deleted = [], conflicts = [];
  for (const row of rows) {
    try {
      await deleteBook(store, row.id, row.version);
      deleted.push(row.id);
    } catch (error) {
      if (error.status === 404) deleted.push(row.id);
      else if (error.status === 409 && error.code === 'conflict') conflicts.push(error.extra.book);
      else throw error;
    }
  }
  return { deleted, conflicts };
}
