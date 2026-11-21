import {
  accountEdit,
  checkLanguage,
  identity,
  listAccounts,
  login,
  publicUser,
  throttle,
} from './auth.js';
import { addBooks, coverBytes, deleteBook, deleteBooks, editBook, getBook, isId, view } from './books.js';
import { configure, getUsage, scan } from './scans.js';
import { change, HttpError, reject } from './store.js';
import { requestCovers, scheduleSaved } from './cover-jobs.js';
import { coverWorkerAction } from './cover-worker-api.js';
import { setWishlistSharing, sharedWishlist, wishlistSharing } from './wishlist.js';
import { reviewBook, validatePhotoReviews } from './book-review.js';
import { deleteShelfPhoto, listShelfPhotos, restoreShelfPhotos, shelfPhotoBytes } from './shelf-photos.js';

const baseHeaders = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};
const json = (value, status = 200, extra = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { ...baseHeaders, 'Content-Type': 'application/json; charset=utf-8', ...extra },
  });
// The server ends a session after a week. The browser keeps the cookie for 180 days, because an
// expired one still tells sign-in that this browser has been here before; see knownDevice.
const cookie = (val, local) =>
  'library_session=' +
  val +
  '; Path=/api; HttpOnly; SameSite=Lax; Max-Age=' +
  (val ? 15552000 : 0) +
  (local ? '' : '; Secure');
const maxBody = 9_000_000;
async function parse(req, publicOrigin, limit = maxBody) {
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
    reject(415, 'invalid');
  const origin = req.headers.get('origin');
  if (origin) {
    // Managed Functions see an internal URL. Pin browser writes to the site's
    // canonical HTTPS origin instead of trusting client-supplied proxy headers.
    if (origin !== (publicOrigin || new URL(req.url).origin)) reject(403, 'forbidden');
  }
  if (req.headers.get('sec-fetch-site') === 'cross-site') reject(403, 'forbidden');
  if (Number(req.headers.get('content-length')) > limit) reject(413, 'tooLarge');
  let bytes = Buffer.alloc(0);
  let size = 0;
  for await (const chunk of req.body || []) {
    const next = size + chunk.byteLength;
    if (next > limit) reject(413, 'tooLarge');
    if (next > bytes.length) {
      const grown = Buffer.allocUnsafe(Math.min(limit, Math.max(1024, bytes.length * 2, next)));
      bytes.copy(grown, 0, 0, size);
      bytes = grown;
    }
    bytes.set(chunk, size);
    size = next;
  }
  try {
    const v = JSON.parse(bytes.toString('utf8', 0, size) || '{}');
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  } catch {
    /* Return a structured validation error to the client. */
  }
  reject(400, 'invalid');
}
// `setup` is given only by the local server: setting the library up from the browser, and the
// parent's service keys afterwards. Without it those addresses do not exist.
export function makeApp({ store, env, local = false, model, reviewProvider, readText, setup }) {
  // Edge quotas handle total bandwidth; this small per-instance limiter also
  // keeps a repeatedly requested public URL from hammering storage.
  const readers = new Map();
  function publicRead(ip) {
    const time = Date.now();
    if (readers.size > 10000) readers.clear();
    const slot = readers.get(ip);
    if (!slot || slot.start + 60000 < time) readers.set(ip, { start: time, count: 1 });
    else if (++slot.count > 900) reject(429, 'throttle');
  }
  return async function handle(req, ip = 'local') {
    try {
      const url = new URL(req.url);
      const path = url.pathname
        .replace(/^\/api\/?/, '')
        .replace(/\/$/, '')
        .split('/');
      const [section, id, key, variant] = path;
      const method = req.method.toUpperCase();
      if (section === 'cover-jobs' && method === 'POST' && path.length === 3) {
        publicRead(ip);
        return json(await coverWorkerAction(store, req, id, key, limit => parse(req, env.PUBLIC_APP_ORIGIN, limit)));
      }
      if (method === 'GET' && section === 'public' && id === 'wishlist' && path.length === 3) {
        publicRead(ip);
        return json(await sharedWishlist(store, key));
      }
      if (method === 'GET' && section === 'public' && path.length === 2) {
        publicRead(ip);
        return json({ book: view(await getBook(store, id), true) });
      }
      if (
        method === 'GET' &&
        section === 'covers' &&
        (path.length === 3 || (path.length === 4 && variant === 'thumb'))
      ) {
        publicRead(ip);
        const bytes = await coverBytes(store, id, key, Boolean(variant), Boolean(await identity(store, req, env)));
        return new Response(new Uint8Array(bytes), {
          headers: { ...baseHeaders, 'Content-Type': 'image/jpeg' },
        });
      }
      const mutating = !['GET', 'HEAD'].includes(method);
      let body;
      if (section === 'setup' && setup) {
        // Says only whether set-up is still waiting, so that the sign-in page can point to it.
        if (method === 'GET' && path.length === 1) return json({ pending: setup.pending() });
        setup.authorize(req.headers.get('x-setup-token'));
        if (method === 'GET' && id === 'state' && path.length === 2) return json(setup.state());
        if (method === 'POST' && path.length === 2 && ['accounts', 'services', 'finish'].includes(id)) {
          body = await parse(req, env.PUBLIC_APP_ORIGIN, 4096);
          if (id === 'accounts') return json(await setup.accounts(body));
          if (id === 'finish') return json(setup.finish());
          await throttle(store, 'service-check', 30, 60000);
          return json(await setup.saveService(body));
        }
        reject(404, 'missing');
      }
      if (section === 'login' && method === 'POST' && path.length === 1) {
        body = await parse(req, env.PUBLIC_APP_ORIGIN, 4096);
        const result = await login(store, env, body, ip, req.headers.get('cookie') || '');
        return json({ user: result.user }, 200, { 'Set-Cookie': cookie(result.token, local) });
      }
      const actor = await identity(store, req, env);
      if (section === 'me' && method === 'GET' && path.length === 1)
        return json({ user: actor ? publicUser(actor.user) : null });
      if (!actor) reject(401, 'unauthenticated');
      const { user, digest } = actor;
      if (section === 'admin' && user.role !== 'parent') reject(403, 'forbidden');
      if (section === 'books' && method === 'DELETE' && user.role !== 'parent') reject(403, 'forbidden');
      if (mutating) {
        const upload = section === 'scan' || section === 'books' || (section === 'admin' && id === 'restore');
        body = await parse(req, env.PUBLIC_APP_ORIGIN, upload ? maxBody : section === 'book-review' ? 12288 : 4096);
      }
      if (section === 'logout' && method === 'POST' && path.length === 1) {
        await change(store, 'users', user.username, (u) => ({
          ...u,
          sessions: u.sessions.filter((s) => s.digest !== digest),
        }));
        return json({ ok: true }, 200, { 'Set-Cookie': cookie('', local) });
      }
      if (section === 'me' && method === 'PATCH' && path.length === 1) {
        const language = checkLanguage(body.language);
        return json({
          user: publicUser(await change(store, 'users', user.username, (u) => ({ ...u, language }))),
        });
      }
      if (section === 'books' && path.length === 1) {
        if (method === 'GET')
          return json({
            books: (await store.list('books')).filter((b) => !b.deleted).map((b) => view(b)),
          });
        if (method === 'POST') {
          await throttle(store, 'add-' + user.username, 120, 60000);
          await validatePhotoReviews(store, body.books);
          return json(await scheduleSaved(store, await addBooks(store, body.books)), 201);
        }
      }
      if (section === 'books' && id === 'delete' && path.length === 2 && method === 'POST') {
        if (user.role !== 'parent') reject(403, 'forbidden');
        await throttle(store, 'delete-' + user.username, 60, 60000);
        return json(await deleteBooks(store, body.books));
      }
      if (section === 'books' && path.length === 2 && isId(id)) {
        if (method === 'GET') return json({ book: view(await getBook(store, id)) });
        if (method === 'PATCH') {
          await throttle(store, 'edit-' + user.username, 180, 60000);
          const book = await editBook(store, id, body);
          return json({ book: (await scheduleSaved(store, { books: [book] })).books[0] });
        }
        if (method === 'DELETE') {
          await deleteBook(store, id, body.version);
          return json({ ok: true });
        }
      }
      if (section === 'books' && path.length === 3 && key === 'cover-lookup' && method === 'POST' && isId(id)) {
        await throttle(store, 'cover-lookup-' + user.username, 20, 60000);
        return json({ book: await requestCovers(store, id, { retry: true }) }, 202);
      }
      if (section === 'shelf-photos' && path.length === 1 && method === 'GET') {
        if (user.role !== 'parent') reject(403, 'forbidden');
        return json({ photos: await listShelfPhotos(store) });
      }
      if (section === 'shelf-photos' && path.length === 2 && method === 'GET') {
        return new Response(new Uint8Array(await shelfPhotoBytes(store, id)), {
          headers: { ...baseHeaders, 'Content-Type': 'image/jpeg' },
        });
      }
      if (section === 'shelf-photos' && path.length === 2 && method === 'DELETE') {
        if (user.role !== 'parent') reject(403, 'forbidden');
        await deleteShelfPhoto(store, id);
        return json({ ok: true });
      }
      if (section === 'scan' && method === 'POST' && path.length === 1) {
        await throttle(store, 'scan-' + user.username, 30, 60000);
        return json(await scan(store, env, body, model, readText));
      }
      if (section === 'book-review' && method === 'POST' && path.length === 1) {
        await throttle(store, 'book-review-' + user.username, 30, 60000);
        await throttle(store, 'book-review-day', 600, 86400000);
        return json(await reviewBook(store, env, body, {provider:reviewProvider}));
      }
      if (section === 'admin' && path.length === 2) {
        if (id === 'settings' && method === 'GET')
          return json({
            users: await listAccounts(store, env),
            usage: await getUsage(store, env),
            wishlist: await wishlistSharing(store),
            ...(setup ? { services: setup.services() } : {}),
          });
        if (id === 'settings' && method === 'PATCH')
          return json({ usage: await configure(store, env, body) });
        if (id === 'services' && method === 'PATCH' && setup) {
          await throttle(store, 'service-check', 30, 60000);
          return json(await setup.saveService(body));
        }
        if (id === 'wishlist' && method === 'PATCH')
          return json({ wishlist: await setWishlistSharing(store, body) });
        if (id === 'accounts' && method === 'PATCH') {
          await accountEdit(store, env, user, body);
          return json({ ok: true });
        }
        if (id === 'restore' && method === 'POST') {
          await throttle(store, 'restore', 150, 60000);
          // A backup sends its shelf photos first, so that its books find them here.
          if (body.photos !== undefined) return json(await restoreShelfPhotos(store, body.photos));
          return json(await scheduleSaved(store, await addBooks(store, body.books, true)));
        }
      }
      reject(404, 'missing');
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.code, ...e.extra }, e.status);
      // Do not log request bodies, credentials, storage SDK response headers or photos.
      console.error(
        'Library request failed',
        e.name,
        typeof e.statusCode === 'number' ? e.statusCode : '',
      );
      return json({ error: 'storage' }, 503);
    }
  };
}
