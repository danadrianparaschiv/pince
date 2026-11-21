import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { findCovers, surfaceColour } from '../api/src/cover-finder.js';
import { coversMessages, placeCovers, titleJoin } from '../api/src/covers-scan.js';
import { coverBox } from '../web/import.js';
import { modelSettings, sharp, startLibrary } from './helpers.js';

// Five books on a grey-green cloth, 800 × 700: A has two titles and a cloth-coloured patch in its
// picture, B and C touch, D is dark and turned six degrees, E runs off the right edge of the photo.
const turn = (6 * Math.PI) / 180;
const scene = (
  scale,
) => `<svg xmlns="http://www.w3.org/2000/svg" width="${800 * scale}" height="${700 * scale}" viewBox="0 0 800 700">
  <rect width="800" height="700" fill="#6c6e62"/>
  <rect x="60" y="80" width="200" height="280" fill="#fff"/><ellipse cx="160" cy="225" rx="72" ry="42" fill="#6c6e62"/>
  <rect x="300" y="90" width="200" height="280" fill="#fff"/><rect x="500" y="90" width="200" height="280" fill="#fff"/>
  <rect x="499" y="90" width="2" height="280" fill="#b4b4b4"/>
  <rect x="80" y="420" width="200" height="240" fill="#3b4a8c" transform="rotate(6 180 540)"/>
  <rect x="640" y="420" width="200" height="260" fill="#fff"/>
  <g fill="#222"><rect x="90" y="110" width="140" height="26"/><rect x="120" y="300" width="120" height="26"/>
    <rect x="330" y="120" width="140" height="26"/><rect x="530" y="120" width="140" height="26"/><rect x="665" y="450" width="120" height="26"/></g>
</svg>`;
const titles = [
  'Puii lui Azor' + titleJoin + 'Eu și Azor',
  'Balaurul vesel',
  'Castelul fermecat',
  'Dimineața devreme',
  'Elefantul albastru',
];
// Where the text detector would see each title, as [text, left, top, width, height, angle].
const lettering = [
  ['Puii lui Azor', 90, 110, 140, 26, 0],
  ['Eu și Azor', 120, 300, 120, 26, 0],
  ['Balaurul vesel', 330, 120, 140, 26, 0],
  ['Castelul fermecat', 530, 120, 140, 26, 0],
  ['Elefantul albastru', 665, 450, 120, 26, 0],
  ['Dimineața devreme', 180 + 70 * Math.sin(turn) - 70, 540 - 70 * Math.cos(turn) - 13, 140, 26, turn],
];
const lines = (scale) =>
  lettering.map(([text, left, top, width, height, angle]) => {
    const cx = left + width / 2,
      cy = top + height / 2,
      cos = Math.cos(angle),
      sin = Math.sin(angle);
    return {
      text,
      corners: [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([u, v]) => ({
        x: scale * (cx + ((u * width) / 2) * cos - ((v * height) / 2) * sin),
        y: scale * (cy + ((u * width) / 2) * sin + ((v * height) / 2) * cos),
      })),
    };
  });
// The true covers as [centre x, centre y, width, height]; E is cut at the photo's edge.
const truth = [
  [160, 220, 200, 280],
  [400, 230, 200, 280],
  [600, 230, 200, 280],
  [180, 540, 200, 240],
  [720, 550, 160, 260],
];
const closeTo = (cover, [x, y, width, height], scale = 1, slack = 7) =>
  assert(
    cover &&
      [
        [cover.x, x],
        [cover.y, y],
        [cover.width, width],
        [cover.height, height],
      ].every(([got, want]) => Math.abs(got - want * scale) <= slack * scale),
    JSON.stringify(cover) + ' is not ' + JSON.stringify([x, y, width, height]),
  );

test('each cover is found from its title: touching covers, a turned one, one cut by the photo edge', async () => {
  const { data, info } = await sharp(Buffer.from(scene(1)))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const image = { data, width: info.width, height: info.height };
  const surface = surfaceColour(image);
  assert(
    surface.share > 0.8 &&
      surface.mean.every((value, channel) => Math.abs(value - [108, 110, 98][channel]) < 3),
  );
  const place = (left, top, width, height, angle = 0) => ({
    x: left + width / 2,
    y: top + height / 2,
    length: width,
    height,
    angle,
  });
  const places = [
    place(90, 110, 150, 216),
    place(330, 120, 140, 26),
    place(530, 120, 140, 26),
    { x: 180 + 70 * Math.sin(turn), y: 540 - 70 * Math.cos(turn), length: 140, height: 26, angle: turn },
    place(665, 450, 120, 26),
  ];
  const found = findCovers(image, places);
  found.forEach((cover, index) => closeTo(cover, truth[index]));
  // Edges with cloth beyond them are certain; the line where two covers touch is not.
  assert.deepEqual(
    found.map((cover) => cover.sure),
    [true, false, false, true, true],
  );
  assert(Math.abs(found[3].angle - turn) < 0.01 && found[0].angle === 0);
  // A title that was not placed gets no cover, and does not disturb the others.
  const fewer = findCovers(image, [places[0], null, places[2]]);
  assert.equal(fewer[1], null);
  closeTo(fewer[0], truth[0]);
  // Without B's title in the way, C runs on to the cloth beyond B: touching covers need both titles.
  assert(fewer[2].width > 380);

  // A busy surface has no one colour to look for: nothing is guessed.
  const stripes = await sharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">' +
        Array.from(
          { length: 80 },
          (_, i) =>
            `<rect x="${(i % 10) * 40}" y="${Math.floor(i / 10) * 40}" width="40" height="40" fill="${
              ['#c22', '#2a2', '#22c', '#cc2', '#2cc', '#c2c', '#222', '#eee'][
                ((i % 10) + 3 * Math.floor(i / 10)) % 8
              ]
            }"/>`,
        ).join('') +
        '<rect x="150" y="80" width="100" height="140" fill="#fff"/></svg>',
    ),
  )
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const busy = { data: stripes.data, width: stripes.info.width, height: stripes.info.height };
  assert.equal(surfaceColour(busy), null);
  assert.deepEqual(findCovers(busy, [place(160, 100, 80, 20)]), [null]);
});

test("covers are placed in the detector's own photo size, with two titles on one cover kept together", async () => {
  const photo = await sharp(Buffer.from(scene(2)))
    .jpeg({ quality: 88 })
    .toBuffer();
  const detected = { width: 1600, height: 1400, lines: lines(2) };
  const covers = await placeCovers(titles, detected, photo);
  covers.forEach((cover, index) => closeTo(cover, truth[[0, 1, 2, 3, 4][index]], 2, 8));
  assert(covers.every((cover) => Number.isInteger(cover.x) && Number.isInteger(cover.width)));
  // The browser starts its hand crop from the same place, in whole percentages of the photo.
  assert.deepEqual(
    coverBox({ x: 800, y: 460, width: 400, height: 560, angle: 0 }, { width: 1600, height: 1400 }),
    { left: 38, top: 13, right: 38, bottom: 47 },
  );
  assert.equal(coverBox(null, { width: 1600, height: 1400 }), null);
  const prompt = coversMessages(
    [
      { x: 0, y: 0, w: 60, h: 100 },
      { x: 40, y: 0, w: 60, h: 100 },
    ],
    ['Editura Mea'],
    'en',
  );
  assert.match(prompt.system, /front covers facing up/);
  assert(
    prompt.system.includes('joined by "' + titleJoin + '"') &&
      prompt.system.includes('Editura Mea') &&
      prompt.system.includes('in English'),
  );
  assert.match(prompt.layout, /Image 3 covers x 40-100% and y 0-100%/);
});

test('a photo of several covers is its own scan mode: rows with cover places, nothing kept', async (t) => {
  const row = (title, extra = {}) => ({
    title,
    authors: 'Ana Pop',
    publisher: '',
    publishedDate: '',
    rawText: title,
    series: '',
    volume: '',
    confidence: 'high',
    note: '',
    ...extra,
  });
  const photo = await sharp(Buffer.from(scene(2)))
    .jpeg({ quality: 88 })
    .toBuffer();
  const image = 'data:image/jpeg;base64,' + photo.toString('base64');
  let seen,
    detector = async (_env, bytes) => {
      seen.detected = bytes.length;
      return { width: 1600, height: 1400, lines: lines(2) };
    };
  const model = async (_env, images, mode, context) => {
    seen = { images: images.length, mode, tiles: context.tiles };
    return {
      usage: { prompt_tokens: 9000, completion_tokens: 600 },
      choices: [
        {
          message: {
            content: JSON.stringify({
              unreadable: 1,
              more: 0,
              books: [
                row(titles[0], { publisher: 'pan da (logo)' }),
                row(titles[1]),
                row('Zmeul nevăzut'),
                row(titles[3]),
                row(titles[2]),
              ],
            }),
          },
        },
      ],
    };
  };
  const { call, parentWithScanning } = await startLibrary(t, {
    env: modelSettings,
    model,
    readText: (...args) => detector(...args),
  });
  const cookie = await parentWithScanning();
  const tiles = [
    { x: 0, y: 0, w: 60, h: 100, image },
    { x: 40, y: 0, w: 60, h: 100, image },
  ];
  const body = { requestId: randomUUID(), mode: 'covers', lang: 'en', image, tiles };
  const result = await call('scan', 'POST', body, cookie);
  assert.equal(result.status, 200);
  assert.deepEqual(seen, {
    images: 3,
    mode: 'covers',
    tiles: [
      { x: 0, y: 0, w: 60, h: 100 },
      { x: 40, y: 0, w: 60, h: 100 },
    ],
    detected: seen.detected,
  });
  assert(seen.detected > 1000);
  assert.deepEqual(
    result.data.books.map((b) => [b.title, b.publisher]),
    [
      [titles[0], 'Panda'],
      [titles[1], ''],
      ['Zmeul nevăzut', ''],
      [titles[3], ''],
      [titles[2], ''],
    ],
  );
  assert.deepEqual(
    [result.data.unreadable, result.data.partial, result.data.photo],
    [1, false, { width: 1600, height: 1400 }],
  );
  closeTo(result.data.books[0].cover, truth[0], 2, 8);
  closeTo(result.data.books[1].cover, truth[1], 2, 8);
  closeTo(result.data.books[3].cover, truth[3], 2, 8);
  closeTo(result.data.books[4].cover, truth[2], 2, 8);
  // A title the detector did not see has no cover place; the row is still offered.
  assert.equal(result.data.books[2].cover, null);
  // Unlike a shelf photo, this one is not kept, and its rows carry no spine places.
  assert.equal(result.data.shelfPhoto, undefined);
  assert.equal('place' in result.data.books[0], false);
  assert.deepEqual((await call('shelf-photos', 'GET', undefined, cookie)).data.photos, []);
  assert.deepEqual((await call('scan', 'POST', body, cookie)).data, result.data);
  // Each saved book takes its own cut-out as its cover.
  const cut =
    'data:image/jpeg;base64,' +
    (await sharp(photo).extract({ left: 120, top: 160, width: 400, height: 560 }).jpeg().toBuffer()).toString(
      'base64',
    );
  const ids = [randomUUID(), randomUUID()];
  const saved = await call(
    'books',
    'POST',
    {
      books: [
        { id: ids[0], title: 'Balaurul vesel', coverData: cut },
        { id: ids[1], title: 'Zmeul nevăzut' },
      ],
    },
    cookie,
  );
  assert.equal(saved.status, 201);
  assert.deepEqual(
    saved.data.books.map((b) => [Boolean(b.cover), b.shelfPhoto]),
    [
      [true, null],
      [false, null],
    ],
  );

  // Without a text detector the books are still read; covers are then marked by hand.
  detector = async () => null;
  const plain = await call('scan', 'POST', { ...body, requestId: randomUUID() }, cookie);
  assert.equal(plain.status, 200);
  assert.deepEqual(
    [plain.data.books.length, 'cover' in plain.data.books[0], plain.data.photo],
    [5, false, undefined],
  );
  assert.equal(
    (await call('scan', 'POST', { requestId: randomUUID(), mode: 'cover', image, tiles }, cookie)).status,
    400,
  );
  assert.equal(
    (await call('scan', 'POST', { requestId: randomUUID(), mode: 'spines', image }, cookie)).status,
    400,
  );
});
