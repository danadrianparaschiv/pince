import { setTimeout as delay } from 'node:timers/promises';
import { findCovers } from './cover-providers.js';
import { CoverSourceError } from './google-covers.js';
import { isId } from './books.js';

export async function processQueuedCover(message, env, provider = findCovers, fetcher = fetch) {
  const origin = new URL(env.LIBRARY_API_ORIGIN);
  if (origin.protocol !== 'https:') throw new Error('HTTPS library origin required');
  async function call(action, attempt, body) {
    // Keep the job credential separate from the managed proxy's Authorization header.
    const headers = { 'X-Library-Cover-Token': message.token };
    if (attempt) headers['X-Cover-Attempt'] = String(attempt);
    if (body) headers['Content-Type'] = 'application/json';
    const response = await fetcher(new URL('/api/cover-jobs/' + message.id + '/' + action, origin), {
      method: 'POST', headers, body: body && JSON.stringify(body),
      redirect: 'error', signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error('Cover API returned HTTP ' + response.status);
    return response.json();
  }
  const claim = await call('claim');
  if (claim.state === 'done' || claim.state === 'waiting') return claim.state;
  if (claim.state !== 'claimed') throw new Error('Unexpected cover claim');
  const { attempt, metadata } = claim;
  let result;
  try {
    result = await provider(metadata, {
      apiKey: env.GOOGLE_BOOKS_API_KEY,
      beforeRequest: () => delay(1100),
      beforeGoogleQuery: async () => {
        const usage = await call('google-query', attempt);
        if (usage.blocked) throw new CoverSourceError(usage.blocked, false);
      },
      blockGoogle: reason => call('google-block', attempt, { reason }),
      braveKey: env.BRAVE_SEARCH_API_KEY,
      beforeBraveQuery: async () => {
        const usage = await call('brave-query', attempt);
        if (usage.blocked) throw new CoverSourceError(usage.blocked, false, 'bravesearch');
      },
      blockBrave: reason => call('brave-block', attempt, { reason }),
    });
  } catch (error) {
    const failure = await call('fail', attempt, { source: error.source, reason: error.reason,
      retryable: error.retryable !== false });
    return failure.state;
  }
  return (await call('complete', attempt, result)).state;
}

// Receive only when ready to work. A crash leaves the original message for
// redelivery. The visibility window exceeds the provider and API timeouts.
export async function drainCoverQueue(queue, processJob, now = Date.now) {
  const deadline = now() + 120_000;
  while (now() < deadline) {
    const { receivedMessageItems: [item] } = await queue.receiveMessages({
      numberOfMessages: 1, visibilityTimeout: 360,
    });
    if (!item) return;
    let job;
    try { job = JSON.parse(Buffer.from(item.messageText, 'base64').toString('utf8')); }
    catch { /* Discard malformed queue entries. */ }
    if (!isId(job?.id) || !isId(job?.token) || await processJob(job) === 'done')
      await queue.deleteMessage(item.messageId, item.popReceipt);
  }
}
