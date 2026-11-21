import { coverProvenance, isId } from './books.js';
import { authorizedAttempt, claimCoverJob, failCoverJob, finishCoverJob } from './cover-jobs.js';
import { braveRequestBudget, googleRequestBudget } from './cover-providers.js';
import { CoverSourceError } from './google-covers.js';
import { reject } from './store.js';

const providers = ['openlibrary', 'googlebooks', 'bravesearch'];
function validCover(c) {
  if (!c || !providers.includes(c.source) || typeof c.sourceId !== 'string' ||
      typeof c.data !== 'string' || !c.data || c.data.length > 2_150_000 ||
      typeof c.sourceUrl !== 'string' || c.sourceUrl.length > 300) return false;
  return coverProvenance(c).sourceUrl === c.sourceUrl;
}

// The queue carries a random per-job bearer secret. Never return it through a
// book view or include it in a URL. All mutation rights end with this attempt.
export async function coverWorkerAction(store, req, id, action, readBody) {
  const token = req.headers.get('x-library-cover-token');
  if (!isId(id) || !isId(token)) reject(401, 'unauthenticated');
  const job = { id, token };
  if (action === 'claim') return claimCoverJob(store, job);
  const attempt = Number(req.headers.get('x-cover-attempt'));
  await authorizedAttempt(store, job, attempt);
  if (action === 'complete') {
    const { covers, warnings = [] } = await readBody(4_400_000);
    if (!Array.isArray(covers) || covers.length > 2 || !covers.every(validCover) ||
        !Array.isArray(warnings) || warnings.length > providers.length || !warnings.every(w => providers.includes(w)))
      reject(400, 'invalid');
    await finishCoverJob(store, job, attempt, { covers, warnings });
    return { state: 'done' };
  }
  if (action === 'fail') {
    const { source, reason, retryable } = await readBody(1024);
    if (typeof retryable !== 'boolean') reject(400, 'invalid');
    return failCoverJob(store, job, attempt, { retryable,
      source: providers.includes(source) ? source : null,
      reason: typeof reason === 'string' && /^[a-zA-Z]{1,32}$/.test(reason) ? reason : 'unavailable' });
  }
  // The worker holds the keys but not the library's storage, so the request counts live here.
  const [service, step] = action.split('-');
  const budget = service === 'google' ? googleRequestBudget(store) : service === 'brave' ? braveRequestBudget(store) : null;
  const [before, block] = budget ? Object.values(budget) : [];
  if (budget && step === 'query') {
    try { await before(); }
    catch (error) {
      if (error instanceof CoverSourceError) return { blocked: error.reason };
      throw error;
    }
  } else if (budget && step === 'block') {
    const { reason } = await readBody(1024);
    if (!['access', 'quota'].includes(reason)) reject(400, 'invalid');
    await block(reason);
  } else reject(404, 'missing');
  return { ok: true };
}
