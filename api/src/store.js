import { setTimeout as delay } from 'node:timers/promises';

// Compare-and-swap is shared by the local SQLite and Azure Table adapters.
// The callback must be side-effect free; a competing update can run it again.
export async function change(store, group, key, update) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const current = await store.get(group, key);
    const next = update(current?.value ?? null);
    if (await store.cas(group, key, current?.etag, next)) return next;
    await delay(Math.random() * (attempt + 1) * 4);
  }
  throw new HttpError(409, 'busy');
}
export class HttpError extends Error {
  constructor(status, code, extra = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}
export const reject = (status, code, extra) => {
  throw new HttpError(status, code, extra);
};
