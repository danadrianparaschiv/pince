// Score saved /api/scan responses against the hand-labeled photo crops.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) throw Error('Usage: node scripts/score-shelf-scans.mjs <directory containing IMG_4968.json, IMG_4970.json, IMG_4971.json>');
const labels = JSON.parse(await readFile(new URL('../test/fixtures/shelf-benchmark.json', import.meta.url), 'utf8'));
const normalize = text => String(text ?? '').normalize('NFC').toLowerCase().replace(/[\p{P}\p{S}\s]+/gu,' ').trim();
const fold = text => text.normalize('NFD').replace(/\p{M}/gu,'');
for (const sample of labels.images) {
  const { books } = JSON.parse(await readFile(join(dir, sample.file + '.json'),'utf8'));
  if (!Array.isArray(books)) throw Error('Expected a scan response with a books array for ' + sample.file);
  const available = new Set(books.map((_, i) => i));
  const misses = [];
  let correct = 0, accentErrors = 0;
  for (const label of sample.books) {
    const variants = [label.title];
    if (label.series) variants.push(label.series + ' ' + label.title, label.title + ' ' + label.series);
    const expected = variants.map(normalize);
    const indices = Array.from(available);
    let match = indices.find(i => expected.includes(normalize(books[i].title)));
    if (match !== undefined) correct++;
    else {
      match = indices.find(i => expected.some(title => fold(title) === fold(normalize(books[i].title))));
      if (match !== undefined) accentErrors++;
    }
    if (match !== undefined) available.delete(match);
    else misses.push(label.title);
  }
  console.log(JSON.stringify({ photo: sample.file, labeled: sample.books.length, correct, accentErrors,
    missedOrMisread: misses, otherRows: [...available].map(i => books[i].title),
    unexpectedDates: books.filter(row => row.publishedDate).map(row => [row.title,row.publishedDate]) }, null, 2));
}
