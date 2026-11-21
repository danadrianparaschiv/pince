import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { addBooks, deleteBook, editBook, getBook, view } from '../api/src/books.js';
import { requestCovers, runCoverJob } from '../api/src/cover-jobs.js';
import { loadLocalEnv, nodeProblem } from '../scripts/local-env.js';
import { essentials, print, report } from '../scripts/doctor.mjs';
import { readBackup, writeBackup } from '../scripts/local-backup.mjs';
import { LocalStore } from '../scripts/local-store.js';
import { picture, sharp, tempStore } from './helpers.js';

// What a person running the library on their own computer relies on besides the app itself:
// the settings file, the health check, and backups from the command line.

async function folder(t) {
  const path = await mkdtemp(join(tmpdir(), 'pince-local-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

test('settings come from .env unless the shell already has them, and an empty line sets nothing', async (t) => {
  const file = join(await folder(t), '.env');
  await writeFile(
    file,
    [
      '# a comment',
      'PORT=5000',
      'PARENT_USERNAME=',
      'BRAVE_SEARCH_API_KEY="from-file"',
      'TAX_MULTIPLIER=1.19',
    ].join('\n'),
  );
  const env = { PORT: '6000', TAX_MULTIPLIER: '' };
  assert.deepEqual(loadLocalEnv(env, file).sort(), ['BRAVE_SEARCH_API_KEY', 'TAX_MULTIPLIER']);
  // The shell's port wins, an empty shell value is filled in, and the empty file line is ignored.
  assert.deepEqual(env, { PORT: '6000', TAX_MULTIPLIER: '1.19', BRAVE_SEARCH_API_KEY: 'from-file' });
  assert.deepEqual(loadLocalEnv({}, join(await folder(t), 'missing.env')), []);
});

test('the wrong version of Node is explained in words', () => {
  assert.equal(nodeProblem('22.19.0'), null);
  for (const version of ['20.11.1', '24.1.0', '18.0.0'])
    assert.match(
      nodeProblem(version),
      new RegExp('needs Node\\.js 22; this is Node\\.js ' + version.replace(/\./g, '\\.')),
    );
});

test('the health check passes on a working computer and never prints a key', async (t) => {
  const data = await folder(t);
  const secrets = {
    AZURE_OPENAI_API_KEY: 'model-key-' + randomUUID(),
    AZURE_VISION_KEY: 'vision-key-' + randomUUID(),
    GOOGLE_BOOKS_API_KEY: 'google-key-' + randomUUID(),
    BRAVE_SEARCH_API_KEY: 'brave-key-' + randomUUID(),
  };
  const env = {
    LIBRARY_LOCAL_DIR: data,
    PORT: '0',
    ...secrets,
    AZURE_OPENAI_ENDPOINT: 'https://library-test.openai.azure.com',
    AZURE_OPENAI_DEPLOYMENT: 'mini',
    AZURE_VISION_ENDPOINT: 'https://pince-ocr-test.cognitiveservices.azure.com/',
  };
  assert((await essentials(env)).every((check) => check.state === 'ok'));
  const lines = [];
  assert.equal(
    print(await report(env, { added: ['BRAVE_SEARCH_API_KEY'] }), (line) => lines.push(line)),
    0,
  );
  const text = lines.join('\n');
  for (const name of [
    'Photo recognition: Set.',
    'Text detection: Set.',
    'Google Books: Set.',
    'Brave image search: Set.',
  ])
    assert(text.includes(name), name);
  // Names of settings may appear; their values may not.
  assert(text.includes('Supplies BRAVE_SEARCH_API_KEY'));
  for (const value of Object.values(secrets)) assert(!text.includes(value));
});

test('the health check points at a half-configured service, a wrong endpoint and an unwritable folder', async (t) => {
  const data = await folder(t);
  const state = async (env, name) =>
    (await report({ LIBRARY_LOCAL_DIR: data, PORT: '0', ...env })).find((check) => check.name === name);
  assert.deepEqual(await state({}, 'Photo recognition'), {
    state: 'note',
    name: 'Photo recognition',
    detail: 'Not set. Books can still be typed in and covers uploaded.',
  });
  const partial = await state({ AZURE_OPENAI_API_KEY: 'x' }, 'Photo recognition');
  assert.deepEqual(
    [partial.state, partial.detail],
    ['problem', 'Incomplete: also set AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_DEPLOYMENT.'],
  );
  // A key is only ever sent to the Azure service it belongs to.
  for (const endpoint of [
    'http://library-test.openai.azure.com',
    'https://openai.azure.com.example.org',
    'not an address',
  ]) {
    const wrong = await state(
      { AZURE_OPENAI_ENDPOINT: endpoint, AZURE_OPENAI_DEPLOYMENT: 'mini', AZURE_OPENAI_API_KEY: 'x' },
      'Photo recognition',
    );
    assert.equal(wrong.state, 'problem', endpoint);
  }
  const missing = (await essentials({ LIBRARY_LOCAL_DIR: join(data, 'no', 'such', 'place') })).find(
    (check) => check.name === 'Data folder',
  );
  assert.equal(missing.state, 'problem');
});

test('a command-line backup restores into another library with covers, notes and flags intact', async (t) => {
  const { store, queue } = await tempStore(t);
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  await addBooks(store, [
    {
      id: ids[0],
      title: 'Amintiri din copilărie',
      authors: 'Ion Creangă',
      publisher: 'Humanitas',
      publishedDate: '2019-05',
      coverData: await picture(),
    },
    { id: ids[1], title: 'Matilda', authors: 'Roald Dahl', isbn: '9780142410370' },
    { id: ids[2], title: 'Ștearsă' },
  ]);
  await editBook(store, ids[0], {
    changes: { note: 'Citită la bunici', read: true, favorite: true },
    base: { note: '', read: false, favorite: false },
  });
  // The second book gets two suggested covers from a lookup; the first found becomes its cover.
  await requestCovers(store, ids[1]);
  const found = async (background, sourceId) => ({
    data: await picture({ width: 100, height: 160, background }),
    source: 'openlibrary',
    sourceId,
    sourceUrl: 'https://openlibrary.org/works/OL1W',
  });
  await runCoverJob(store, queue[0], {
    provider: async () => [await found('#b22f28', '1'), await found('#234daa', '2')],
  });
  await deleteBook(store, ids[2], (await getBook(store, ids[2])).version);

  const lines = [];
  assert.equal(await writeBackup(store, async (line) => lines.push(line)), 2);
  assert.deepEqual(JSON.parse(lines[0]), { format: 'family-library', version: 4, count: 2, photos: 0 });
  assert(lines.every((line) => line.endsWith('\n')) && !lines.join('').includes('Ștearsă'));

  const other = (await tempStore(t)).store;
  const feed = () => lines.map((line) => line.trimEnd());
  assert.equal(await readBackup(other, feed()), 2);
  const [first, second] = await Promise.all(
    ids.slice(0, 2).map(async (id) => view(await getBook(other, id))),
  );
  const original = view(await getBook(store, ids[0]));
  for (const field of [
    'title',
    'authors',
    'publisher',
    'publishedDate',
    'note',
    'read',
    'favorite',
    'createdAt',
  ])
    assert.deepEqual(first[field], original[field], field);
  assert.deepEqual([first.note, first.read, first.favorite], ['Citită la bunici', true, true]);
  assert.match(first.cover, new RegExp('^/api/covers/' + ids[0] + '/'));
  // The lookup's covers come back as the chosen cover and one alternative, with where they came from.
  assert.equal(second.coverOptions.length, 2);
  assert.deepEqual(
    second.coverOptions.map((option) => [option.source, option.sourceId]),
    [
      ['openlibrary', '1'],
      ['openlibrary', '2'],
    ],
  );
  assert.equal(second.cover, second.coverOptions[0].cover);
  const restoredImage = await other.getImage(ids[1] + '-' + second.cover.split('/').pop() + '.jpg');
  assert.deepEqual(
    (({ format, width, height }) => [format, width, height])(await sharp(restoredImage).metadata()),
    ['jpeg', 100, 160],
  );

  // Restoring the same file again changes nothing.
  await editBook(other, ids[1], { changes: { note: 'Notă nouă' }, base: { note: '' } });
  await readBackup(other, feed());
  assert.equal((await other.list('books')).length, 2);
  assert.equal(view(await getBook(other, ids[1])).note, 'Notă nouă');
});

test('a damaged or foreign backup file is refused before anything is added', async (t) => {
  const { store } = await tempStore(t);
  const book = JSON.stringify({ id: randomUUID(), title: 'O carte', createdAt: '2026-01-01T10:00:00.000Z' });
  const cases = {
    'not a backup file': [JSON.stringify({ format: 'something-else', version: 3, count: 1 }), book],
    'not a backup file ': [JSON.stringify({ format: 'family-library', version: 9, count: 1 }), book],
    'is incomplete': [JSON.stringify({ format: 'family-library', version: 3, count: 2 }), book],
    'lists a book twice': [JSON.stringify({ format: 'family-library', version: 3, count: 2 }), book, book],
    'is incomplete ': [],
  };
  for (const [reason, lines] of Object.entries(cases)) {
    await assert.rejects(readBackup(store, lines), new RegExp(reason.trim()), reason);
    assert.equal((await store.list('books')).length, 0, reason);
  }
  await assert.rejects(readBackup(store, ['{ not json']), SyntaxError);
  // Blank lines, as a text editor might add, are harmless.
  assert.equal(
    await readBackup(store, [
      '',
      JSON.stringify({ format: 'family-library', version: 1, count: 1 }),
      '',
      book,
      '',
    ]),
    1,
  );
});

test(
  'the local database is readable by its owner only, also in a folder others can read',
  { skip: process.platform === 'win32' },
  async (t) => {
    const path = await folder(t);
    await chmod(path, 0o755);
    const first = new LocalStore(path);
    await first.cas('books', 'a', undefined, { id: 'a' });
    first.db.close();
    // An older library made the file readable by everyone; opening it again puts that right.
    await chmod(join(path, 'library.sqlite'), 0o644);
    const store = new LocalStore(path);
    t.after(() => store.db.close());
    await store.cas('books', 'b', undefined, { id: 'b' });
    for (const name of ['library.sqlite', 'library.sqlite-wal', 'library.sqlite-shm'])
      assert.equal((await stat(join(path, name))).mode & 0o777, 0o600, name);
    assert.equal((await store.list('books')).length, 2);
  },
);
