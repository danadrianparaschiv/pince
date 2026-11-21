import sharp from 'sharp';
import { cleanISBN, titleMatches, authorMatches } from './cover-source.js';

export class CoverSourceError extends Error {
  constructor(reason, retryable = true, source = 'googlebooks') {
    super((source === 'googlebooks' ? 'Google Books' : 'Brave Search') + ': ' + reason);
    this.reason = reason;
    this.source = source;
    this.retryable = retryable;
  }
}
const validId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id);
export function safeGoogleImage(value, volumeId) {
  try {
    const u = new URL(value);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.port ||
        u.hostname !== 'books.google.com' || !/^\/books\/(?:publisher\/)?content$/.test(u.pathname) ||
        u.searchParams.get('id') !== volumeId || !validId(volumeId)) return null;
    u.protocol = 'https:';
    // API credentials belong only on the metadata request, never on image URLs.
    u.searchParams.delete('key');
    return u.href;
  } catch { return null; }
}
async function bodyBytes(response, limit) {
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel(); throw new CoverSourceError('responseTooLarge', false);
  }
  if (!response.body) throw new CoverSourceError('emptyResponse');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > limit) throw new CoverSourceError('responseTooLarge', false);
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks);
}
export async function googleBooksCovers(book, {
  apiKey, fetcher = fetch, beforeRequest = async () => {},
  beforeGoogleQuery = async () => {}, blockGoogle = async () => {},
  limit = 2, signal = AbortSignal.timeout(35000),
} = {}) {
  if (!apiKey) throw new CoverSourceError('notConfigured', false);
  const isbn = cleanISBN(book.isbn), hasISBN = /^(?:\d{9}[\dX]|\d{13})$/.test(isbn);
  const quote = s => '"' + String(s).replace(/["\\]/g, ' ').trim() + '"';
  const titleQuery = 'intitle:' + quote(book.title);
  const queries = [...(hasISBN ? ['isbn:' + isbn] : []),
    titleQuery + (book.authors?.trim() ? ' inauthor:' + quote(book.authors) : ''),
    ...(!hasISBN && book.authors?.trim() ? [titleQuery] : [])];
  const candidates = new Map(), attempted = new Set();
  let imageFailure;
  const covers = [], fingerprints = [];
  for (const query of queries) {
    signal.throwIfAborted();
    await beforeGoogleQuery();
    await beforeRequest();
    const params = new URLSearchParams({
      q: query, maxResults: '10', printType: 'books',
      fields: 'items(id,volumeInfo(title,authors,industryIdentifiers,imageLinks)),totalItems',
    });
    const response = await fetcher('https://www.googleapis.com/books/v1/volumes?' + params, {
      redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
      headers: { Accept: 'application/json', 'X-Goog-Api-Key': apiKey },
    });
    if (!response.ok) {
      await response.body?.cancel();
      if ([400,401,403,429].includes(response.status)) {
        const reason = response.status === 429 ? 'quota' : 'access';
        await blockGoogle(reason);
        throw new CoverSourceError(reason, false);
      }
      throw new CoverSourceError('unavailable');
    }
    const data = JSON.parse((await bodyBytes(response, 1_000_000)).toString('utf8'));
    for (const item of Array.isArray(data.items) ? data.items : []) {
      if (!validId(item?.id)) continue;
      const info = item.volumeInfo || {};
      const isbnMatch = hasISBN && (info.industryIdentifiers || []).some(i =>
        ['ISBN_10','ISBN_13'].includes(i.type) && cleanISBN(i.identifier) === isbn);
      if (!isbnMatch && !(titleMatches(book.title, info.title) && authorMatches(book.authors || '', info.authors || []))) continue;
      const image = safeGoogleImage(info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail, item.id);
      if (image && !attempted.has(item.id)) candidates.set(item.id, image);
    }
    // At most four downloads and two metadata queries per lookup.
    for (const [id, image] of candidates) {
      if (attempted.has(id)) continue;
      if (attempted.size >= 4) break;
      attempted.add(id);
      try {
        signal.throwIfAborted(); await beforeRequest();
        let url = image, response;
        const imageSignal = AbortSignal.any([signal, AbortSignal.timeout(10000)]);
        for (let redirects = 0; redirects <= 3; redirects++) {
          response = await fetcher(url, { redirect: 'manual', signal: imageSignal, headers: { Accept: 'image/*' } });
          if (![301,302,303,307,308].includes(response.status)) break;
          const next = new URL(response.headers.get('location'), url);
          await response.body?.cancel();
          if (redirects === 3 || next.protocol !== 'https:' || next.username || next.password || next.port ||
              !['books.google.com','books.googleusercontent.com'].includes(next.hostname) ||
              (next.hostname === 'books.google.com' && !safeGoogleImage(next.href,id))) {
            throw new CoverSourceError('unsafeImage', false);
          }
          url = next.href;
        }
        if (response.status === 404) { await response.body?.cancel(); continue; }
        if (!response.ok) { await response.body?.cancel(); throw new CoverSourceError('imageUnavailable'); }
        const bytes = await bodyBytes(response, 1_600_000);
        const meta = await sharp(bytes,{limitInputPixels:20_000_000}).metadata();
        if (!['jpeg','png','webp'].includes(meta.format) || meta.width < 50 || meta.height < 70 || (meta.pages || 1) > 1) continue;
        const pixels = await sharp(bytes,{limitInputPixels:20_000_000}).resize(24,32,{fit:'fill'})
          .toColourspace('srgb').removeAlpha().raw().toBuffer();
        if (fingerprints.some(p => p.length === pixels.length &&
            pixels.reduce((sum,v,i)=>sum+Math.abs(v-p[i]),0)/pixels.length < 7)) continue;
        fingerprints.push(pixels);
        covers.push({ data:'data:image/'+meta.format+';base64,'+bytes.toString('base64'),
          source:'googlebooks', sourceId:id, sourceUrl:'https://books.google.com/books?id='+encodeURIComponent(id) });
        if (covers.length >= limit) return covers;
      } catch (error) { imageFailure = error; }
    }
    if (covers.length >= limit) break;
  }
  if (!covers.length && imageFailure) throw imageFailure;
  return covers;
}
