// One small request to an outside service, to learn whether its key works before the key is saved.
// Each request has the shape the library itself sends, so a check that passes means the feature
// will work. The answer is `{ ok: true }`, or `{ ok: false, status }` with the HTTP status, where
// 0 means the service did not answer at all. Nothing here stores or prints a key.
import { braveQuery, braveSearchUrl } from '../api/src/brave-covers.js';
import { validModelEndpoint, validTextEndpoint } from '../api/src/endpoints.js';

async function outcome(send) {
  try {
    const response = await send({ redirect: 'error', signal: AbortSignal.timeout(20000) });
    await response.body?.cancel();
    return response.ok ? { ok: true } : { ok: false, status: response.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

export const checks = {
  /** A few tokens of text through the vision model's deployment: a small fraction of a cent. */
  recognition: (values, fetcher) =>
    outcome((options) =>
      fetcher(new URL('/openai/v1/chat/completions', values.AZURE_OPENAI_ENDPOINT), {
        ...options,
        method: 'POST',
        headers: { 'api-key': values.AZURE_OPENAI_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: values.AZURE_OPENAI_DEPLOYMENT,
          messages: [{ role: 'user', content: 'Reply with OK.' }],
          max_completion_tokens: 16,
          reasoning_effort: 'minimal',
        }),
      }),
    ),
  /** One blank picture through the text detector. */
  textDetection: (values, fetcher, picture) =>
    outcome((options) =>
      fetcher(
        new URL('/computervision/imageanalysis:analyze?api-version=2024-02-01&features=read', values.AZURE_VISION_ENDPOINT),
        {
          ...options,
          method: 'POST',
          headers: { 'Ocp-Apim-Subscription-Key': values.AZURE_VISION_KEY, 'Content-Type': 'application/octet-stream' },
          body: picture,
        },
      ),
    ),
  googleBooks: (values, fetcher) =>
    outcome((options) =>
      fetcher('https://www.googleapis.com/books/v1/volumes?q=isbn:9780142410370&maxResults=1&fields=totalItems', {
        ...options,
        headers: { 'X-Goog-Api-Key': values.GOOGLE_BOOKS_API_KEY },
      }),
    ),
  /** One image search, which counts against the month's Brave credit like any other. */
  braveSearch: (values, fetcher) =>
    outcome((options) =>
      fetcher(braveSearchUrl(braveQuery({ title: 'Jurnalul unui puști', authors: 'Jeff Kinney', publisher: 'Arthur' })), {
        ...options,
        headers: { Accept: 'application/json', 'X-Subscription-Token': values.BRAVE_SEARCH_API_KEY },
      }),
    ),
};

/** Whether a setting's value has the right form, before anything is sent anywhere. */
export function wellFormed(name, value) {
  if (typeof value !== 'string' || value.length > 300 || /[\s\p{Cc}]/u.test(value) || !value) return false;
  if (name === 'AZURE_OPENAI_ENDPOINT') return validModelEndpoint(value);
  if (name === 'AZURE_VISION_ENDPOINT') return validTextEndpoint(value);
  if (name === 'AZURE_OPENAI_DEPLOYMENT') return /^[\w.-]{1,64}$/.test(value);
  return true;
}
