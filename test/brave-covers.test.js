import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { bookPage, braveCovers, braveQuery, braveSearchUrl, resultFit } from '../api/src/brave-covers.js';
import { braveRequestBudget, findCovers } from '../api/src/cover-providers.js';
import { addBooks, coverProvenance, getBook, view } from '../api/src/books.js';
import { requestCovers, runCoverJob } from '../api/src/cover-jobs.js';
import { jpeg, tempStore } from './helpers.js';

const picture = (background, width = 500, height = 640) => jpeg({ width, height, background });
const proxy = (name) =>
  'https://imgs.search.brave.com/' + name + '/rs:fit:500:0:0:0/g:ce/aHR0cHM6Ly9leGFtcGxl';
const row = (title, url, name, properties = {}) => ({
  type: 'image_result',
  title,
  url,
  source: new URL(url).hostname,
  thumbnail: { src: proxy(name) },
  properties: { url: 'https://cdn.example/' + name + '.jpg', ...properties },
});
const cosmos = { title: 'Uimitorul cosmos', authors: '', isbn: '', publisher: 'Gama' };

test('a search result is offered only from a known book page whose title names the book', () => {
  const fit = (book, title, url) => resultFit(book, { title, url });
  assert.ok(
    fit(
      cosmos,
      'Uimitorul cosmos - Editura Gama | Libris',
      'https://www.libris.ro/uimitorul-cosmos-GAM123.html',
    ),
  );
  // The publisher's own page ranks above a shop that does not name the publisher.
  assert.ok(
    fit(cosmos, 'Uimitorul cosmos', 'https://www.edituragama.ro/uimitorul-cosmos') >
      fit(cosmos, 'Uimitorul cosmos', 'https://carturesti.ro/carte/uimitorul-cosmos-1'),
  );
  assert.equal(fit(cosmos, 'Uimitorul cosmos - Gama', 'https://pinterest.com/pin/1'), 0);
  assert.equal(fit(cosmos, 'Uimitorul cosmos - Gama', 'http://www.libris.ro/uimitorul-cosmos'), 0);
  assert.equal(fit(cosmos, 'Uimitorul cosmos - Gama', 'https://libris.ro.evil.example/uimitorul-cosmos'), 0);
  assert.equal(fit(cosmos, 'Atlasul cosmosului - Gama', 'https://www.libris.ro/atlasul-cosmosului'), 0);

  // A short title also begins other titles, so something else on the page must point at this book.
  const farm = { title: 'Ferma', authors: '', publisher: 'RAO' };
  assert.equal(
    fit(
      farm,
      'Ferma animalelor - George Orwell - Libris',
      'https://www.libris.ro/ferma-animalelor-george-orwell',
    ),
    0,
  );
  assert.ok(fit(farm, 'Ferma - Editura RAO', 'https://www.libris.ro/ferma-RAO978.html'));
  assert.ok(fit(farm, 'Ferma animalelor mici', 'https://raobooks.com/produs/ferma'));
  assert.ok(
    fit(
      { title: 'Florile', authors: 'Emily Bone', publisher: '' },
      'Florile, Usborne',
      'https://carturesti.ro/carte/florile-emily-bone-12',
    ),
  );
  assert.equal(
    fit(
      { title: 'Florile', authors: 'Emily Bone', publisher: '' },
      'Florile răului - Charles Baudelaire',
      'https://carturesti.ro/carte/florile-raului-9',
    ),
    0,
  );
  // "Casa" and "Art" are ordinary words: they count as a publisher only as "editura casa" or on the publisher's site.
  const how = { title: 'Cum funcționează?', authors: '', publisher: 'Casa' };
  assert.equal(
    fit(how, 'Cum funcționează casa ta', 'https://www.elefant.ro/cum-functioneaza-casa-ta_1.html'),
    0,
  );
  assert.ok(fit(how, 'Cum funcționează? Editura Casa', 'https://www.elefant.ro/cum-functioneaza_1.html'));
  assert.ok(fit(how, 'Cum funcționează ceasul', 'https://www.editura-casa.ro/cum-functioneaza'));
});

test('book page addresses are tidied the same way every time, and the search request is fixed', () => {
  assert.equal(bookPage('https://www.libris.ro/carte?id=5#recenzii'), 'https://www.libris.ro/carte?id=5');
  const long = 'https://www.libris.ro/carte?' + 'a'.repeat(400);
  assert.equal(bookPage(long), 'https://www.libris.ro/carte');
  for (const page of ['https://www.libris.ro/carte?id=5', long, 'https://www.emag.ro/' + 'p/'.repeat(200)])
    assert.equal(bookPage(bookPage(page)), bookPage(page));
  for (const bad of [
    'https://user@libris.ro/x',
    'https://libris.ro:8443/x',
    'ftp://libris.ro/x',
    'https://notlibris.ro/x',
    'nonsense',
  ])
    assert.equal(bookPage(bad), null);
  const url = new URL(
    braveSearchUrl(
      braveQuery({
        title: 'Ce se "întâmplă" noaptea',
        authors: 'Laura Cowan, Bonnie Pang',
        publisher: 'Usborne',
      }),
    ),
  );
  assert.equal(url.origin + url.pathname, 'https://api.search.brave.com/res/v1/images/search');
  assert.equal(url.searchParams.get('q'), '"Ce se întâmplă noaptea" Laura Cowan Usborne');
  assert.equal(url.searchParams.get('safesearch'), 'strict');
  assert.equal(
    braveQuery({ title: 'Miffy at School', authors: 'Dick Bruna' }),
    '"Miffy at School" Dick Bruna',
  );
  assert.equal(braveQuery({ title: 'Munții' }), '"Munții" carte');
  assert.equal(braveQuery({ title: 'Miffy' }), '"Miffy" book');
  const id = 'a'.repeat(32),
    page = 'https://www.libris.ro/uimitorul-cosmos';
  assert.deepEqual(coverProvenance({ source: 'bravesearch', sourceId: id, sourceUrl: page }), {
    source: 'bravesearch',
    sourceId: id,
    sourceUrl: page,
  });
  assert.deepEqual(
    coverProvenance({ source: 'bravesearch', sourceId: id, sourceUrl: 'https://evil.example/x' }),
    {},
  );
  assert.deepEqual(coverProvenance({ source: 'bravesearch', sourceId: 'short', sourceUrl: page }), {});
});

test('covers come only from the image proxy: best page first, duplicates and odd shapes left out', async () => {
  const red = await picture('red'),
    blue = await picture('blue'),
    strip = await picture('green', 500, 90),
    calls = [];
  const results = [
    row('Uimitorul cosmos | Carturesti', 'https://carturesti.ro/carte/uimitorul-cosmos-1', 'shop'),
    row('Uimitorul cosmos - Gama', 'https://blog.example/uimitorul-cosmos', 'blog'),
    row('Uimitorul cosmos', 'https://www.edituragama.ro/uimitorul-cosmos', 'publisher'),
    row('Uimitorul cosmos - Gama - Libris', 'https://www.libris.ro/uimitorul-cosmos', 'copy'),
    row('Uimitorul cosmos - Gama', 'https://www.elefant.ro/uimitorul-cosmos_1.html', 'banner', {
      width: 1200,
      height: 200,
    }),
    row('Uimitorul cosmos - Gama', 'https://www.cartepedia.ro/carte/uimitorul-cosmos.html', 'strip'),
    {
      ...row('Uimitorul cosmos - Gama', 'https://www.emag.ro/uimitorul-cosmos/pd/1', 'direct'),
      thumbnail: { src: 'https://s13emagst.akamaized.net/cover.jpg' },
    },
    { title: 'Uimitorul cosmos - Gama', url: 'https://www.libris.ro/x' },
    null,
    'text',
  ];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    const u = new URL(url);
    if (u.hostname === 'api.search.brave.com') return Response.json({ type: 'images', results });
    const name = u.pathname.split('/')[1];
    return new Response(name === 'publisher' ? blue : name === 'strip' ? strip : red);
  };
  const found = await braveCovers(cosmos, { braveKey: 'private-test-key', fetcher });
  assert.deepEqual(
    found.map((c) => c.sourceUrl),
    ['https://www.edituragama.ro/uimitorul-cosmos', 'https://www.libris.ro/uimitorul-cosmos'],
  );
  assert.ok(
    found.every(
      (c) =>
        c.source === 'bravesearch' &&
        /^[0-9a-f]{32}$/.test(c.sourceId) &&
        c.data.startsWith('data:image/jpeg;base64,'),
    ),
  );
  assert.ok(found.every((c) => coverProvenance(c).sourceUrl === c.sourceUrl));
  assert.equal(calls[0].options.headers['X-Subscription-Token'], 'private-test-key');
  assert.equal(calls[0].options.redirect, 'error');
  const downloads = calls.slice(1);
  assert.ok(
    downloads.length <= 4 &&
      downloads.every(
        (c) =>
          new URL(c.url).hostname === 'imgs.search.brave.com' &&
          c.options.redirect === 'error' &&
          !JSON.stringify(c).includes('private-test-key'),
      ),
  );
  // The same picture from two shops is one suggestion.
  const twins = await braveCovers(cosmos, {
    braveKey: 'k',
    fetcher: async (url) =>
      new URL(url).hostname === 'api.search.brave.com'
        ? Response.json({ results: results.slice(2, 4) })
        : new Response(red),
  });
  assert.equal(twins.length, 1);
});

test('search failures are reported without retry storms, and an unconfigured key asks nothing', async () => {
  const blocks = [];
  const failing = (status) =>
    braveCovers(cosmos, {
      braveKey: 'k',
      blockBrave: async (reason) => blocks.push(reason),
      fetcher: async () => new Response(null, { status }),
    });
  await assert.rejects(
    failing(429),
    (e) => e.source === 'bravesearch' && e.reason === 'quota' && e.retryable === false,
  );
  await assert.rejects(failing(401), (e) => e.reason === 'access' && e.retryable === false);
  await assert.rejects(failing(422), (e) => e.reason === 'request' && e.retryable === false);
  await assert.rejects(failing(503), (e) => e.reason === 'unavailable' && e.retryable === true);
  assert.deepEqual(blocks, ['quota', 'access']);
  await assert.rejects(
    braveCovers(cosmos, { fetcher: () => assert.fail('No key, no request') }),
    (e) => e.reason === 'notConfigured',
  );
  assert.deepEqual(
    await braveCovers({ title: 'A' }, { braveKey: 'k', fetcher: () => assert.fail('Too short to search') }),
    [],
  );
  assert.deepEqual(
    await braveCovers(cosmos, { braveKey: 'k', fetcher: async () => Response.json({ results: 'none' }) }),
    [],
  );
});

test('the image search runs last, only with a key, and only when the catalogues leave a gap', async () => {
  const cover = async (color, source, id) => ({
    data: 'data:image/jpeg;base64,' + (await picture(color, 100, 160)).toString('base64'),
    source,
    sourceId: id,
    sourceUrl: 'https://www.libris.ro/' + id,
  });
  const red = await cover('red', 'openlibrary', '1'),
    blue = await cover('blue', 'googlebooks', '2'),
    green = await cover('green', 'bravesearch', '3');
  const none = async () => [],
    never = () => assert.fail('Unnecessary search');
  assert.deepEqual(
    (await findCovers(cosmos, { openLibrary: none, googleBooks: none, braveSearch: never })).covers,
    [],
  );
  assert.deepEqual(
    (
      await findCovers(cosmos, {
        braveKey: 'k',
        openLibrary: async () => [red],
        googleBooks: async () => [blue],
        braveSearch: never,
      })
    ).covers,
    [red, blue],
  );
  const filled = await findCovers(cosmos, {
    braveKey: 'k',
    openLibrary: none,
    googleBooks: none,
    braveSearch: async () => [green],
  });
  assert.deepEqual(filled, { covers: [green], warnings: [] });
  const rescued = await findCovers(cosmos, {
    braveKey: 'k',
    openLibrary: none,
    googleBooks: async () => {
      throw Error('Google offline');
    },
    braveSearch: async () => [green],
  });
  assert.deepEqual(rescued, { covers: [green], warnings: ['googlebooks'] });
  const partial = await findCovers(cosmos, {
    braveKey: 'k',
    openLibrary: async () => [red],
    googleBooks: none,
    braveSearch: async () => {
      throw Error('Brave offline');
    },
  });
  assert.deepEqual(partial, { covers: [red], warnings: ['bravesearch'] });
  await assert.rejects(
    findCovers(cosmos, {
      braveKey: 'k',
      openLibrary: none,
      googleBooks: none,
      braveSearch: async () => {
        throw Error('Brave offline');
      },
    }),
    /Brave offline/,
  );
});

test('a queued lookup stores image-search covers with their page, counts requests and stops at the monthly limit', async (t) => {
  const { store, queue } = await tempStore(t);
  const id = randomUUID(),
    blue = await picture('blue');
  await addBooks(store, [{ id, ...cosmos }]);
  await requestCovers(store, id);
  let searched;
  await runCoverJob(store, queue[0], {
    env: { BRAVE_SEARCH_API_KEY: 'k' },
    wait: async () => {},
    provider: (book, options) =>
      findCovers(book, {
        ...options,
        openLibrary: async () => [],
        googleBooks: async () => [],
        fetcher: async (url) => {
          if (new URL(url).hostname !== 'api.search.brave.com') return new Response(blue);
          searched = new URL(url).searchParams.get('q');
          return Response.json({
            results: [
              row('Uimitorul cosmos - Gama - Libris', 'https://www.libris.ro/uimitorul-cosmos', 'one'),
            ],
          });
        },
      }),
  });
  assert.equal(searched, '"Uimitorul cosmos" Gama');
  const saved = await getBook(store, id),
    shown = view(saved);
  assert.equal(saved.coverLookup.status, 'ready');
  assert.ok(saved.image);
  assert.deepEqual(
    shown.coverOptions.map((c) => [c.source, c.sourceUrl]),
    [['bravesearch', 'https://www.libris.ro/uimitorul-cosmos']],
  );
  // A cover found by image search needs no credit line on the page a friend sees.
  assert.equal(view(saved, true).coverAttribution, undefined);
  const day = new Date().toISOString().slice(0, 10),
    usage = await store.get('system', 'brave-cover-usage');
  assert.deepEqual(usage.value.days, { [day]: 1 });
  await store.cas('system', 'brave-cover-usage', usage.etag, {
    days: { [day]: 150, [day.slice(0, 8) + (day.endsWith('01') ? '02' : '01')]: 750 },
  });
  await assert.rejects(
    braveRequestBudget(store).beforeBraveQuery(),
    (e) => e.source === 'bravesearch' && e.reason === 'localLimit',
  );
  await braveRequestBudget(store).blockBrave('quota');
  await assert.rejects(braveRequestBudget(store).beforeBraveQuery(), (e) => e.reason === 'quota');
});
