// Backs up and restores the library on this computer from the command line.
// The file is the same one **Family settings** downloads in the app, so either can restore the other,
// and a backup made here can be restored into a library on Azure.
//   npm run backup [-- file.ndjson]      write every book, its covers, notes and shelf photos to a file
//   npm run restore -- file.ndjson       add the books and shelf photos in a file to this library
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { addBooks, coverBytes, view } from '../api/src/books.js';
import { backupShelfPhotos, restoreShelfPhotos, shelfPhotoCount } from '../api/src/shelf-photos.js';
import { dataFolder, loadLocalEnv } from './local-env.js';

// The marker predates the project's name and stays, so that every earlier backup still restores.
// Version 4 added the shelf photos, as lines of their own before the books, and the lending,
// reading and wishlist fields of each book.
const format = 'family-library', version = 4;
const provenance = (cover) => ({ source: cover.source, sourceId: cover.sourceId, sourceUrl: cover.sourceUrl });

/**
 * A first line that says how many books and shelf photos follow, then one line per photo and one
 * per book. Photos come first, so that a restore has them when the books arrive. `write`
 * receives each line.
 */
export async function writeBackup(store, write) {
  const books = (await store.list('books')).filter((book) => !book.deleted);
  await write(JSON.stringify({ format, version, count: books.length, photos: await shelfPhotoCount(store) }) + '\n');
  for await (const photo of backupShelfPhotos(store)) await write(JSON.stringify(photo) + '\n');
  for (const stored of books) {
    const book = view(stored);
    const image = async (address) =>
      'data:image/jpeg;base64,' + (await coverBytes(store, book.id, address.split('/').pop(), false, true)).toString('base64');
    const row = {
      id: book.id, title: book.title, authors: book.authors, isbn: book.isbn, publisher: book.publisher,
      publishedDate: book.publishedDate, note: book.note, read: book.read, favorite: book.favorite,
      finishedAt: book.finishedAt, rating: book.rating, lentTo: book.lentTo, lentAt: book.lentAt, wanted: book.wanted,
      createdAt: book.createdAt, catalogSource: book.catalogSource,
      shelfPhoto: book.shelfPhoto?.id, shelfPlace: book.shelfPhoto?.place || undefined,
    };
    if (book.cover) {
      row.coverData = await image(book.cover);
      const chosen = book.coverOptions.find((option) => option.cover === book.cover);
      row.coverProvenance = chosen && provenance(chosen);
    }
    row.alternateCovers = [];
    for (const option of book.coverOptions.filter((other) => other.cover !== book.cover).slice(0, 3))
      row.alternateCovers.push({ data: await image(option.cover), ...provenance(option) });
    await write(JSON.stringify(row) + '\n');
  }
  return books.length;
}

/** Adds the shelf photos and books in a backup to the store. One that is already there is left as it is. */
export async function readBackup(store, lines) {
  let count = null, photos = 0, seenPhotos = 0, parsed = 0, restored = 0, batch = [];
  const ids = new Set(), photoIds = new Set();
  const flush = async () => {
    if (!batch.length) return;
    restored += (await addBooks(store, batch, true)).count;
    batch = [];
  };
  for await (const text of lines) {
    if (!text.trim()) continue;
    if (text.length > 8_800_000) throw new Error('A line of the backup is too long.');
    const row = JSON.parse(text);
    if (count === null) {
      if (row.format !== format || ![1, 2, 3, 4].includes(row.version) || !Number.isSafeInteger(row.count) || row.count < 0 ||
          (row.photos !== undefined && (row.version < 4 || !Number.isSafeInteger(row.photos) || row.photos < 0)))
        throw new Error('This is not a backup file of the library.');
      count = row.count;
      photos = row.photos || 0;
      continue;
    }
    if (row.type === 'shelf-photo') {
      // Photos are listed before any book, each once.
      if (parsed || seenPhotos >= photos || typeof row.id !== 'string' || photoIds.has(row.id))
        throw new Error('The backup lists a shelf photo twice, out of place, or more photos than it declares.');
      photoIds.add(row.id);
      seenPhotos++;
      await restoreShelfPhotos(store, [row]);
      continue;
    }
    if (parsed >= count || typeof row.id !== 'string' || ids.has(row.id)) throw new Error('The backup lists a book twice or more books than it declares.');
    ids.add(row.id);
    parsed++;
    batch.push(row);
    if (batch.length === 20) await flush();
  }
  if (count === null || count !== parsed) throw new Error('The backup is incomplete: it declares ' + (count ?? 'no') + ' books and holds ' + parsed + '.');
  if (photos !== seenPhotos) throw new Error('The backup is incomplete: it declares ' + photos + ' shelf photos and holds ' + seenPhotos + '.');
  await flush();
  return restored;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadLocalEnv();
  const [action, name] = process.argv.slice(2);
  const stop = (message) => { console.error(message); process.exit(1); };
  if (!['backup', 'restore'].includes(action)) stop('Usage: npm run backup [-- file.ndjson]   or   npm run restore -- file.ndjson');
  const folder = dataFolder();
  if (!existsSync(resolve(folder, 'library.sqlite')) && action === 'backup') stop('There is no library in ' + folder + ' to back up.');
  const { LocalStore } = await import('./local-store.js');
  const store = new LocalStore(folder);
  try {
    if (action === 'backup') {
      const file = resolve(name || 'pince-backup-' + new Date().toISOString().slice(0, 10) + '.ndjson');
      if (existsSync(file)) stop(file + ' already exists; choose another name.');
      // Readable by this user only: a backup holds private notes.
      const out = createWriteStream(file, { flags: 'wx', mode: 0o600 });
      const count = await writeBackup(store, async (line) => { if (!out.write(line)) await once(out, 'drain'); });
      out.end();
      await once(out, 'finish');
      console.log('Backed up ' + count + ' book' + (count === 1 ? '' : 's') + ' to ' + file);
    } else {
      if (!name || !existsSync(resolve(name))) stop('Name the backup file to restore: npm run restore -- file.ndjson');
      const lines = createInterface({ input: createReadStream(resolve(name), 'utf8'), crlfDelay: Infinity });
      const count = await readBackup(store, lines);
      console.log('Restored ' + count + ' book' + (count === 1 ? '' : 's') + ' into ' + folder + '. Books that were already there were left as they are.');
    }
  } catch (error) {
    // The library's own refusals carry a short code, such as `invalid` for a book it cannot accept.
    const reason = error.status ? 'a book or shelf photo in the file was refused (' + error.code + ').' : error.message;
    stop((action === 'backup' ? 'The backup failed: ' : 'The restore stopped: ') + reason);
  } finally {
    store.db.close();
  }
}
