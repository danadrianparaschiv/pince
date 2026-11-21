import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clientName } from '../api/src/cover-source.js';
import { TEXT } from '../web/import.js';

// Checks on the repository itself: nothing private in it, and documentation that matches the code.
const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFile(join(root, path), 'utf8');
const sourceFolders = ['api/src', 'web', 'worker', 'scripts', 'infra', 'test', '.github/workflows'];
const pages = [
  'README.md',
  'DEPLOY.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'docs/USER-GUIDE.md',
  'docs/ARCHITECTURE.md',
  'docs/CONFIGURATION.md',
  'docs/CI-CD.md',
  'docs/SUPPORT.md',
  'docs/LOCAL.md',
  'docs/DOCKER.md',
  'docs/REQUIREMENTS.md',
  'test/README.md',
];

async function sourceFiles() {
  const files = [];
  for (const folder of sourceFolders) {
    for (const name of await readdir(join(root, folder))) {
      if (/\.(js|mjs|sh|bicep|json|html|css|md|yml)$/.test(name)) files.push(folder + '/' + name);
    }
  }
  return files;
}

test('no deployment address, key or home folder is written into the source or the documentation', async () => {
  // Written in pieces so that this file does not match itself.
  const patterns = [
    new RegExp('[a-z0-9-]+\\.(\\d+\\.)?azurestatic' + 'apps\\.net'),
    /AccountKey=[A-Za-z0-9+/]{20}/,
    new RegExp('/Us' + 'ers/[a-z]'),
    /\bsk-[A-Za-z0-9]{20}/,
    /BSA[A-Za-z0-9_-]{24,}/,
    /AIza[A-Za-z0-9_-]{30,}/,
    /[\w.+-]+@(gmail|yahoo|outlook|hotmail)\.com/,
    // A cloud project id, or a sentence about one particular installation.
    new RegExp('gen-lang-' + 'client-\\d+'),
    new RegExp('the current ' + 'deployment uses', 'i'),
  ];
  const container = ['Dockerfile', '.dockerignore', 'docker/compose.yaml', 'docker/Caddyfile'];
  for (const file of [...(await sourceFiles()), ...pages, ...container, '.env.example', 'package.json']) {
    const text = await read(file);
    for (const pattern of patterns) assert.doesNotMatch(text, pattern, file);
  }
  // The example settings file names settings and never gives one a value.
  for (const line of (await read('.env.example')).split('\n')) assert.match(line, /^(#.*)?$/, line);
});

test('the library names itself to catalogues from its own settings, never from a built-in address', () => {
  assert.equal(clientName({}), 'Pince/1.2');
  assert.equal(
    clientName({ PUBLIC_APP_ORIGIN: 'https://library.example/some/path' }),
    'Pince/1.2 (+https://library.example)',
  );
  assert.equal(
    clientName({ LIBRARY_API_ORIGIN: 'https://library.example' }),
    'Pince/1.2 (+https://library.example)',
  );
  for (const bad of ['http://library.example', 'https://user:pw@library.example', 'not an address'])
    assert.equal(clientName({ PUBLIC_APP_ORIGIN: bad }), 'Pince/1.2');
});

test('files kept out of the repository stay ignored', async () => {
  const ignored = (await read('.gitignore')).split('\n').map((line) => line.trim());
  for (const entry of [
    'node_modules/',
    '.library/',
    '.env',
    '.env.*',
    '!.env.example',
    'test/sample-images/',
    'test/sample-photos/',
  ])
    assert(ignored.includes(entry), entry);
});

test('every link in the documentation leads somewhere', async () => {
  const headings = async (path) =>
    new Set(
      [...(await read(path)).matchAll(/^#+\s+(.*)$/gm)].map((match) =>
        match[1]
          .trim()
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\- ]/gu, '')
          .replace(/ /g, '-'),
      ),
    );
  for (const page of pages) {
    for (const [, target] of (await read(page)).matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^(https?:|mailto:)/.test(target)) continue;
      const [path, anchor] = target.split('#');
      const file = path ? normalize(join(dirname(page), decodeURIComponent(path))) : page;
      assert(existsSync(join(root, file)), page + ' links to missing ' + target);
      if (anchor && file.endsWith('.md'))
        assert((await headings(file)).has(anchor), page + ' links to missing heading ' + target);
    }
    // A file named in backticks exists too.
    for (const [, path] of (await read(page)).matchAll(
      /`((?:scripts|api\/src|web|worker|infra|test|docs)\/[\w./-]+\.\w+)`/g,
    ))
      assert(existsSync(join(root, path)), page + ' names missing ' + path);
  }
});

test('every setting the code reads is documented, and the example file lists only real settings', async () => {
  const settings = new Set();
  for (const file of (await sourceFiles()).filter((file) =>
    /^(api\/src|worker|scripts)\/.*\.(js|mjs)$/.test(file),
  )) {
    for (const [, name] of (await read(file)).matchAll(/\benv\.([A-Z][A-Z0-9_]+)/g)) settings.add(name);
  }
  // The child's first password is read under a name built from the role.
  settings.add('BOOTSTRAP_CHILD_PASSWORD');
  assert(settings.size >= 15);
  const documented = (await read('docs/CONFIGURATION.md')) + (await read('DEPLOY.md'));
  for (const name of settings) {
    // Wildcards in the documentation cover a family of settings, as in `AZURE_OPENAI_*`.
    const family = name.replace(/_[A-Z0-9]+$/, '_*');
    assert(
      documented.includes('`' + name + '`') || documented.includes('`' + family + '`'),
      name + ' is not documented',
    );
  }
  for (const [, name] of (await read('.env.example')).matchAll(/^# ([A-Z][A-Z0-9_]+)=/gm))
    assert(settings.has(name), name + ' is in .env.example but no code reads it');
});

test('the add-books screen has the same labels in Romanian and English', () => {
  assert.deepEqual(Object.keys(TEXT.ro).sort(), Object.keys(TEXT.en).sort());
  for (const lang of ['ro', 'en']) {
    for (const [key, value] of Object.entries(TEXT[lang]))
      assert(typeof value === 'string' && value.trim(), lang + '.' + key);
  }
});

test('workflows pin their actions, keep Azure away from pull requests, and start read-only', async () => {
  const names = (await readdir(join(root, '.github/workflows'))).filter((name) => name.endsWith('.yml'));
  assert.deepEqual(names.sort(), ['deploy-azure.yml', 'release.yml', 'tests.yml']);
  for (const name of names) {
    const text = await read('.github/workflows/' + name);
    // An action from elsewhere is named by its exact commit; a tag could be moved to other code.
    for (const [, action] of text.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)) {
      if (action.startsWith('./')) continue;
      assert.match(action, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, name + ' uses ' + action);
    }
    // This trigger runs a pull request's code with the repository's own rights.
    assert.doesNotMatch(text, /pull_request_target/, name);
    assert.match(text, /^permissions:\n  contents: read$/m, name + ' must start read-only');
    // Nothing a contributor writes in a title or branch name is pasted into a shell command.
    for (const [, command] of text.matchAll(/^\s+run:\s*(.*(?:\n\s{10,}.*)*)/gm))
      assert.doesNotMatch(command, /\$\{\{\s*github\.(event|head_ref|ref_name)/, name);
  }
  const deploy = await read('.github/workflows/deploy-azure.yml');
  assert.doesNotMatch(deploy, /^\s+(pull_request|push):/m);
  assert.match(deploy, /environment: azure/);
  // Only the deploy path may ask Azure for a token, and only the release job may write.
  assert.doesNotMatch(await read('.github/workflows/tests.yml'), /id-token|contents: write|secrets\./);
});

test('the container image has a pinned base, runs unprivileged and takes in only what is listed', async () => {
  const dockerfile = await read('Dockerfile');
  // The base is named by its exact contents, on the version of Node the project is tested on.
  const bases = [...dockerfile.matchAll(/^FROM (\S+)/gm)].map(([, base]) => base);
  const node = (await read('.nvmrc')).trim();
  assert(bases.length > 0);
  for (const base of bases)
    assert.match(base, new RegExp('^node:' + node + '-bookworm-slim@sha256:[0-9a-f]{64}$'), base);
  assert.equal(new Set(bases).size, 1, 'every stage starts from the same base');
  assert.match(dockerfile, /^USER node$/m);
  // Started directly, so that a stop signal reaches the library and not a wrapper.
  assert.match(dockerfile, /^CMD \["node", "scripts\/dev\.js"\]$/m);
  assert.match(dockerfile, /^HEALTHCHECK /m);
  // No key or password is ever given to a build.
  assert.doesNotMatch(dockerfile, /^(ARG|ENV)\b.*(KEY|PASSWORD|TOKEN|SECRET)/im);

  // The build sees nothing but what this file lets in, so no data folder, settings file or
  // history can reach an image, whatever else is in the folder.
  const rules = (await read('.dockerignore'))
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  assert.equal(rules[0], '*');
  assert.deepEqual(rules.slice(1).sort(), [
    '!LICENSE',
    '!api/package-lock.json',
    '!api/package.json',
    '!api/src',
    '!package.json',
    '!scripts',
    '!web',
  ]);
  // Whatever the image copies from the folder is something that file lets in.
  for (const [, sources] of dockerfile.matchAll(/^COPY (?!--from)(.+) \S+$/gm))
    for (const source of sources.split(' '))
      assert(rules.includes('!' + source), 'the image copies ' + source + ', which is left out of the build');

  // In the Compose example only the proxy is reachable; the library publishes no port.
  const compose = await read('docker/compose.yaml');
  const library = compose.slice(compose.indexOf('\n  pince:'), compose.indexOf('\n  caddy:'));
  assert(library.includes('PUBLIC_APP_ORIGIN: https://') && library.includes('LIBRARY_TRUSTED_PROXIES: "1"'));
  assert.doesNotMatch(library, /^\s+ports:/m);
});

test('the only pictures in the repository are the two the app itself shows', async () => {
  // Photos and office documents can carry a place, a name or someone else's artwork.
  const kept = new Set(['node_modules', '.git', '.library', '.claude', 'sample-images', 'sample-photos']);
  const found = [];
  const walk = async (folder) => {
    for (const entry of await readdir(join(root, folder), { withFileTypes: true })) {
      const path = folder ? folder + '/' + entry.name : entry.name;
      if (entry.isDirectory()) {
        if (!kept.has(entry.name)) await walk(path);
      } else if (/\.(jpe?g|png|gif|webp|heic|heif|svg|ico|pdf|docx?|xlsx?|pptx?)$/i.test(entry.name))
        found.push(path);
    }
  };
  await walk('');
  assert.deepEqual(found.sort(), ['web/google-books-poweredby.png', 'web/mark.svg']);
});
