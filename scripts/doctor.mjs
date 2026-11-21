// Checks that this computer can run the local library, and says which optional services are set up.
// It prints names and states only, never the value of a key or a password.
//   npm run doctor         the full report
//   (before `npm start`)   the essentials only, silent when all is well
import { accessSync, constants, existsSync } from 'node:fs';
import { createRequire, isBuiltin } from 'node:module';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validModelEndpoint, validTextEndpoint } from '../api/src/endpoints.js';
import { dataFolder, loadLocalEnv, nodeProblem, root } from './local-env.js';
import { filled, loadSavedSettings } from './local-settings.js';
import { networkSettings, reachable } from './local-network.js';

const item = (state, name, detail = '') => ({ state, name, detail });

function portState(port) {
  return new Promise((done) => {
    const probe = createServer();
    probe.once('error', (error) => done(error.code === 'EADDRINUSE' ? 'busy' : 'unavailable'));
    probe.once('listening', () => probe.close(() => done('free')));
    probe.listen(port, '127.0.0.1');
  });
}
/** What must be true before the library can start. Each item is ok or a problem. */
export async function essentials(env = process.env) {
  const checks = [];
  const node = nodeProblem();
  checks.push(node ? item('problem', 'Node.js', node) : item('ok', 'Node.js ' + process.versions.node));
  try {
    const sharp = createRequire(resolve(root, 'api/package.json'))('sharp');
    checks.push(item('ok', 'Image library (sharp ' + sharp.versions.sharp + ')'));
  } catch {
    checks.push(item('problem', 'Dependencies', 'Not installed for this computer. Run: npm run setup'));
  }
  checks.push(
    isBuiltin('node:sqlite')
      ? item('ok', 'SQLite')
      : item('problem', 'SQLite', 'This Node.js has no built-in SQLite. Use Node.js 22.'),
  );
  const data = dataFolder(env);
  try {
    // A folder that does not exist yet is created on the first start, if its parent can be written to.
    accessSync(existsSync(data) ? data : dirname(data), constants.W_OK);
    checks.push(item('ok', 'Data folder', data + (existsSync(data) ? '' : ' (created on first start)')));
  } catch {
    checks.push(item('problem', 'Data folder', data + ' cannot be written to.'));
  }
  return checks;
}

/** The full report: the essentials, then what is optional. Optional items are notes, never problems. */
export async function report(env = process.env, { added = [] } = {}) {
  const checks = await essentials(env);
  const port = Number(env.PORT || 46173);
  const state = await portState(port);
  checks.push(
    state === 'free'
      ? item('ok', 'Port ' + port + ' is free')
      : state === 'busy'
        ? item('note', 'Port ' + port + ' is in use', 'The library may already be running. Otherwise set PORT to another number.')
        : item('note', 'Port ' + port, 'Could not be checked.'),
  );
  try {
    const network = networkSettings(env);
    const parts = [
      reachable(network) ? 'Other devices can reach it (listens on ' + network.host + ')' : 'This computer only',
      network.origin && 'opened at ' + network.origin,
      network.proxies && 'behind ' + network.proxies + (network.proxies === 1 ? ' proxy' : ' proxies'),
    ].filter(Boolean);
    const unprotected = reachable(network) && !network.origin?.startsWith('https:');
    checks.push(
      item(
        reachable(network) ? 'note' : 'ok',
        'Network',
        parts.join(', ') + '.' + (unprotected ? ' Without HTTPS in front, passwords and keys cross the network unprotected.' : ''),
      ),
    );
  } catch (error) {
    checks.push(item('problem', 'Network', error.message));
  }
  const data = dataFolder(env);
  checks.push(
    existsSync(resolve(data, 'local-access.json'))
      ? item('ok', 'Sign-in details', resolve(data, 'local-access.json'))
      : item('note', 'Sign-in details', 'Generated on the first start, in ' + resolve(data, 'local-access.json')),
  );
  checks.push(
    added.length
      ? item('ok', 'Settings file .env', 'Supplies ' + added.sort().join(', '))
      : item('note', 'Settings file .env', existsSync(resolve(root, '.env')) ? 'Present; adds nothing the shell has not set.' : 'None. Copy .env.example to .env to add settings.'),
  );

  // Keys saved from the set-up screen or Family settings fill in what the shell and `.env` leave unset.
  try {
    const saved = loadSavedSettings(env, data);
    checks.push(
      saved.length
        ? item('ok', 'Settings saved in the app', 'Supply ' + saved.sort().join(', '))
        : item('note', 'Settings saved in the app', 'None. Service keys can be added in Family settings.'),
    );
  } catch (error) {
    checks.push(item('problem', 'Settings saved in the app', error.message));
  }

  // Optional services: set, incomplete, or not set. Never the values themselves.
  const service = (name, names, valid = () => true, without) => {
    const have = names.filter((key) => filled(env, key));
    if (!have.length) return item('note', name, 'Not set. ' + without);
    if (have.length < names.length) return item('problem', name, 'Incomplete: also set ' + names.filter((key) => !have.includes(key)).join(', ') + '.');
    return valid() ? item('ok', name, 'Set.') : item('problem', name, 'The endpoint is not an HTTPS address of that Azure service.');
  };
  checks.push(
    service('Photo recognition', ['AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_DEPLOYMENT', 'AZURE_OPENAI_API_KEY'],
      () => validModelEndpoint(env.AZURE_OPENAI_ENDPOINT),
      'Books can still be typed in and covers uploaded.'),
    service('Text detection', ['AZURE_VISION_ENDPOINT', 'AZURE_VISION_KEY'],
      () => validTextEndpoint(env.AZURE_VISION_ENDPOINT),
      'Scans still work; rows have no cut-outs.'),
    service('Google Books', ['GOOGLE_BOOKS_API_KEY'], undefined, 'Open Library is still used.'),
    service('Brave image search', ['BRAVE_SEARCH_API_KEY'], undefined, 'Covers come from the book catalogues only.'),
  );
  return checks;
}

export function print(checks, write = console.log) {
  const mark = { ok: ' ok ', note: '  - ', problem: ' !! ' };
  for (const check of checks) write(mark[check.state] + check.name + (check.detail ? ': ' + check.detail : ''));
  return checks.filter((check) => check.state === 'problem').length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const added = loadLocalEnv();
  if (process.argv.includes('--start')) {
    const problems = (await essentials()).filter((check) => check.state === 'problem');
    if (problems.length) {
      print(problems, console.error);
      console.error('Run `npm run doctor` for the full report.');
      process.exit(1);
    }
  } else {
    const problems = print(await report(process.env, { added }));
    console.log(problems ? '\n' + problems + ' problem' + (problems === 1 ? '' : 's') + ' to fix before the library will work as set up.' : '\nThis computer is ready: npm start');
    process.exit(problems ? 1 : 0);
  }
}
