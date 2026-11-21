// Covers for editions the book catalogues do not hold, found through Brave's image search.
//
// Two fixed hosts are contacted and no others: the search API, and Brave's own image proxy,
// which serves a 500-pixel copy of every result. No address from a search result is fetched
// unless it is on that proxy. A result is used only when it comes from a known bookshop or
// publisher page whose title names this book, and the family still chooses the cover.
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { CoverSourceError } from './google-covers.js';

const source = 'bravesearch';
const fold = s => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const squash = s => fold(s).replace(/ /g, '');

// Pages that show the real cover of an edition: Romanian bookshops, second-hand sellers and
// publishers first, then the large international ones for the English books on the shelves.
const bookSites = ['libris.ro', 'carturesti.ro', 'cartepedia.ro', 'elefant.ro', 'emag.ro', 'altex.ro', 'bookzone.ro',
  'librarie.net', 'books-express.ro', 'libhumanitas.ro', 'librariadelfin.ro', 'librariaeminescu.ro', 'dol.ro',
  'anticariat-unu.ro', 'targulcartii.ro', 'printrecarti.ro', 'anticexlibris.ro',
  'humanitas.ro', 'litera.ro', 'nemira.ro', 'polirom.ro', 'editura-art.ro', 'editura-arthur.ro', 'edituragama.ro',
  'raobooks.com', 'edituracorint.ro', 'corint.ro', 'curteaveche.ro', 'edituratrei.ro', 'pandoram.ro',
  'edituraparalela45.ro', 'universenciclopedic.ro', 'edituraunivers.ro', 'editura-casa.ro', 'edituraaramis.ro',
  'niculescu.ro', 'dph.ro', 'edituragirasol.ro', 'meteorpress.ro', 'all.ro', 'teora.ro', 'vellant.ro', 'cartier.md',
  'signatura.ro', 'storiabooks.ro', 'publica.ro', 'cartearomaneasca.ro', 'booklet.ro', 'editurapescarus.ro', 'epica.ro',
  'portocalaalbastra.ro',
  'goodreads.com', 'amazon.com', 'amazon.co.uk', 'amazon.de', 'abebooks.com', 'abebooks.co.uk', 'waterstones.com',
  'worldofbooks.com', 'bookshop.org', 'blackwells.co.uk', 'thriftbooks.com', 'barnesandnoble.com', 'usborne.com',
  'penguin.co.uk', 'penguinrandomhouse.com', 'harpercollins.com', 'harpercollins.co.uk', 'scholastic.com',
  'simonandschuster.com', 'simonandschuster.co.uk', 'dk.com'];

/** The address of a bookshop or publisher page, tidied for storing, or null for any other address. */
export function bookPage(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || u.port ||
        !bookSites.some(site => u.hostname === site || u.hostname.endsWith('.' + site))) return null;
    u.hash = '';
    if (u.href.length > 300) u.search = '';
    return u.href.length > 300 ? u.origin + '/' : u.href;
  } catch { return null; }
}
function proxied(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && u.hostname === 'imgs.search.brave.com' && !u.username && !u.password &&
      !u.port && u.href.length <= 2000 ? u.href : null;
  } catch { return null; }
}
const surnames = authors => String(authors || '').split(/\s*[,;&]\s*|\s+(?:and|și|si)\s+/i)
  .map(name => fold(name).split(' ').pop()).filter(word => word && word.length >= 4);
// The parts of a page title: "Ferma - Editura RAO | Libris" has three.
const parts = heading => heading.split(/\s[-–—|•·]\s|[|:(),]/).map(fold).filter(Boolean);
// A short publisher name ("Art", "Casa") is also an ordinary word. It counts on the publisher's own
// site, as "editura casa", or standing alone as one part of the page title.
function namesPublisher(publisher, heading, text, host) {
  const name = fold(publisher), joined = squash(publisher);
  if (joined.length < 3) return false;
  const site = squash(host.replace(/^www\./, '').replace(/\.[a-z.]{2,6}$/, ''));
  if (site.startsWith(joined) || site.startsWith('editura' + joined) || (joined.length >= 5 && site.includes(joined))) return true;
  return text.includes(' editura ' + name + ' ') || (joined.length >= 5 && text.includes(' ' + name + ' ')) ||
    parts(heading).includes(name);
}

/**
 * How well a search result fits the book, or 0 when it should not be offered.
 * The page title must contain the book's title. A title of one or two words ("Ferma", "Corpul
 * omenesc") also begins other titles, so it needs the author or publisher on the page too, or to
 * be the page's whole leading part ("Ferma - Editura RAO", not "Ferma animalelor").
 */
export function resultFit(book, result) {
  const page = bookPage(result?.url), title = fold(book.title);
  if (!page || !title || typeof result.title !== 'string') return 0;
  const url = new URL(page), heading = ' ' + fold(result.title) + ' ';
  if (!heading.includes(' ' + title + ' ')) return 0;
  let path = '';
  try { path = decodeURIComponent(url.pathname); } catch { path = url.pathname; }
  const text = heading + fold(path) + ' ';
  const author = surnames(book.authors).some(word => text.includes(' ' + word + ' '));
  const publisher = namesPublisher(book.publisher, result.title, text, url.hostname);
  const leading = (parts(result.title)[0] || '').replace(/^cartea? /, '') === title;
  const distinctive = title.split(' ').length >= 3;
  if (!distinctive && !author && !publisher && !leading) return 0;
  return 1 + (author ? 4 : 0) + (publisher ? 2 : 0) + (leading ? 1 : 0);
}

/** The one request shape used for lookups and for checking a new key. */
export function braveSearchUrl(query) {
  return 'https://api.search.brave.com/res/v1/images/search?' + new URLSearchParams({
    q: query, count: '50', country: 'ALL', safesearch: 'strict', spellcheck: '0' });
}
export function braveQuery(book) {
  const plain = s => String(s || '').replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim();
  const context = [plain(book.authors).split(/[,;&]/)[0].trim(), plain(book.publisher)].filter(Boolean);
  // A bare title needs a word that says a book is wanted.
  if (!context.length) context.push(/[ăâîșțşţ]/i.test(book.title) ? 'carte' : 'book');
  return ['"' + plain(book.title) + '"', ...context].join(' ').slice(0, 300);
}
async function bytesOf(response, limit) {
  if (Number(response.headers.get('content-length')) > limit || !response.body) {
    await response.body?.cancel(); throw Error('Unusable response');
  }
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > limit) throw Error('Response too large');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks);
}
const shaped = (width, height) => width >= 150 && height >= 150 && height / width >= 0.6 && height / width <= 2.4;

export async function braveCovers(book, {
  braveKey, fetcher = fetch, beforeRequest = async () => {},
  beforeBraveQuery = async () => {}, blockBrave = async () => {},
  limit = 2, signal = AbortSignal.timeout(25000),
} = {}) {
  if (!braveKey) throw new CoverSourceError('notConfigured', false, source);
  if (squash(book.title).length < 3) return [];
  signal.throwIfAborted();
  await beforeBraveQuery();
  await beforeRequest();
  const response = await fetcher(braveSearchUrl(braveQuery(book)), {
    redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
    headers: { Accept: 'application/json', 'X-Subscription-Token': braveKey },
  });
  if (!response.ok) {
    await response.body?.cancel();
    if ([401, 403, 429].includes(response.status)) {
      const reason = response.status === 429 ? 'quota' : 'access';
      await blockBrave(reason);
      throw new CoverSourceError(reason, false, source);
    }
    throw new CoverSourceError(response.status === 422 ? 'request' : 'unavailable', response.status !== 422, source);
  }
  let rows;
  try { rows = JSON.parse((await bytesOf(response, 1_500_000)).toString('utf8'))?.results; }
  catch { throw new CoverSourceError('unavailable', true, source); }
  const candidates = [];
  (Array.isArray(rows) ? rows : []).forEach((row, order) => {
    const fit = resultFit(book, row), image = proxied(row?.thumbnail?.src);
    const { width, height } = row?.properties || {};
    if (!fit || !image || (Number.isFinite(width) && Number.isFinite(height) && !shaped(width, height))) return;
    const original = typeof row.properties?.url === 'string' ? row.properties.url : image;
    candidates.push({ fit, order, image, page: bookPage(row.url),
      id: createHash('sha256').update(original).digest('hex').slice(0, 32) });
  });
  candidates.sort((a, b) => b.fit - a.fit || a.order - b.order);
  const covers = [], prints = [];
  // One search and at most four downloads per lookup.
  for (const candidate of candidates.slice(0, 4)) {
    try {
      signal.throwIfAborted();
      await beforeRequest();
      const picture = await fetcher(candidate.image, {
        redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
        headers: { Accept: 'image/jpeg,image/png,image/webp' },
      });
      if (!picture.ok) { await picture.body?.cancel(); continue; }
      const bytes = await bytesOf(picture, 1_600_000);
      const meta = await sharp(bytes, { limitInputPixels: 20_000_000 }).metadata();
      if (!['jpeg', 'png', 'webp'].includes(meta.format) || (meta.pages || 1) > 1 || !shaped(meta.width, meta.height)) continue;
      // Shops reuse the publisher's picture: the same cover from two sites is one suggestion.
      const pixels = await sharp(bytes, { limitInputPixels: 20_000_000 }).resize(24, 32, { fit: 'fill' })
        .toColourspace('srgb').removeAlpha().raw().toBuffer();
      if (prints.some(prior => pixels.reduce((sum, v, i) => sum + Math.abs(v - prior[i]), 0) / pixels.length < 7)) continue;
      prints.push(pixels);
      covers.push({ data: 'data:image/' + meta.format + ';base64,' + bytes.toString('base64'),
        source, sourceId: candidate.id, sourceUrl: candidate.page });
      if (covers.length >= limit) break;
    } catch { /* A picture that cannot be read is simply not offered. */ }
  }
  return covers;
}
