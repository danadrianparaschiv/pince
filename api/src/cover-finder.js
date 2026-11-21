// Where each front cover lies in a photo of several books laid out on a plain surface.
//
// The scan model reads the covers but cannot say where they are, and a text detector only
// finds lettering. A cover is found here from its own title: starting at the title, each side
// moves outward to the first straight line that has the surface on its far side and something
// else on its near side. Where two covers touch there is no surface between them, so the line
// between them is the strongest straight edge between their two titles.
// A cover that cannot be found this way gets no box, and the family marks it by hand.

const clamp = (n, low, high) => Math.max(low, Math.min(high, n));

/**
 * The colour of the surface the books lie on: the commonest colour along the photo's border.
 * Returns null when the border has no clear commonest colour (a patterned or busy surface).
 */
export function surfaceColour({ data, width, height }) {
  const band = Math.max(2, Math.round(Math.min(width, height) * 0.05)), bins = new Map();
  const border = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x >= band && x < width - band && y >= band && y < height - band) { x = width - band - 1; continue; }
      const i = (y * width + x) * 3, key = (data[i] >> 4) << 8 | (data[i + 1] >> 4) << 4 | data[i + 2] >> 4;
      bins.set(key, (bins.get(key) || 0) + 1);
      border.push(i);
    }
  }
  let top = 0, best = 0;
  for (const [key, count] of bins) if (count > best) { best = count; top = key; }
  // Gather the border pixels near that colour, twice, so shading and folds stay inside the estimate.
  let mean = [(top >> 8) * 16 + 8, (top >> 4 & 15) * 16 + 8, (top & 15) * 16 + 8], spread = [12, 12, 12], share = 0;
  for (let round = 0; round < 2; round++) {
    const sum = [0, 0, 0], squares = [0, 0, 0];
    let count = 0;
    for (const i of border) {
      if (!near(data, i, mean, spread, 1)) continue;
      for (let c = 0; c < 3; c++) { sum[c] += data[i + c]; squares[c] += data[i + c] ** 2; }
      count++;
    }
    if (!count) return null;
    mean = sum.map(s => s / count);
    spread = squares.map((s, c) => Math.sqrt(Math.max(0, s / count - mean[c] ** 2)));
    share = count / border.length;
  }
  return share < 0.25 ? null : { mean, spread, share };
}
// Brightness may drift with shading, and drops in the shadow beside a book; the tint may not change.
function near(data, i, mean, spread, shade = 2) {
  const r = data[i] - mean[0], g = data[i + 1] - mean[1], b = data[i + 2] - mean[2];
  const light = (r + g + b) / 3, limit = clamp(3 * (spread[0] + spread[1] + spread[2]) / 3, 22, 48);
  return light <= limit && light >= -shade * limit && Math.abs(r - light) <= 11 && Math.abs(g - light) <= 11 && Math.abs(b - light) <= 11;
}

/** The photo turned so that a title reads left to right, with running totals for fast strip counts. */
function turned(image, surface, angle) {
  const { data, width, height } = image, cos = Math.cos(angle), sin = Math.sin(angle);
  const corners = [[0, 0], [width, 0], [0, height], [width, height]].map(([x, y]) => [x * cos + y * sin, -x * sin + y * cos]);
  const u0 = Math.floor(Math.min(...corners.map(c => c[0]))), v0 = Math.floor(Math.min(...corners.map(c => c[1])));
  const w = Math.ceil(Math.max(...corners.map(c => c[0]))) - u0, h = Math.ceil(Math.max(...corners.map(c => c[1]))) - v0;
  const row = w + 1, plain = new Int32Array(row * (h + 1)), inside = new Int32Array(row * (h + 1));
  const grey = new Uint8Array(w * h);
  for (let v = 0; v < h; v++) {
    for (let u = 0; u < w; u++) {
      const x = Math.round((u + u0) * cos - (v + v0) * sin), y = Math.round((u + u0) * sin + (v + v0) * cos);
      const within = x >= 0 && y >= 0 && x < width && y < height, i = (y * width + x) * 3;
      const at = (v + 1) * row + u + 1;
      if (within) grey[v * w + u] = (data[i] * 2 + data[i + 1] * 5 + data[i + 2]) >> 3;
      plain[at] = plain[at - 1] + plain[at - row] - plain[at - row - 1] + (within && near(data, i, surface.mean, surface.spread) ? 1 : 0);
      inside[at] = inside[at - 1] + inside[at - row] - inside[at - row - 1] + (within ? 1 : 0);
    }
  }
  const total = (table, a, b, c, d) => {
    a = clamp(Math.round(a), 0, w); c = clamp(Math.round(c), 0, w); b = clamp(Math.round(b), 0, h); d = clamp(Math.round(d), 0, h);
    return c <= a || d <= b ? 0 : table[d * row + c] - table[b * row + c] - table[d * row + a] + table[b * row + a];
  };
  return {
    w, h, grey,
    to: (x, y) => [x * cos + y * sin - u0, -x * sin + y * cos - v0],
    from: (u, v) => [(u + u0) * cos - (v + v0) * sin, (u + u0) * sin + (v + v0) * cos],
    /** The share of a rectangle that is surface, and the share of it that is inside the photo. */
    strip(a, b, c, d) {
      const area = Math.max(1, (Math.round(c) - Math.round(a)) * (Math.round(d) - Math.round(b))), photo = total(inside, a, b, c, d);
      return { plain: photo ? total(plain, a, b, c, d) / photo : 0, photo: photo / area };
    },
  };
}

/**
 * How much of a line is an edge. `same` is the share of its length where brightness steps the
 * same way across it, `any` the share where it steps at all. An illustration's outlines curve
 * away from a straight line, step both ways and rarely run the full length.
 */
function edge(frame, upright, at, from, to, step = 14) {
  const { grey, w, h } = frame;
  at = Math.round(at); from = Math.max(2, Math.round(from)); to = Math.min((upright ? h : w) - 2, Math.round(to));
  if (to - from < 8 || at < 3 || at >= (upright ? w : h) - 3) return { same: 0, any: 0 };
  let up = 0, down = 0;
  // A cover is rarely square to its title: over a long side its edge drifts a few pixels.
  const drift = clamp(Math.round((to - from) * 0.02), 1, 5);
  at = clamp(at, drift + 2, (upright ? w : h) - drift - 3);
  for (let k = from; k < to; k++) {
    let most = 0;
    for (let shift = -drift; shift <= drift; shift++) {
      const p = at + shift;
      const d = upright ? grey[k * w + p + 2] - grey[k * w + p - 2] : grey[(p + 2) * w + k] - grey[(p - 2) * w + k];
      if (Math.abs(d) > Math.abs(most)) most = d;
    }
    if (most >= step) up++; else if (most <= -step) down++;
  }
  return { same: Math.max(up, down) / (to - from), any: (up + down) / (to - from) };
}

// Top and bottom first: once a cover's height is known, a neighbour in the same row is seen to be beside it.
const sides = ['top', 'bottom', 'left', 'right'];

/**
 * One side of a cover, searched outward from the title as far as `limit` (another title, or the
 * photo's edge). Returns { at, sure }: where the edge is, and whether the surface was seen beyond it.
 */
function findSide(frame, side, title, box, limit) {
  const upright = side === 'left' || side === 'right', out = side === 'left' || side === 'top' ? -1 : 1;
  const [from, to] = upright ? [box.top, box.bottom] : [box.left, box.right];
  const size = upright ? frame.w : frame.h, start = Math.round(title[side]) + out, end = Math.round(clamp(limit ?? (out < 0 ? 0 : size), 0, size));
  const band = Math.max(3, Math.round(Math.max(frame.w, frame.h) * 0.006));
  const strip = (a, b) => (upright ? frame.strip(Math.min(a, b), from, Math.max(a, b), to) : frame.strip(from, Math.min(a, b), to, Math.max(a, b)));
  const score = at => strip(at + out, at + out * (1 + band)).plain - strip(at - out, at - out * (1 + band)).plain;
  let straight = null;
  for (let at = start; out < 0 ? at >= end : at <= end; at += out) {
    const beyond = strip(at + out, at + out * (1 + band)), within = strip(at - out, at - out * (1 + band));
    // Past the photo's own edge: the cover runs out of the picture.
    if (beyond.photo < 0.5) {
      if (within.plain < 0.5) return { at: at - out * Math.round(band / 2), sure: true };
      break;
    }
    const gain = beyond.plain - within.plain;
    if (gain >= 0.25) {
      // Settle on the sharpest position of this edge, a few pixels on.
      let pick = at, top = gain;
      for (let next = at + out; Math.abs(next - at) <= band + 1 && (out < 0 ? next >= end : next <= end); next += out) {
        const s = score(next);
        if (s > top) { top = s; pick = next; }
      }
      // A patch of an illustration can have the surface's colour, but its outline is not a straight line.
      if (edge(frame, upright, pick, from, to).any >= 0.5) {
        const seen = strip(pick + out, pick + out * (1 + band)).plain;
        if (top >= 0.45 && seen >= 0.5) return { at: pick, sure: seen >= 0.75 };
        // A cover lying at a slight angle to its title blurs both strips. Follow its edge line by line.
        const drift = clamp(Math.round((to - from) * 0.02), 2, 4);
        let lines = 0;
        for (let k = Math.round(from); k < Math.round(to); k++) {
          for (let shift = -drift; shift <= drift; shift++) {
            const p = pick + shift, far = [p + out, p + out * (1 + band)], close = [p - out, p - out * (1 + band)];
            const one = ([a, b]) => (upright ? frame.strip(Math.min(a, b), k, Math.max(a, b), k + 1) : frame.strip(k, Math.min(a, b), k + 1, Math.max(a, b))).plain;
            if (one(far) >= 0.75 && one(close) <= 0.35) { lines++; break; }
          }
        }
        if (top >= 0.4 && lines >= 0.85 * (Math.round(to) - Math.round(from))) return { at: pick, sure: true };
        // The surface can change beside a book (a fold catching the light, the edge of the bed): one clean
        // straight edge along the whole side, with some surface beyond it, is still the cover's edge.
        if (edge(frame, upright, pick, from, to).same >= 0.9) return { at: pick, sure: false };
      }
    }
    // Where two covers touch, the line between them is the straightest one: lettering and
    // illustrations make shorter ones. A glimpse of the surface beyond the line counts for it.
    const line = edge(frame, upright, at, from, to, 10).same + 0.5 * Math.max(0, gain);
    if (line >= 0.5 && (!straight || line > straight.line + 0.02)) straight = { at, last: at, line };
    // The same line is seen from a few positions either side of it: its place is the middle of them.
    else if (straight && at === straight.last + out && line >= straight.line - 0.02) straight.last = at;
  }
  if (straight) return { at: Math.round((straight.at + straight.last) / 2), sure: false };
  // Nothing to see between two titles: split the space between them.
  return limit === undefined ? null : { at: Math.round((title[side] + limit) / 2), sure: false };
}

/**
 * For each title place (centre x, y, length, height and reading angle, in photo pixels; or null),
 * the rectangle of its cover: centre x and y, width, height and angle, or null when it cannot be told.
 * `image` holds raw RGB bytes.
 */
export function findCovers(image, places) {
  const surface = surfaceColour(image);
  if (!surface) return places.map(() => null);
  const frames = new Map();
  const frameFor = angle => {
    // Covers laid out together mostly share a direction: one turned copy serves them all.
    const key = Math.round(angle * 180 / Math.PI);
    if (!frames.has(key)) frames.set(key, turned(image, surface, key * Math.PI / 180));
    return frames.get(key);
  };
  const usable = place => place && [place.x, place.y, place.length, place.height, place.angle].every(Number.isFinite) && place.length > 0 && place.height > 0;
  return places.map((place, index) => {
    if (!usable(place) || frames.size > 12 && !frames.has(Math.round(place.angle * 180 / Math.PI))) return null;
    const frame = frameFor(place.angle);
    const rect = other => {
      const [u, v] = frame.to(other.x, other.y);
      return { left: u - other.length / 2, right: u + other.length / 2, top: v - other.height / 2, bottom: v + other.height / 2 };
    };
    const title = rect(place), others = places.filter((other, i) => i !== index && usable(other)).map(rect);
    // Another title in the way: the edge lies before it.
    const stops = { left: [], right: [], top: [], bottom: [] };
    let box, found;
    for (let attempt = 0; attempt < 5; attempt++) {
      box = { ...title }; found = {};
      for (let round = 0; round < 6; round++) {
        const next = { ...box };
        for (const side of sides) {
          const upright = side === 'left' || side === 'right', out = side === 'left' || side === 'top' ? -1 : 1;
          let limit = stops[side].length ? (out < 0 ? Math.max(...stops[side]) : Math.min(...stops[side])) : undefined;
          for (const other of others) {
            const beside = upright ? other.bottom > next.top && other.top < next.bottom : other.right > next.left && other.left < next.right;
            const near = out < 0 ? other[upright ? 'right' : 'bottom'] : other[upright ? 'left' : 'top'];
            if (!beside || (out < 0 ? near > title[side] : near < title[side])) continue;
            limit = limit === undefined ? near : out < 0 ? Math.max(limit, near) : Math.min(limit, near);
          }
          found[side] = findSide(frame, side, title, next, limit);
          if (found[side]) next[side] = found[side].at;
        }
        const settled = sides.every(side => Math.abs(next[side] - box[side]) < 1.5);
        box = next;
        if (settled) break;
      }
      // The box took in a neighbour's title: it ran past the line between the two covers.
      const centre = r => [(r.left + r.right) / 2, (r.top + r.bottom) / 2], [mu, mv] = centre(title);
      const swallowed = others.filter(other => { const [u, v] = centre(other); return u > box.left && u < box.right && v > box.top && v < box.bottom; });
      if (!swallowed.length) break;
      for (const other of swallowed) {
        const [u, v] = centre(other), across = Math.abs(u - mu) / (box.right - box.left) >= Math.abs(v - mv) / (box.bottom - box.top);
        if (across) u < mu ? stops.left.push(Math.min(other.right, title.left)) : stops.right.push(Math.max(other.left, title.right));
        else v < mv ? stops.top.push(Math.min(other.bottom, title.top)) : stops.bottom.push(Math.max(other.top, title.bottom));
      }
    }
    if (!sides.every(side => found[side])) return null;
    const width = box.right - box.left, height = box.bottom - box.top;
    // A book cover: larger than its title, neither a strip nor most of the photo.
    if (width < place.length * 1.05 || height < place.height * 1.05 || height / width < 0.5 || height / width > 2.4 ||
        width * height > 0.6 * image.width * image.height) return null;
    const [x, y] = frame.from((box.left + box.right) / 2, (box.top + box.bottom) / 2);
    return { x, y, width, height, angle: Math.round(place.angle * 180 / Math.PI) * Math.PI / 180, sure: sides.every(side => found[side].sure) };
  });
}
