// Which books look like the same book. Pure functions, shared by the add-book screen, the edit
// form and the bookshelf's "possible duplicates" filter, so that they cannot disagree.
//
// Family books rarely carry an ISBN, and a second entry of the same book is usually a typo or a
// spine read slightly differently. So titles are compared with a few letters of tolerance.

const plain = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const surnames = (value) =>
  String(value ?? '')
    .split(/,|&|•|;| și | and /)
    .map((name) => plain(name).split(' ').pop())
    .filter(Boolean);
const cleanIsbn = (value) =>
  String(value ?? '')
    .replace(/[\s-]/g, '')
    .toUpperCase();
// A volume number, in digits or as a Roman numeral up to 39, is never a typo of another one.
const numbers = (text) => (text.match(/\p{N}+|\b(?=[ivx])x{0,3}(?:ix|iv|v?i{0,3})\b/gu) || []).join(' ');
/** How many letters two titles of this length may differ by. Short titles must be identical. */
const allowed = (length) => (length < 5 ? 0 : length < 9 ? 1 : length < 17 ? 2 : 3);

/**
 * Whether two strings are within `most` edits of each other. A wrong, missing or extra letter
 * counts once, and so does a swap of two neighbouring letters. Stops as soon as it cannot be.
 */
export function within(a, b, most) {
  if (a === b) return true;
  const m = a.length,
    n = b.length;
  if (!most || Math.abs(m - n) > most) return false;
  if (rows[0].length <= n + 1) rows = rows.map(() => new Int32Array(n + 64));
  // Only the cells within `most` of the diagonal can stay under the limit; the rest count as far.
  let [before, prior, next] = rows;
  for (let j = 0; j <= Math.min(n, most + 1); j++) prior[j] = j <= most ? j : far;
  for (let i = 1; i <= m; i++) {
    const from = Math.max(1, i - most),
      to = Math.min(n, i + most);
    let best = (next[from - 1] = from === 1 ? i : far);
    for (let j = from; j <= to; j++) {
      let cost = Math.min(prior[j] + 1, next[j - 1] + 1, prior[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cost = Math.min(cost, before[j - 2] + 1);
      next[j] = cost;
      if (cost < best) best = cost;
    }
    if (best > most) return false;
    if (to < n) next[to + 1] = far;
    [before, prior, next] = [prior, next, before];
  }
  return prior[n] <= most;
}
const far = 1 << 20;
let rows = [new Int32Array(128), new Int32Array(128), new Int32Array(128)];

const piece = (text) => {
  const words = plain(text);
  return { key: words.replace(/ /g, ''), numbers: numbers(words) };
};
// Books are read far more often than they change, so each book's comparable form is kept until
// one of the fields it was made from changes.
const kept = new WeakMap();
function prepare(book) {
  const old = kept.get(book);
  if (old && old.title === book.title && old.authors === book.authors && old.isbn === book.isbn) return old;
  const title = String(book.title ?? ''),
    full = piece(title);
  const made = {
    title: book.title,
    authors: book.authors,
    isbn: book.isbn,
    code: cleanIsbn(book.isbn),
    full,
    // "Series: Title", "Title (Series)" and "Title - subtitle" each name the book by one part.
    // A part too short to mean much on its own is left out.
    parts: title
      .split(/\s*[:–—()[\]]\s*|\s+-\s+/)
      .map(piece)
      .filter((part) => part.key.length >= 8 && part.key !== full.key),
    surnames: surnames(book.authors),
  };
  kept.set(book, made);
  return made;
}
const alike = (x, y) =>
  !!x.key && !!y.key && x.numbers === y.numbers && within(x.key, y.key, allowed(Math.max(x.key.length, y.key.length)));
// Spines often show no author, so a missing author agrees with anyone.
const authorsAgree = (a, b) =>
  !a.surnames.length ||
  !b.surnames.length ||
  a.surnames.some((mine) => b.surnames.some((theirs) => mine === theirs || (mine.length >= 5 && within(mine, theirs, 1))));
function samePrepared(a, b, parts) {
  if (a.code && a.code === b.code) return true;
  const title =
    alike(a.full, b.full) ||
    (parts &&
      ((a.full.key.length >= 8 && b.parts.some((part) => alike(a.full, part))) ||
        (b.full.key.length >= 8 && a.parts.some((part) => alike(b.full, part)))));
  return title && authorsAgree(a, b);
}

/**
 * Whether two books are probably the same one: the same ISBN, or titles that differ by no more
 * than a typo, with authors that do not contradict each other. With `parts`, a title also
 * matches one part of a longer title, such as the title without its series name. That finds more
 * and is wrong more often, so it is used for looking over the bookshelf, not for warnings.
 */
export function sameBook(a, b, { parts = false } = {}) {
  return samePrepared(prepare(a), prepare(b), parts);
}

let last = { books: [], groups: new Map() };
/**
 * The groups of probable duplicates among these books, as a map from book id to group number.
 * Books that match nothing are absent. Matches chain: if A is like B and B is like C, the three
 * are one group. Worked out again only when a title, an author or an ISBN changes.
 */
export function duplicateGroups(books) {
  const ready = books.map(prepare);
  if (ready.length === last.books.length && ready.every((book, i) => book === last.books[i])) return last.groups;
  const leader = ready.map((_, i) => i);
  const find = (i) => {
    while (leader[i] !== i) i = leader[i] = leader[leader[i]];
    return i;
  };
  const join = (i, j) => {
    leader[find(i)] = find(j);
  };
  const codes = new Map();
  ready.forEach((book, i) => {
    if (!book.code) return;
    if (codes.has(book.code)) join(i, codes.get(book.code));
    else codes.set(book.code, i);
  });
  // Every title and every part of a title, shortest first: only neighbours in length can match.
  const entries = [];
  ready.forEach((book, i) => {
    if (book.full.key) entries.push({ i, text: book.full, whole: true });
    for (const part of book.parts) entries.push({ i, text: part, whole: false });
  });
  entries.sort((a, b) => a.text.key.length - b.text.key.length);
  for (let x = 0; x < entries.length; x++) {
    const a = entries[x];
    for (let y = x + 1; y < entries.length; y++) {
      const b = entries[y];
      if (b.text.key.length - a.text.key.length > allowed(b.text.key.length)) break;
      if (a.i === b.i || !(a.whole || b.whole) || find(a.i) === find(b.i)) continue;
      // A whole title may match a part only when it is long enough to mean something.
      if (a.whole !== b.whole && (a.whole ? a : b).text.key.length < 8) continue;
      if (alike(a.text, b.text) && authorsAgree(ready[a.i], ready[b.i])) join(a.i, b.i);
    }
  }
  const sizes = new Map();
  ready.forEach((_, i) => sizes.set(find(i), (sizes.get(find(i)) || 0) + 1));
  const groups = new Map(),
    numbered = new Map();
  ready.forEach((_, i) => {
    const root = find(i);
    if (sizes.get(root) < 2) return;
    if (!numbered.has(root)) numbered.set(root, numbered.size + 1);
    groups.set(books[i].id, numbered.get(root));
  });
  last = { books: ready, groups };
  return groups;
}
