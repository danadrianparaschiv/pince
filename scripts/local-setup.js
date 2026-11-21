// Setting up a library on this computer from the browser: choosing the two accounts, and adding
// the keys of the optional services. It exists only for a local library; the deployed app never
// loads this file.
//
// Who may use it:
//   - during set-up, whoever holds the one-time link that `npm start` printed in the terminal.
//     The link's token lives in memory, and stops working when set-up is finished or the program
//     stops;
//   - afterwards, the signed-in parent, for the service keys only (Family settings).
//
// A key is written once and never read back: the browser learns whether a service is set, not
// the key. Before a key is saved it is tried with one small request, and a key that fails is not
// saved. Settings that the shell or `.env` supply cannot be changed from here, because they would
// win over the saved ones anyway.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { accountNames, normalizeUser, passwordHash } from '../api/src/auth.js';
import { change, reject } from '../api/src/store.js';
import { checks, wellFormed } from './service-checks.js';
import { filled, readSettings, services, writeSettings } from './local-settings.js';

const roles = ['parent', 'child'];
const digest = (value) => createHash('sha256').update(String(value ?? '')).digest();
let blank;
// The text detector is tried with a plain white picture, made once.
const blankPicture = () =>
  (blank ??= createRequire(new URL('../api/package.json', import.meta.url))('sharp')({
    create: { width: 64, height: 64, channels: 3, background: '#ffffff' },
  })
    .jpeg()
    .toBuffer());

export const accessFile = (folder) => resolve(folder, 'local-access.json');

/**
 * `outside` holds the names of settings that came from the shell or `.env`.
 * `open` starts with set-up waiting to be done, which creates the one-time token.
 */
export function makeLocalSetup({ store, env, folder, outside = new Set(), open = false, fetcher = fetch }) {
  let token = open ? randomBytes(32).toString('base64url') : null;
  const saved = () => readSettings(folder) ?? { setup: 'done', values: {} };
  const status = () =>
    Object.entries(services).map(([id, names]) => {
      const have = names.filter((name) => filled(env, name));
      return {
        id,
        state: have.length === names.length ? 'set' : have.length ? 'partial' : 'unset',
        fixed: names.some((name) => outside.has(name)),
        // Addresses and model names may be shown again; keys never are.
        details: Object.fromEntries(have.filter((name) => !name.endsWith('_KEY')).map((name) => [name, env[name]])),
      };
    });
  // Passwords chosen in the set-up screen are not kept in the sign-in details file.
  function chosen() {
    try {
      return typeof JSON.parse(readFileSync(accessFile(folder), 'utf8')).parent?.password !== 'string';
    } catch {
      return true;
    }
  }
  return {
    /** The token of the one-time link, or null once set-up is finished. */
    get token() {
      return token;
    },
    pending: () => token !== null,
    services: status,
    /** Set-up requests carry the link's token. Once set-up is finished there is nothing here. */
    authorize(given) {
      if (token === null) reject(404, 'missing');
      if (!timingSafeEqual(digest(given), digest(token))) reject(401, 'unauthenticated');
    },
    state() {
      const names = accountNames(env);
      return {
        accounts: {
          ...Object.fromEntries(
            roles.map((role) => [role, { username: names[role], fixed: outside.has(role.toUpperCase() + '_USERNAME') }]),
          ),
          chosen: chosen(),
          file: accessFile(folder),
        },
        services: status(),
      };
    },
    /** Gives both accounts the chosen names and passwords, and ends every earlier session. */
    async accounts(body) {
      const current = accountNames(env),
        picked = {};
      for (const role of roles) {
        const username = normalizeUser(body[role]?.username);
        if (!username) reject(400, 'username');
        if (username !== current[role] && outside.has(role.toUpperCase() + '_USERNAME')) reject(400, 'usernameFixed');
        picked[role] = { username };
      }
      if (picked.parent.username === picked.child.username) reject(400, 'sameUsername');
      for (const role of roles) picked[role].password = await passwordHash(body[role]?.password);
      for (const role of roles) {
        const { username, password } = picked[role];
        await change(store, 'users', username, (user) => ({
          username,
          role,
          password,
          enabled: true,
          language: user?.language ?? null,
          sessions: [],
          devices: [],
        }));
      }
      const file = accessFile(folder);
      writeFileSync(
        file + '.new',
        JSON.stringify(
          {
            note: 'The passwords were chosen in the set-up screen and are not kept in this file. The parent can set a new password for the child in Family settings. To choose both again, start with: npm start -- --setup',
            parent: { username: picked.parent.username },
            child: { username: picked.child.username },
          },
          null,
          2,
        ) + '\n',
        { mode: 0o600 },
      );
      renameSync(file + '.new', file);
      env.PARENT_USERNAME = picked.parent.username;
      env.CHILD_USERNAME = picked.child.username;
      // The generated first passwords are no longer a way in.
      delete env.BOOTSTRAP_PARENT_PASSWORD;
      delete env.BOOTSTRAP_CHILD_PASSWORD;
      return { ok: true };
    },
    /** Tries a service's settings and saves them if they work, or removes the saved ones. */
    async saveService(body) {
      const names = Object.hasOwn(services, body.service) ? services[body.service] : reject(400, 'invalid');
      if (names.some((name) => outside.has(name))) reject(409, 'serviceFixed');
      const next = saved(),
        values = {};
      if (body.remove === true) {
        for (const name of names) delete next.values[name];
      } else {
        for (const name of names) {
          const value = typeof body.values?.[name] === 'string' ? body.values[name].trim() : '';
          if (!wellFormed(name, value)) reject(400, 'serviceValue', { name });
          values[name] = value;
        }
        const picture = body.service === 'textDetection' ? await blankPicture() : undefined;
        const result = await checks[body.service](values, fetcher, picture);
        if (!result.ok) reject(400, 'serviceCheck', { status: result.status });
        Object.assign(next.values, values);
      }
      writeSettings(folder, next);
      // The running library reads its settings on every request, so this takes effect at once.
      for (const name of names) {
        if (body.remove === true) delete env[name];
        else env[name] = values[name];
      }
      return { services: status() };
    },
    finish() {
      writeSettings(folder, { ...saved(), setup: 'done' });
      token = null;
      return { username: accountNames(env).parent };
    },
  };
}
