// Scanned shelf photos, kept for the family only. A book saved from a scan points back at
// its photo; the photo itself is never served to signed-out readers and never becomes a cover.
import sharp from 'sharp';
import { imageBytes, isId, isNewId } from './books.js';
import { change, reject } from './store.js';

const group = 'shelf-photos';
const file = id => 'shelf-' + id + '.jpg';

// A ceiling on kept photos, as there is one on books, so that storage cannot grow without end.
export const maxShelfPhotos = 500;
/** True when a photo was ever kept under this id, also one deleted since. */
export const shelfPhotoKnown = async (store, id) => Boolean(await store.get(group, id));
/**
 * Keep the photo of a finished scan under the scan's own id. An id that already names a photo,
 * for instance one restored from a backup, is refused before anything is written, so a scan
 * cannot replace another photo's picture.
 */
export async function keepShelfPhoto(store, id, bytes, limit = maxShelfPhotos) {
  if (await shelfPhotoKnown(store, id)) throw Error('A shelf photo with this id exists.');
  if (await shelfPhotoCount(store) >= limit) throw Error('The library keeps no more shelf photos.');
  const { width, height } = await sharp(bytes).metadata();
  await store.putImage(file(id), bytes);
  await store.cas(group, id, undefined, { id, at: new Date().toISOString(), width, height });
}
async function photo(store, id) {
  const record = isId(id) ? (await store.get(group, id))?.value : null;
  if (!record || record.deleted) reject(404, 'missing');
  return record;
}
export async function shelfPhotoBytes(store, id) {
  await photo(store, id);
  return store.getImage(file(id));
}
/** Newest first, with how many books still point at each photo. */
export async function listShelfPhotos(store) {
  const linked = new Map();
  for (const book of await store.list('books')) {
    if (!book.deleted && book.shelfPhoto) linked.set(book.shelfPhoto, (linked.get(book.shelfPhoto) || 0) + 1);
  }
  return (await store.list(group)).filter(p => !p.deleted)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .map(p => ({ id: p.id, at: p.at, width: p.width, height: p.height, books: linked.get(p.id) || 0, url: '/api/shelf-photos/' + p.id }));
}
/** Remove a photo for good and drop the links that pointed at it. */
export async function deleteShelfPhoto(store, id) {
  await photo(store, id);
  await change(store, group, id, () => ({ id, deleted: true }));
  await store.deleteImage(file(id));
  for (const book of await store.list('books')) {
    if (book.deleted || book.shelfPhoto !== id) continue;
    await change(store, 'books', book.id, current =>
      current && !current.deleted && current.shelfPhoto === id ? { ...current, shelfPhoto: null, shelfPlace: null } : current);
  }
}
/** Every kept photo as a backup carries it: its record and the picture as a data URL. */
export async function* backupShelfPhotos(store) {
  const kept = (await store.list(group)).filter(p => !p.deleted).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  for (const p of kept)
    yield { type: 'shelf-photo', id: p.id, at: p.at, data: 'data:image/jpeg;base64,' + (await store.getImage(file(p.id))).toString('base64') };
}
export const shelfPhotoCount = async (store) => (await store.list(group)).filter(p => !p.deleted).length;
/**
 * Bring photos back from a backup, before the books that point at them. Each picture is
 * decoded and written again like any upload. A photo this library already holds is left as it is.
 */
export async function restoreShelfPhotos(store, rows, limit = maxShelfPhotos) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 4) reject(400, 'invalid');
  if (rows.some(row => !row || !isNewId(row.id) || typeof row.at !== 'string' || !Number.isFinite(Date.parse(row.at)))) reject(400, 'invalid');
  let count = 0, kept = await shelfPhotoCount(store);
  for (const row of rows) {
    const old = await store.get(group, row.id);
    if (old && !old.value.deleted) continue;
    if (kept++ >= limit) reject(409, 'libraryFull');
    // A shelf photo is kept at up to 2048 pixels, so it may be larger than a cover.
    const bytes = await imageBytes(row.data, 2048, 85, 3_000_000);
    const { width, height } = await sharp(bytes).metadata();
    await store.putImage(file(row.id), bytes);
    if (await store.cas(group, row.id, old?.etag, { id: row.id, at: new Date(row.at).toISOString(), width, height })) count++;
  }
  return { count };
}
