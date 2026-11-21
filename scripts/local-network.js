// How a library on your own computer meets a network. Left alone it listens on this computer
// only. The settings here let other devices reach it, directly or through a proxy that adds
// HTTPS, which is what a home server or a container needs.
import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { clientAddress } from '../api/src/client-address.js';

const thisComputer = '127.0.0.1';
const everyAddress = new Set(['0.0.0.0', '::']);
const set = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * The network settings, checked. A mistake here would either open the library to the network or
 * lock every browser out, so a wrong value stops the start with an explanation.
 *   host     the address to listen on
 *   origin   the address people open the library at, when it differs from what the server sees
 *   proxies  how many proxies of your own stand in front
 */
export function networkSettings(env = process.env) {
  const host = set(env.LIBRARY_HOST) || thisComputer;
  if (!isIP(host))
    throw new Error(
      'LIBRARY_HOST must be an IP address to listen on: 127.0.0.1 for this computer only, or 0.0.0.0 for every network it is on.',
    );
  let origin = null;
  if (set(env.PUBLIC_APP_ORIGIN)) {
    let url = null;
    try {
      url = new URL(set(env.PUBLIC_APP_ORIGIN));
    } catch {
      /* Explained below. */
    }
    if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
      throw new Error(
        'PUBLIC_APP_ORIGIN must be the address the library is opened at, such as https://books.example.org, with nothing after the host.',
      );
    origin = url.origin;
  }
  const proxies = set(env.LIBRARY_TRUSTED_PROXIES) ? Number(set(env.LIBRARY_TRUSTED_PROXIES)) : 0;
  if (!Number.isInteger(proxies) || proxies < 0 || proxies > 5)
    throw new Error('LIBRARY_TRUSTED_PROXIES must be the number of proxies in front of the library, from 0 to 5.');
  return { host, origin, proxies };
}

/** Whether anything but this computer can connect. */
export const reachable = ({ host }) => host !== thisComputer && host !== '::1';

/** The address to print and to build the set-up link from. */
export function shownAddress({ host, origin }, port) {
  if (origin) return origin;
  // "Every address" includes this computer's own, which is the one that works without knowing more.
  const name = everyAddress.has(host) ? thisComputer : isIP(host) === 6 ? '[' + host + ']' : host;
  return 'http://' + name + ':' + port;
}

const listensAt = (host, port) => (isIP(host) === 6 ? '[' + host + ']' : host) + ':' + port;

/** What to say at the start, after the address, about a library that is not just on this computer. */
export function networkNotes(network, port) {
  const notes = [];
  if (network.origin)
    notes.push('It listens on ' + listensAt(network.host, port) + '; the address above is where browsers open it.');
  if (!reachable(network)) return notes;
  notes.push(
    'Other devices can reach this library (LIBRARY_HOST=' + network.host + ')' +
      (network.origin ? '.' : ', at the address of this computer in place of ' + thisComputer + '.'),
  );
  if (!network.origin?.startsWith('https:'))
    notes.push('Without HTTPS in front, passwords and keys cross the network unprotected. See docs/LOCAL.md.');
  return notes;
}

/**
 * The browser policy the deployed site sends with every page, read from the same file, so that a
 * library reached over a network is held to the same rules.
 */
export function pageHeaders(file = new URL('../web/staticwebapp.config.json', import.meta.url)) {
  return JSON.parse(readFileSync(file, 'utf8')).globalHeaders;
}

/**
 * Who is calling. Without proxies it is the connection itself. With proxies it is what they
 * report, and a request that lacks their report shares one allowance with all such requests.
 */
export const callerAddress = (headers, connection, proxies) =>
  proxies > 0 ? clientAddress(headers, proxies) : connection;

/**
 * Stops cleanly when the program is asked to, as `docker stop` and Ctrl+C do: requests in
 * flight finish, then `close` runs. Connections still open after `grace` milliseconds are cut.
 */
export function stopOnSignal(server, close, { target = process, grace = 5000 } = {}) {
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    const timer = setTimeout(() => server.closeAllConnections(), grace);
    server.close(() => {
      clearTimeout(timer);
      close();
      target.exit(0);
    });
    server.closeIdleConnections();
  };
  for (const signal of ['SIGINT', 'SIGTERM']) target.on(signal, stop);
  return stop;
}
