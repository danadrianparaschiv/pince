import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { change, reject } from './store.js';
import { getBook, view, coverOptions, saveImage, discard } from './books.js';
import { coverFingerprint } from './cover-source.js';
import { braveRequestBudget, findCovers, googleRequestBudget } from './cover-providers.js';

const active = s => ['queued', 'searching'].includes(s);
export async function requestCovers(store, id, { retry = false } = {}) {
  const before = await getBook(store, id), fingerprint = coverFingerprint(before), prior = before.coverLookup;
  const age = Date.now() - Date.parse(prior?.updatedAt || 0);
  if (prior?.fingerprint === fingerprint) {
    if (active(prior.status) && age < 10 * 60_000) return view(before);
    if (!retry && !active(prior.status)) return view(before);
    if (retry && age < 60_000) reject(429, 'throttle');
  }
  const token = randomUUID();
  const book = await change(store, 'books', id, b => {
    if (!b || b.deleted) reject(404, 'missing');
    // A concurrent metadata change wins; its own save schedules the lookup.
    if (coverFingerprint(b) !== fingerprint) reject(409, 'busy');
    if (b.coverLookup?.token !== prior?.token) reject(409, 'busy');
    return { ...b, coverLookup: { token, fingerprint, status: 'queued', attempts: 0, updatedAt: new Date().toISOString() } };
  });
  try { await store.enqueueCover({ id, token }); }
  catch {
    const failed = await change(store, 'books', id, b => b?.coverLookup?.token === token
      ? { ...b, coverLookup: { ...b.coverLookup, status: 'failed', updatedAt: new Date().toISOString() } } : b);
    return view(failed);
  }
  return view(book);
}
// Saving the book succeeds even if lookup scheduling is temporarily unavailable.
export async function scheduleSaved(store, result) {
  if (!store.enqueueCover) return result;
  for (let i = 0; i < result.books.length; i++) {
    try { result.books[i] = await requestCovers(store, result.books[i].id); } catch { /* Retry from edit. */ }
  }
  return result;
}
// Cloud dispatch and the local scheduler each drain one message at a time. The
// per-book attempt also fences late completions after a worker crash or restart.
function jobMatches(book, message) {
  return book && !book.deleted && book.coverLookup?.token === message.token &&
    active(book.coverLookup.status) && coverFingerprint(book) === book.coverLookup.fingerprint;
}
function ownsAttempt(book, message, attempt) {
  return jobMatches(book, message) && book.coverLookup.status === 'searching' &&
    book.coverLookup.attempts === attempt;
}
export async function claimCoverJob(store, message) {
  const row = await store.get('books', message.id);
  const book = row?.value;
  if (!jobMatches(book, message)) return { state: 'done' };
  const job = book.coverLookup;
  if (job.status === 'searching' && Date.now() - Date.parse(job.updatedAt) < 240_000)
    return { state: 'waiting' };
  const exhausted = job.attempts >= 3;
  const attempt = exhausted ? job.attempts : job.attempts + 1;
  const updated = { ...job, attempts: attempt, status: exhausted ? 'failed' : 'searching',
    updatedAt: new Date().toISOString() };
  if (!await store.cas('books', message.id, row.etag, { ...book, coverLookup: updated }))
    return { state: 'waiting' };
  if (exhausted) return { state: 'done' };
  return { state: 'claimed', attempt, metadata: { title: book.title, authors: book.authors, isbn: book.isbn, publisher: book.publisher ?? '' } };
}
export async function authorizedAttempt(store, message, attempt) {
  const book = (await store.get('books', message.id))?.value;
  if (!ownsAttempt(book, message, attempt)) reject(409, 'staleCoverAttempt');
  return book;
}
export async function finishCoverJob(store, message, attempt, result) {
  const { id } = message;
  const book = await authorizedAttempt(store, message, attempt);
  const savedImages = [], fresh = new Set();
  const found = Array.isArray(result) ? result : result.covers;
  const warnings = Array.isArray(result) ? [] : result.warnings || [];
  try {
    for (const c of found.slice(0,2)) {
      const existing = coverOptions(book).find(old => c.sourceId && old.source === c.source && old.sourceId === c.sourceId);
      if (existing) { savedImages.push(existing); continue; }
      const key = await saveImage(store, id, c.data);
      fresh.add(key);
      savedImages.push({ key, source: c.source, sourceUrl: c.sourceUrl, sourceId: c.sourceId });
    }
    let previous;
    const saved = await change(store, 'books', id, b => {
      if (!ownsAttempt(b, message, attempt)) reject(409, 'staleCoverAttempt');
      previous = coverOptions(b);
      const keep = previous.filter(c => !savedImages.some(n => n.key === c.key) && (!['openlibrary','googlebooks','bravesearch'].includes(c.source) || c.key === b.image));
      const options = [...keep, ...savedImages];
      return { ...b, coverOptions: options,
        image: b.image || (!b.coverRevision ? savedImages[0]?.key || null : null),
        version: b.version + 1,
        coverLookup: { ...b.coverLookup, status: found.length ? 'ready' : 'empty', warnings, updatedAt: new Date().toISOString() } };
    });
    for (const c of previous) if (!coverOptions(saved).some(n => n.key === c.key)) await discard(store,id,c.key);
  } catch (error) {
    const current = (await store.get('books', id))?.value;
    // On a lost storage response, never delete a cover that actually committed.
    for (const c of savedImages) if (fresh.has(c.key) && (!current || !coverOptions(current).some(n => n.key === c.key))) await discard(store,id,c.key);
    throw error;
  }
}
export async function failCoverJob(store, message, attempt, error) {
  const saved = await change(store, 'books', message.id, book => {
    if (!ownsAttempt(book, message, attempt)) reject(409, 'staleCoverAttempt');
    const retry = attempt < 3 && error.retryable !== false;
    return { ...book, coverLookup: { ...book.coverLookup, status: retry ? 'queued' : 'failed',
      failureSource: error.source || null, failureReason: error.reason || 'unavailable',
      updatedAt: new Date().toISOString() } };
  });
  return { state: saved.coverLookup.status === 'queued' ? 'waiting' : 'done' };
}
export async function runCoverJob(store, message, { provider = findCovers, wait = delay, env = process.env } = {}) {
  const claim = await claimCoverJob(store, message);
  // The local queue keeps the original job pending while another claim is live.
  if (claim.state !== 'claimed') return claim;
  try {
    const result = await provider(claim.metadata, {
      beforeRequest: () => wait(1100), apiKey: env.GOOGLE_BOOKS_API_KEY, ...googleRequestBudget(store),
      braveKey: env.BRAVE_SEARCH_API_KEY, ...braveRequestBudget(store),
    });
    await finishCoverJob(store, message, claim.attempt, result);
  } catch (error) {
    if (error.code === 'staleCoverAttempt') return { state: 'done' };
    let outcome;
    try { outcome = await failCoverJob(store, message, claim.attempt, error); }
    catch (failure) {
      if (failure.code === 'staleCoverAttempt') return { state: 'done' };
      throw failure;
    }
    if (outcome.state === 'waiting') await store.enqueueCover(message, 60);
  }
  return { state: 'done' };
}
