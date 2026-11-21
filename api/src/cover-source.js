import { createHash } from 'node:crypto';
import sharp from 'sharp';

const fold = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export const cleanISBN = (s) => String(s || '').replace(/[-\s]/g, '').toUpperCase();
export const coverFingerprint = (book) => createHash('sha256')
  .update(JSON.stringify([fold(book.title), fold(book.authors), cleanISBN(book.isbn)])).digest('hex');
export function titleMatches(expected, actual) {
  const titles = s => String(s || '').split('/').map(part =>
    fold(part.split(/[:([–—]/)[0].replace(/['’]/g, '')).replace(/^(?:the|an|a) /, ''));
  return titles(expected).some(a => a && titles(actual).includes(a));
}
export function authorMatches(expected, authors) {
  if (!expected.trim()) return true;
  const names = expected.split(/\s*(?:&|;)\s*|\s+(?:and|și)\s+/i).filter(s => s.trim());
  if (names.length > 1) return names.some(name => authorMatches(name, authors));
  const words = fold(expected).split(' ').filter(w => w.length > 2);
  return authors.some(author => {
    const actual = fold(author).split(' ');
    return words.length && actual.filter(w => words.includes(w)).length >= Math.min(2, words.length);
  });
}
/**
 * How this library names itself to the open catalogues. They ask clients to say who is calling;
 * the address is the deployment's own, read from its settings, and is left out when unset.
 */
export function clientName(env = process.env) {
  let site = '';
  try {
    const origin = new URL(env.PUBLIC_APP_ORIGIN || env.LIBRARY_API_ORIGIN);
    if (origin.protocol === 'https:' && !origin.username && !origin.password) site = ' (+' + origin.origin + ')';
  } catch { /* No address configured. */ }
  return 'Pince/1.2' + site;
}

// Only fixed HTTPS endpoints are contacted. No URL supplied by a user or by
// an external search result is fetched. Image redirects are limited to the
// official Internet Archive cover archive; oversized bodies fail closed.
export async function openLibraryCovers(book, { fetcher = fetch, beforeRequest = async () => {} } = {}) {
  const deadline = AbortSignal.timeout(110000);
  async function request(path, image = false) {
    deadline.throwIfAborted();
    await beforeRequest();
    const signal = AbortSignal.any([deadline, AbortSignal.timeout(18000)]);
    const options = {
      redirect: 'manual', signal,
      headers: { 'User-Agent': clientName(), Accept: image ? 'image/jpeg' : 'application/json' },
    };
    let url = (image ? 'https://covers.openlibrary.org' : 'https://openlibrary.org') + path;
    let response;
    for (let redirects = 0; redirects <= 4; redirects++) {
      response = await fetcher(url, options);
      if (![301,302,303,307,308].includes(response.status)) break;
      const next = new URL(response.headers.get('location'), url);
      await response.body?.cancel();
      const archiveFile = /^\/(?:download|\d+\/items)\/(?:l_covers_\d+|olcovers\d+)\//.test(next.pathname) ||
        (next.pathname === '/view_archive.php' &&
         /^\/\d+\/items\/(?:l_covers_\d+|olcovers\d+)\/(?:l_covers_\d+_\d+|olcovers\d+-[SML])\.zip$/.test(next.searchParams.get('archive') || '') &&
         /^\d+-[SML]\.jpg$/.test(next.searchParams.get('file') || ''));
      if (!image || redirects === 4 || next.protocol !== 'https:' || next.username || next.password || next.port ||
          !/^(?:archive\.org|ia\d+\.us\.archive\.org|ia\d+\.archive\.org)$/.test(next.hostname) ||
          !archiveFile) throw new Error('Unexpected cover redirect');
      url = next.href;
    }
    if (response.status === 404) { await response.body?.cancel(); return null; }
    if (!response.ok) { await response.body?.cancel(); throw new Error('Cover source unavailable'); }
    const limit = image ? 1_600_000 : 1_000_000;
    if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new Error('Cover source too large'); }
    const reader = response.body.getReader(), chunks = []; let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.length; if (size > limit) throw new Error('Cover source too large');
        chunks.push(Buffer.from(value));
      }
    } finally { await reader.cancel(); }
    const data = Buffer.concat(chunks);
    return image ? data : JSON.parse(data.toString('utf8'));
  }
  const ids = [], add = values => {
    for (const id of values || []) if (Number.isSafeInteger(id) && id > 0 && !ids.includes(id)) ids.push(id);
  };
  let work;
  const isbn = cleanISBN(book.isbn);
  if (/^(?:\d{9}[\dX]|\d{13})$/.test(isbn)) {
    const edition = await request('/isbn/' + isbn + '.json');
    if (edition) { add(edition.covers); work = edition.works?.[0]?.key; }
  }
  if (!work) {
    // General search also indexes translated edition titles. A title-only field
    // search can miss a work whose canonical title is in another language.
    const query = new URLSearchParams({ q: book.title, limit: '10',
      fields: 'key,title,author_name,cover_i,edition_count,editions,editions.title,editions.cover_i',
      lang: /[ăâîșț]/i.test(book.title) ? 'ro' : 'en' });
    if (book.authors.trim()) query.set('author', book.authors);
    const results = await request('/search.json?' + query);
    const match = results?.docs?.filter(d => [d.title, ...(d.editions?.docs || []).map(e => e.title)].some(title => titleMatches(book.title, title)) && authorMatches(book.authors, d.author_name || []))
      .sort((a,b) => (b.edition_count || 0) - (a.edition_count || 0))[0];
    if (match) {
      work = match.key;
      add((match.editions?.docs || []).filter(e => titleMatches(book.title,e.title)).map(e => e.cover_i));
      add([match.cover_i]);
    }
  }
  if (typeof work !== 'string' || !/^\/works\/OL\d+W$/.test(work)) work = null;
  if (work && ids.length < 4) add((await request(work + '.json'))?.covers);
  // An edition's cover can differ from the work's representative cover.
  if (work && ids.length < 2) {
    const editions = await request(work + '/editions.json?limit=30');
    for (const edition of editions?.entries || []) {
      if (titleMatches(book.title, edition.title)) add(edition.covers);
    }
  }
  const result = [], fingerprints = new Set();
  for (const id of ids.slice(0, 6)) {
    const bytes = await request('/b/id/' + id + '-L.jpg?default=false', true);
    if (!bytes) continue;
    try {
      const img = sharp(bytes, { limitInputPixels: 20_000_000 });
      const meta = await img.metadata();
      if (!['jpeg','png','webp'].includes(meta.format) || meta.width < 50 || meta.height < 70) continue;
      // Compare decoded pixels as well as source IDs, so resized copies are not alternatives.
      const pixels = await img.clone().resize(24,32,{fit:'fill'}).removeAlpha().raw().toBuffer();
      if ([...fingerprints].some(old => {
        const prior = Buffer.from(old, 'base64');
        return pixels.reduce((sum,v,i) => sum + Math.abs(v-prior[i]),0) / pixels.length < 7;
      })) continue;
      fingerprints.add(pixels.toString('base64'));
      result.push({ data: 'data:image/' + meta.format + ';base64,' + bytes.toString('base64'),
        source: 'openlibrary', sourceId: String(id), sourceUrl: 'https://openlibrary.org' + (work || '/isbn/' + isbn) });
    } catch { continue; }
    if (result.length === 2) break;
  }
  return result;
}
