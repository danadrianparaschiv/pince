import { scrypt, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { change, reject } from './store.js';
const derive = promisify(scrypt);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const week = 7 * 86400_000;
export const publicUser = (u) => ({ username: u.username, role: u.role, language: u.language });
export const checkLanguage = (v) => (['ro', 'en'].includes(v) ? v : reject(400, 'invalid'));
export async function passwordHash(password) {
  if (typeof password !== 'string' || password.length < 10 || password.length > 128)
    reject(400, 'passwordLength');
  const salt = randomBytes(16).toString('hex');
  const digest = await derive(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return salt + '.' + digest.toString('hex');
}
async function verify(password, stored) {
  const [salt, hex] = stored.split('.');
  const actual = await derive(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return timingSafeEqual(actual, Buffer.from(hex, 'hex'));
}
export const normalizeUser = (v) =>
  typeof v === 'string' && /^[a-zA-Z0-9_.-]{1,48}$/.test(v) ? v.toLowerCase() : '';
export function accountNames(env) {
  const names = {
    parent: normalizeUser(env.PARENT_USERNAME ?? 'parinte'),
    child: normalizeUser(env.CHILD_USERNAME ?? 'copil'),
  };
  if (!names.parent || !names.child || names.parent === names.child) reject(503, 'configuration');
  return names;
}
// A new generation permanently retires sessions even if an earlier mapping is restored.
async function accountBinding(store, env) {
  const names = accountNames(env);
  const matches = b => b?.parent === names.parent && b.child === names.child;
  const current = (await store.get('system', 'account-binding'))?.value;
  if (matches(current)) return current;
  const generation = randomBytes(16).toString('hex');
  return change(store, 'system', 'account-binding', b => matches(b) ? b : { ...names, generation });
}
async function initialUser(store, env, username) {
  const names = accountNames(env);
  const role = Object.keys(names).find((key) => names[key] === username);
  if (!role) return null;
  let row = await store.get('users', username);
  if (!row) {
    const credential = env[role === 'parent' ? 'BOOTSTRAP_PARENT_PASSWORD' : 'BOOTSTRAP_CHILD_PASSWORD'];
    if (!credential || credential.length < 10) reject(503, 'configuration');
    const password = await passwordHash(credential);
    await store.cas('users', username, undefined, {
      username,
      role,
      password,
      enabled: true,
      language: null,
      sessions: [],
    });
    row = await store.get('users', username);
  }
  // Reuse across roles requires an explicit password reset by the current parent.
  return row.value.role === role ? row.value : { username, role, enabled: false, language: null };
}
// Operator-only initialization path. The HTTP service never accepts bootstrap
// credentials for an existing username that is changing roles.
export async function reassignConfiguredRoles(store, env) {
  const updates = [];
  for (const [role, username] of Object.entries(accountNames(env))) {
    const row = await store.get('users', username);
    if (!row || row.value.role === role) continue;
    const secret = env['BOOTSTRAP_' + role.toUpperCase() + '_PASSWORD'];
    const password = await passwordHash(secret);
    if (await verify(secret, row.value.password)) reject(400, 'newPasswordRequired');
    updates.push({ username, etag: row.etag, value: { ...row.value, role, password, enabled: true, sessions: [], devices: [] } });
  }
  await accountBinding(store, env);
  for (const update of updates) {
    if (!await store.cas('users', update.username, update.etag, update.value)) reject(409, 'busy');
  }
}
export async function throttle(store, key, limit, period) {
  const now = Date.now();
  await change(store, 'limits', key, (previous) => {
    if (!previous || previous.start + period <= now) return { start: now, count: 1 };
    if (previous.count >= limit) reject(429, 'throttle');
    return { ...previous, count: previous.count + 1 };
  });
}
const sessionCookie = /\blibrary_session=([a-z0-9_.-]{1,48})~([\w-]{43})(?:;|$)/;
// A browser that signed in to this account before still holds its last session cookie, live or
// expired. It proves nothing about who is typing, so the password is checked as always, but it
// gives that browser sign-in limits of its own. Wrong passwords sent from elsewhere, which share
// one allowance per account, then cannot keep the family's own devices from signing in.
async function knownDevice(store, username, cookies) {
  const raw = sessionCookie.exec(cookies || '');
  if (!raw || raw[1] !== username) return null;
  const digest = hash(raw[2]);
  const devices = (await store.get('users', username))?.value.devices;
  return Array.isArray(devices) && devices.includes(digest) ? digest : null;
}
export async function login(store, env, body, ip, cookies = '') {
  const username = normalizeUser(body.username);
  const device = username ? await knownDevice(store, username, cookies) : null;
  const ipBucket = hash(ip).slice(0, 3);
  if (!device) await throttle(store, 'login-' + ipBucket, 12, 600_000);
  if (!username || typeof body.password !== 'string' || body.password.length > 128)
    reject(401, 'credentials');
  const binding = await accountBinding(store, env);
  const accountLimit = 'account-' + username + (device ? '-' + device.slice(0, 32) : '');
  let reservation;
  if (username === binding.parent || username === binding.child) {
    // Reserve before scrypt so concurrent requests from different networks share the limit.
    const ticket = randomBytes(12).toString('hex');
    reservation = await change(store, 'limits', accountLimit, previous => {
      const now = Date.now();
      if (previous?.next > now) reject(429, 'throttle');
      const count = previous?.last + 600_000 > now ? Math.min(previous.count + 1, 10) : 1;
      const cooldown = count < 5 ? 0 : Math.min(30_000, 1000 * 2 ** (count - 5));
      return { count, last: now, next: now + cooldown, ticket };
    });
  }
  const user = await initialUser(store, env, username);
  const ok = await verify(body.password, user?.password ?? '00.'.concat('0'.repeat(128)));
  if (!ok || !user?.enabled) reject(401, 'credentials');
  await change(store, 'limits', accountLimit, current =>
    current?.ticket === reservation?.ticket ? { count: 0, next: 0, last: 0 } : current);
  const token = randomBytes(32).toString('base64url');
  const item = { digest: hash(token), expires: Date.now() + week, generation: binding.generation };
  const saved = await change(store, 'users', username, (current) => {
    if (!current?.enabled || current.role !== user.role || current.password !== user.password) reject(401, 'credentials');
    return {
      ...current,
      sessions: [...current.sessions.filter((s) => s.expires > Date.now()).slice(-11), item],
      // The new cookie replaces the one this browser presented.
      devices: [...(current.devices || []).filter((d) => d !== device).slice(-11), item.digest],
    };
  });
  return { user: publicUser(saved), token: username + '~' + token };
}
export async function identity(store, req, env) {
  const raw = sessionCookie.exec(req.headers.get('cookie') || '');
  if (!raw) return null;
  const binding = await accountBinding(store, env);
  const user = (await store.get('users', raw[1]))?.value;
  const digest = hash(raw[2]);
  if (!user?.enabled || binding[user.role] !== raw[1] ||
      !user.sessions.some((s) => s.generation === binding.generation && s.digest === digest && s.expires > Date.now()))
    return null;
  return { user, digest };
}
export async function listAccounts(store, env) {
  const result = [];
  for (const username of Object.values(accountNames(env))) {
    const user = await initialUser(store, env, username);
    result.push({ ...publicUser(user), enabled: user.enabled });
  }
  return result;
}
export async function accountEdit(store, env, who, body) {
  const username = normalizeUser(body.username);
  if (!username || !Object.values(accountNames(env)).includes(username)) reject(404, 'missing');
  const account = await initialUser(store, env, username);
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') reject(400, 'invalid');
  if (body.enabled === false && who.username === username) reject(400, 'ownAccount');
  // A new password, for either account, needs the parent's own current one. A moment at an
  // unlocked session, or a stolen cookie, is then not enough to take the library over.
  if (body.password !== undefined) {
    if (typeof body.currentPassword !== 'string' || body.currentPassword.length > 128) reject(403, 'currentPassword');
    await throttle(store, 'own-password-' + who.username, 5, 600_000);
    if (!await verify(body.currentPassword, who.password)) reject(403, 'currentPassword');
  }
  const password = body.password === undefined ? null : await passwordHash(body.password);
  if (!password && body.enabled === undefined) reject(400, 'invalid');
  if (password && !account.password) {
    const previous = await store.get('users', username);
    if (previous && previous.value.role !== account.role && await verify(body.password, previous.value.password))
      reject(400, 'invalid');
  }
  await change(store, 'users', username, (u) => {
    if (u.role !== account.role && !password) reject(400, 'invalid');
    return {
      ...u,
      role: account.role,
      password: password || u.password,
      enabled: body.enabled ?? (u.role !== account.role || u.enabled),
      sessions: [],
      devices: [],
    };
  });
}
