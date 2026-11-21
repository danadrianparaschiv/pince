import http from 'node:http';
import { Readable } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, resolve, sep } from 'node:path';
import { LocalStore } from './local-store.js';
import { makeApp } from '../api/src/app.js';
import { reassignConfiguredRoles } from '../api/src/auth.js';
import { startLocalCovers } from './local-covers.js';
import { dataFolder, loadLocalEnv } from './local-env.js';
import { filled, loadSavedSettings, readSettings, services, writeSettings } from './local-settings.js';
import { makeLocalSetup } from './local-setup.js';
import { callerAddress, networkNotes, networkSettings, pageHeaders, shownAddress, stopOnSignal } from './local-network.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const web = resolve(root, 'web');
// Settings in `.env` are picked up by themselves; anything set in the shell takes precedence.
loadLocalEnv();
const data = dataFolder();
await mkdir(data, { recursive: true, mode: 0o700 });
const env = { ...process.env };
// What the shell or `.env` supplies stays theirs. Everything else can be saved from the app,
// and those saved settings are added now.
const outside = new Set(
  [...Object.values(services).flat(), 'PARENT_USERNAME', 'CHILD_USERNAME'].filter((name) => filled(env, name)),
);
let network;
try {
  loadSavedSettings(env, data);
  network = networkSettings(env);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
// Browser writes are held to this address, exactly as written by the browser.
if (network.origin) env.PUBLIC_APP_ORIGIN = network.origin;
const credentials = resolve(data, 'local-access.json');
let accounts;
try {
  accounts = JSON.parse(await readFile(credentials, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  accounts = Object.fromEntries(
    ['parent', 'child'].map((role) => [
      role,
      {
        username: env[role.toUpperCase() + '_USERNAME'] || (role === 'parent' ? 'parinte' : 'copil'),
        password:
          env['BOOTSTRAP_' + role.toUpperCase() + '_PASSWORD'] || randomBytes(15).toString('base64url'),
      },
    ]),
  );
  await writeFile(credentials, JSON.stringify(accounts, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  // A new library starts with set-up waiting to be done in the browser.
  if (!readSettings(data)) writeSettings(data, { setup: 'pending', values: {} });
}
for (const role of ['parent', 'child']) {
  env[role.toUpperCase() + '_USERNAME'] ??= accounts[role].username;
  // Passwords chosen in the set-up screen are not in the file; those accounts already exist.
  if (accounts[role].password) env['BOOTSTRAP_' + role.toUpperCase() + '_PASSWORD'] ??= accounts[role].password;
}
const store = new LocalStore(data);
if (env.LIBRARY_REASSIGN_ROLES === '1') await reassignConfiguredRoles(store, env);
startLocalCovers(store, env);
// Set-up waits until it is finished in the browser. `npm start -- --setup` opens it again, as
// does LIBRARY_SETUP=1 where the command cannot be changed.
const setup = makeLocalSetup({
  store, env, folder: data, outside,
  open: readSettings(data)?.setup === 'pending' || process.argv.includes('--setup') || env.LIBRARY_SETUP === '1',
});
const app = makeApp({ store, local: true, env, setup });
const mime = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
};
const headers = pageHeaders();
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://' + req.headers.host);
    if (url.pathname.startsWith('/api/')) {
      const sent = new Headers(req.headers);
      const response = await app({
        url: url.href, method: req.method, headers: sent,
        body: req.iterator({ destroyOnReturn: false }),
      }, callerAddress(sent, req.socket.remoteAddress, network.proxies));
      if (!req.complete) res.setHeader('Connection', 'close');
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) Readable.fromWeb(response.body).pipe(res);
      else res.end();
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405);
      res.end();
      return;
    }
    const target = decodeURIComponent(url.pathname);
    const file = resolve(web, '.' + (extname(target) ? target : '/index.html'));
    if (!file.startsWith(web + sep) || !(await stat(file)).isFile()) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, {
      ...headers,
      'Content-Type': mime[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(req.method === 'HEAD' ? undefined : await readFile(file));
  } catch (error) {
    res.writeHead(error.code === 'ENOENT' ? 404 : 500);
    res.end();
  }
});
const port = Number(env.PORT || 46173);
server.listen(port, network.host, () => {
  const address = shownAddress(network, server.address().port);
  console.log('Library: ' + address);
  for (const note of networkNotes(network, server.address().port)) console.log(note);
  console.log('Local family sign-in details: ' + credentials);
  if (setup.token) {
    console.log('Set-up: choose your passwords and add service keys in the browser, with this one-time link:');
    console.log('  ' + address + '/setup#' + setup.token);
  }
});
stopOnSignal(server, () => store.db.close());
