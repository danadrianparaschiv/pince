// The wishlist is the books the family wants but does not have. It is private like the rest of
// the library. The parent can switch on one public link to it, for people looking for a present,
// and switch it off or replace it at any time.
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { isId, view } from './books.js';
import { change, reject } from './store.js';

const group = 'system', key = 'wishlist-share';
const state = (value) => ({ shared: Boolean(value?.token), token: value?.token || null });
const digest = (text) => createHash('sha256').update(text).digest();

export const wishlistSharing = async (store) => state((await store.get(group, key))?.value);

/** `{ shared }` switches the link on or off; `{ shared: true, renew: true }` replaces it. */
export async function setWishlistSharing(store, body) {
  if (typeof body?.shared !== 'boolean' || (body.renew !== undefined && typeof body.renew !== 'boolean')) reject(400, 'invalid');
  // Switching off forgets the token, so an old link never works again.
  return state(await change(store, group, key, (current) =>
    ({ token: !body.shared ? null : body.renew || !current?.token ? randomUUID() : current.token })));
}

/** What a stranger with the link sees: title, authors and cover of each wished-for book. */
export async function sharedWishlist(store, token) {
  const current = (await store.get(group, key))?.value?.token;
  // The same answer whether sharing is off or the token is wrong.
  if (!isId(token) || !current || !timingSafeEqual(digest(token.toLowerCase()), digest(current))) reject(404, 'missing');
  const books = (await store.list('books')).filter((book) => !book.deleted && book.wanted)
    .sort((a, b) => a.title.localeCompare(b.title, 'ro') || a.id.localeCompare(b.id));
  return { books: books.map((book) => view(book, true)) };
}
