// Where each scanned book sits in the shelf photo.
//
// The scan model reads titles but cannot say where they are: in live tests its boxes
// landed on neighbouring spines however it was asked. A text detector measures where
// text is, so a title is placed by finding its own words in the detector's output.
// A row is placed only on a strong match; otherwise it simply gets no cut-out.
import sharp from 'sharp';
import { validTextEndpoint } from './endpoints.js';

const fold = s => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const words = s => fold(s).split(' ').filter(Boolean);

function config(env) {
  if (!validTextEndpoint(env.AZURE_VISION_ENDPOINT) || !env.AZURE_VISION_KEY) return null;
  return {
    url: new URL('/computervision/imageanalysis:analyze?api-version=2024-02-01&features=read', env.AZURE_VISION_ENDPOINT),
    key: env.AZURE_VISION_KEY,
  };
}

/**
 * Text lines in the photo with their corner points, or null when no detector is configured.
 * The free tier cannot bill, so this call is outside the scan budget; a paid tier would need a hold.
 */
export async function readShelfText(env, image, fetcher = fetch) {
  const service = config(env);
  if (!service) return null;
  const { width, height } = await sharp(image).metadata();
  const response = await fetcher(service.url, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(12000),
    headers: { 'Ocp-Apim-Subscription-Key': service.key, 'Content-Type': 'application/octet-stream' },
    body: image,
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw Error('Text detection unavailable');
  }
  const blocks = (await response.json())?.readResult?.blocks;
  const lines = [];
  for (const block of Array.isArray(blocks) ? blocks : []) {
    for (const line of Array.isArray(block?.lines) ? block.lines : []) {
      const corners = line?.boundingPolygon;
      if (typeof line?.text !== 'string' || !Array.isArray(corners) || corners.length !== 4 ||
          !corners.every(c => Number.isFinite(c?.x) && Number.isFinite(c?.y))) continue;
      lines.push({ text: line.text.slice(0, 200), corners: corners.map(c => ({ x: c.x, y: c.y })) });
      if (lines.length === 300) return { width, height, lines };
    }
  }
  return { width, height, lines };
}

function distance(a, b) {
  let prior = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < b.length; j++) next.push(Math.min(next[j] + 1, prior[j + 1] + 1, prior[j] + (a[i] === b[j] ? 0 : 1)));
    prior = next;
  }
  return prior[b.length];
}
// Both readers drop a letter or a diacritic here and there; a long word may differ a little.
function similar(a, b) {
  if (a === b) return true;
  const short = Math.min(a.length, b.length), long = Math.max(a.length, b.length);
  return short >= 5 && distance(a, b) <= (long >= 11 ? 3 : long >= 8 ? 2 : 1);
}
// Placing titles is plain computation on the server, so it is bounded whatever a photo says:
// long titles and lines are cut, and the search stops after a moment. A title that is not
// reached simply gets no cut-out.
const maxTitleWords = 12, maxLineWords = 24, maxWordLength = 32;
const cut = (list, most) => list.slice(0, most).map(word => word.slice(0, maxWordLength));
function shape(line) {
  const c = line.corners, dx = c[1].x - c[0].x, dy = c[1].y - c[0].y;
  return { corners: c, words: cut(words(line.text), maxLineWords), length: Math.hypot(dx, dy), height: Math.hypot(c[3].x - c[0].x, c[3].y - c[0].y),
    angle: Math.atan2(dy, dx), cx: (c[0].x + c[2].x) / 2, cy: (c[0].y + c[2].y) / 2 };
}

/**
 * For each title, the upright rectangle around its own lettering, or null.
 * Lengths are in photo pixels; the angle is the direction the text reads, in radians.
 */
export function placeTitles(titles, textLines, budget = 1500) {
  const until = Date.now() + budget;
  const lines = textLines.map(shape).filter(line => line.words.length && line.length > 0 && line.height > 0);
  // The same pairs of words are compared again and again; each pair is worked out once.
  const known = new Map();
  const alike = (a, b) => {
    if (a === b) return true;
    const pair = a < b ? a + ' ' + b : b + ' ' + a;
    let answer = known.get(pair);
    if (answer === undefined) known.set(pair, answer = similar(a, b));
    return answer;
  };
  // A word printed on many spines ("enciclopedia", "exploratori") says little about which book this is.
  const spread = word => lines.filter(line => line.words.some(w => alike(w, word))).length;
  const options = [];
  for (const [row, title] of titles.entries()) {
    if (Date.now() > until) break;
    const wanted = cut(words(title), maxTitleWords), squashed = wanted.join('');
    if (squashed.length < 3) continue;
    const weight = new Map(wanted.map(w => [w, w.length / Math.max(1, spread(w))]));
    const total = [...weight.values()].reduce((a, b) => a + b, 0);
    const covered = set => {
      // The detector sometimes runs a title's words together ("PORTALULMAGIC").
      if (squashed.length >= 6 && set.some(line => line.words.join('').includes(squashed))) return 1;
      return wanted.filter(w => set.some(line => line.words.some(x => alike(x, w)))).reduce((sum, w) => sum + weight.get(w), 0) / total;
    };
    // How much of the chosen lines the title accounts for: "Miffy" should take the line that says only "Miffy".
    const explained = set => {
      const all = set.flatMap(line => line.words), size = all.reduce((n, w) => n + w.length, 0);
      return all.filter(w => wanted.some(x => alike(x, w))).reduce((n, w) => n + w.length, 0) / Math.max(1, size);
    };
    for (const first of lines) {
      if (Date.now() > until) break;
      // Small shared words ("cu", "de la") must not make a neighbouring spine a candidate.
      if (covered([first]) < 0.3) continue;
      // A title can wrap onto further lines of the same spine or cover.
      const set = [first], cos = Math.cos(first.angle), sin = Math.sin(first.angle);
      for (let grew = true; grew && set.length < 5 && Date.now() <= until;) {
        grew = false;
        for (const other of lines) {
          if (set.includes(other)) continue;
          const turn = Math.abs(Math.atan2(Math.sin(other.angle - first.angle), Math.cos(other.angle - first.angle)));
          // Same book: beside a chosen line or continuing it, measured along the first line's own direction.
          const near = set.some(member => {
            const tall = Math.max(member.height, other.height), dx = other.cx - member.cx, dy = other.cy - member.cy;
            const gap = Math.abs(dx * cos + dy * sin) - (member.length + other.length) / 2;
            return Math.abs(-dx * sin + dy * cos) <= 2.5 * tall && gap <= 1.5 * tall;
          });
          if (turn < 0.3 && near && covered([...set, other]) > covered(set) + 0.1) {
            set.push(other);
            grew = true;
          }
        }
      }
      options.push({ row, set, score: covered(set), explained: explained(set), size: Math.max(...set.map(line => line.height)) });
    }
  }
  // Best matches first. On a tie the tighter fit wins, then fewer lines, then bigger lettering,
  // since the title is the prominent text on a spine.
  options.sort((a, b) => b.score - a.score || b.explained - a.explained || a.set.length - b.set.length || b.size - a.size);
  const places = titles.map(() => null), used = new Set();
  for (const option of options) {
    if (option.score < 0.7 || places[option.row] || option.set.some(line => used.has(line))) continue;
    option.set.forEach(line => used.add(line));
    const [first] = option.set, cos = Math.cos(first.angle), sin = Math.sin(first.angle);
    const along = [], across = [];
    for (const line of option.set) {
      for (const c of line.corners) {
        along.push(c.x * cos + c.y * sin);
        across.push(-c.x * sin + c.y * cos);
      }
    }
    const u = (Math.min(...along) + Math.max(...along)) / 2, v = (Math.min(...across) + Math.max(...across)) / 2;
    places[option.row] = {
      x: Math.round(u * cos - v * sin), y: Math.round(u * sin + v * cos),
      length: Math.round(Math.max(...along) - Math.min(...along)), height: Math.round(Math.max(...across) - Math.min(...across)),
      line: Math.round(option.size), angle: Math.round(first.angle * 1000) / 1000,
    };
  }
  return places;
}
