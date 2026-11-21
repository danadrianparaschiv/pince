import test from 'node:test';
import assert from 'node:assert/strict';
import { duplicateGroups, sameBook, within } from '../web/duplicates.js';
import { visibleBooks } from '../web/strings.js';

// Which books look like the same book: the rule behind the add-book warning, the edit warning
// and the bookshelf's "possible duplicates" filter. The titles here are invented.
const book = (title, authors = '', extra = {}) => ({ id: title, title, authors, isbn: '', ...extra });
const same = (a, b, options) => sameBook(book(...[a].flat()), book(...[b].flat()), options);

test('two spellings are within a number of edits; a swap of neighbours counts once', () => {
  assert.equal(within('arici', 'arici', 0), true);
  assert.equal(within('arici', 'aricii', 0), false);
  // A wrong, a missing and an extra letter.
  assert.deepEqual(
    [within('arici', 'arivi', 1), within('arici', 'arii', 1), within('arici', 'aricci', 1)],
    [true, true, true],
  );
  // Two swapped neighbours are one slip, not two.
  assert.equal(within('arici', 'airci', 1), true);
  assert.equal(within('arici', 'iraci', 1), false);
  assert.equal(within('arici', 'bursuc', 3), false);
  assert.equal(within('', 'ab', 2), true);
  assert.equal(within('abc', '', 2), false);
  // A long pair is compared in full, well past the first few letters.
  const long = 'o poveste foarte lunga despre un arici care a plecat la drum '.repeat(4);
  assert.equal(within(long, long.replace('drum', 'drun'), 1), true);
  assert.equal(within(long, long.replace('arici', 'bursuc'), 3), false);
});

test('a title that is a typo away is the same book; a different title is not', () => {
  assert(same('Aventurile unui arici', 'Aventurile unui arici'));
  // Case, accents, punctuation and spacing never matter.
  assert(same('Povești de iarnă', 'POVESTI  DE IARNA!'));
  assert(same('Desco-perim pădurea', 'Descoperim pădurea'));
  assert(same('Ariciul’s Book of Winter', 'Ariciuls book of winter'));
  // One or two wrong letters in a long title, as a hand or a camera makes them.
  assert(same('Aventurile unui arici', 'Aventurlie unui arici'));
  assert(same('Aventurile unui arici', 'Aventurile unui aricu'));
  assert(same('Marea enciclopedie a pădurii', 'Marea enciclopdie a paduri'));
  // The longer the title, the more it may differ: one letter under 9, two under 17, three beyond.
  assert(same('Ariciul', 'Ariciu'));
  assert(!same('Ariciul', 'Arici'));
  assert(same('Ariciul curios', 'Aricul curio'));
  assert(!same('Ariciul curios', 'Aricu curio'));
  assert(same('Ariciul curios din pădure', 'Aricul curio din padur'));
  assert(!same('Ariciul curios din pădure', 'Aricu curio din padur'));
  // A short title has to be the same title.
  assert(same('Casa', 'casa'));
  assert(!same('Casa', 'Masa'));
  // Different books stay different, however alike their subject.
  assert(!same('Ariciul la școală', 'Ariciul la mare'));
  assert(!same('Florile pădurii', 'Păsările pădurii'));
  // No title, no match.
  assert(!same('', ''));
  assert(!same('', 'Ariciul'));
  assert(!sameBook({ id: 'a' }, { id: 'b' }));
});

test('a volume number is never a typo of another volume', () => {
  assert(!same('Enciclopedia pădurii 2', 'Enciclopedia pădurii 3'));
  assert(!same('Enciclopedia pădurii 2', 'Enciclopedia pădurii 12'));
  assert(!same('Enciclopedia pădurii', 'Enciclopedia pădurii 2'));
  assert(!same('Enciclopedia pădurii vol2', 'Enciclopedia pădurii vol3'));
  assert(!same('Enciclopedia pădurii, vol. II', 'Enciclopedia pădurii, vol. III'));
  assert(!same('Enciclopedia pădurii IV', 'Enciclopedia pădurii VI'));
  // The same number on both sides leaves room for a typo elsewhere.
  assert(same('Enciclopedia pădurii 2', 'Enciclopedia padurri 2'));
  assert(same('Enciclopedia pădurii, vol. II', 'Enciclopdia pădurii vol II'));
});

test('authors must not contradict each other; a missing author agrees with anyone', () => {
  assert(same(['Ariciul curios', 'Ana Pop'], ['Ariciul curios', '']));
  assert(same(['Ariciul curios', ''], ['Ariciul curios', 'Ana Pop']));
  assert(same(['Ariciul curios', 'Ana Pop'], ['Aricul curios', 'A. Pop']));
  assert(!same(['Ariciul curios', 'Ana Pop'], ['Ariciul curios', 'Dan Ionescu']));
  // One shared author is enough, however the names are joined.
  assert(same(['Ariciul curios', 'Ana Pop & Dan Ionescu'], ['Ariciul curios', 'Ionescu, Dan']));
  assert(same(['Ariciul curios', 'Ana Pop și Dan Ionescu'], ['Ariciul curios', 'Dan Ionescu']));
  // A long surname may be a letter off; a short one may not.
  assert(same(['Ariciul curios', 'Dan Ionescu'], ['Ariciul curios', 'Dan Ionesco']));
  assert(!same(['Ariciul curios', 'Ana Pop'], ['Ariciul curios', 'Ana Pap']));
});

test('the same ISBN is the same book, whatever else is written', () => {
  const a = book('Ariciul curios', 'Ana Pop', { isbn: '978-0-00-000000-2' });
  assert(sameBook(a, book('Cu totul alt titlu', 'Dan Ionescu', { isbn: '9780000000002' })));
  assert(sameBook(book('X', '', { isbn: '0-00-000000-x' }), book('Y', '', { isbn: '000000000X' })));
  assert(!sameBook(a, book('Cu totul alt titlu', '', { isbn: '9780000000019' })));
  // A different ISBN does not hide a matching title: an edition may be entered twice.
  assert(sameBook(a, book('Ariciul curios', '', { isbn: '9780000000019' })));
});

test('only when asked, a title also matches one part of a longer title', () => {
  const pairs = [
    ['Micii naturaliști: Ariciul curios', 'Ariciul curios'],
    ['Ariciul curios (Micii naturaliști)', 'Aricul curios'],
    ['Enciclopedia celor mici - Viața pădurii', 'Viața pădurii'],
    ['Viața pădurii — o carte de citit și recitit', 'Viața pădurii'],
    ['Viața pădurii [ediție nouă]', 'Viața pădurii'],
  ];
  for (const [long, short] of pairs) {
    assert(same(long, short, { parts: true }), long);
    assert(same(short, long, { parts: true }), long);
    // A warning while adding a book uses the stricter rule.
    assert(!same(long, short), long);
  }
  // A longer title without such a break is another book of the series.
  assert(!same('Ariciul curios se dă cu sania', 'Ariciul curios', { parts: true }));
  assert(!same('Bravo, ariciul curios!', 'Ariciul curios', { parts: true }));
  // A part too short to mean anything matches nothing, and nor does a short whole title.
  assert(!same('Micii naturaliști: Arici', 'Arici', { parts: true }));
  assert(!same('Ariciul: povești de iarnă', 'Ariciul', { parts: true }));
  // Two books of one series share only the series name.
  assert(!same('Micii naturaliști: Ariciul curios', 'Micii naturaliști: Bursucul vesel', { parts: true }));
  // Numbers and authors still count.
  assert(!same('Micii naturaliști: Viața pădurii 2', 'Viața pădurii 3', { parts: true }));
  assert(
    !same(['Micii naturaliști: Ariciul curios', 'Ana Pop'], ['Ariciul curios', 'Dan Ionescu'], {
      parts: true,
    }),
  );
});

test('look-alikes form groups; a book that matches nothing is in none', () => {
  const books = [
    book('Ariciul curios din pădure'),
    book('Bursucul vesel'),
    book('Aricul curios din pădure'),
    // Alike only through the one in the middle: a chain is one group.
    book('Aricul curio din padu'),
    book('Micii naturaliști: Bursucul vesel'),
    book('Vulpea cea isteață', 'Ana Pop'),
    book('Vulpea cea isteață', 'Dan Ionescu'),
    book('Casa'),
    book(''),
    book(''),
  ];
  const groups = duplicateGroups(books);
  assert(!sameBook(books[0], books[3]));
  assert.deepEqual(
    [...groups],
    [
      ['Ariciul curios din pădure', 1],
      ['Bursucul vesel', 2],
      ['Aricul curios din pădure', 1],
      ['Aricul curio din padu', 1],
      ['Micii naturaliști: Bursucul vesel', 2],
    ],
  );
  // The same ISBN joins two books whatever their titles say.
  const coded = [
    book('Una', '', { isbn: '978-0-00-000000-2' }),
    book('Alta', '', { isbn: '9780000000002' }),
    book('A treia'),
  ];
  assert.deepEqual([...duplicateGroups(coded).keys()], ['Una', 'Alta']);
  assert.equal(duplicateGroups([]).size, 0);
  assert.equal(duplicateGroups([book('Singură')]).size, 0);
});

test('groups are worked out again only when a title, an author or an ISBN changes', () => {
  const books = [book('Ariciul curios'), book('Aricul curios'), book('Bursucul vesel')];
  const first = duplicateGroups(books);
  assert.equal(first.size, 2);
  // Reading state, a note or a new list of the same books change nothing.
  books[0].read = true;
  assert.equal(duplicateGroups([...books]), first);
  // A corrected title is noticed even when the book is changed in place.
  books[1].title = 'Vulpea cea isteață';
  assert.equal(duplicateGroups(books).size, 0);
  books[2].authors = 'Ana Pop';
  books[1].title = 'Bursucul vessel';
  books[1].authors = 'Dan Ionescu';
  assert.equal(duplicateGroups(books).size, 0);
  books[1].authors = '';
  assert.deepEqual([...duplicateGroups(books).keys()], ['Aricul curios', 'Bursucul vesel']);
  books[0].isbn = '1';
  books[2].isbn = '1';
  assert.equal(duplicateGroups(books).size, 3);
  assert.equal(duplicateGroups(books.slice(1)).size, 2);
});

test('a full library is looked over quickly', () => {
  const words =
    'ariciul bursucul vulpea curios vesel isteata padurea iarna povesti aventurile enciclopedia mare mica atlasul drumul muntele raul casa'.split(
      ' ',
    );
  let seed = 5;
  const next = (n) => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
  const books = Array.from({ length: 5000 }, (_, i) =>
    book(
      Array.from({ length: 2 + next(4) }, () => words[next(words.length)]).join(' ') + ' ' + i,
      i % 3 ? 'Ana Pop' : '',
      { id: 'b' + i },
    ),
  );
  books.push(book('Enciclopedia pădurii de iarnă'), book('Enciclopdia pădurii de iarnă'));
  const started = performance.now();
  const groups = duplicateGroups(books);
  // About half a second on a laptop; the limit only catches a return to comparing every pair in full.
  assert(performance.now() - started < 5000);
  // Each numbered title is its own book; only the planted pair is found.
  assert.deepEqual([...groups.keys()], ['Enciclopedia pădurii de iarnă', 'Enciclopdia pădurii de iarnă']);
});

test('the bookshelf shows only look-alikes, side by side, and combines with search and filters', () => {
  const everything = { search: '', read: '', fav: false, cover: '', shelf: '', sort: 'tAsc' };
  const shelf = (title, extra = {}) => ({
    ...book(title),
    cover: null,
    shelfPhoto: null,
    read: false,
    favorite: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  });
  const books = [
    shelf('Zâna pădurii'),
    shelf('Bursucul vesel', { read: true }),
    shelf('Micii naturaliști: Bursucul vesel'),
    shelf('Ariciul curios'),
    shelf('Vulpea cea isteață', { createdAt: '2026-03-01T00:00:00.000Z' }),
    shelf('Aricul curios', { favorite: true }),
    shelf('Bursucul vessel', { createdAt: '2026-02-01T00:00:00.000Z' }),
  ];
  const titles = (filters) => visibleBooks(books, { ...everything, ...filters }, 'ro').map((b) => b.title);
  assert.equal(titles({}).length, 7);
  // Each group stands where its first book would; "Micii naturaliști…" joins its twins under B.
  assert.deepEqual(titles({ dupes: true }), [
    'Ariciul curios',
    'Aricul curios',
    'Bursucul vesel',
    'Bursucul vessel',
    'Micii naturaliști: Bursucul vesel',
  ]);
  assert.deepEqual(titles({ dupes: true, sort: 'tDesc' }), [
    'Micii naturaliști: Bursucul vesel',
    'Bursucul vessel',
    'Bursucul vesel',
    'Aricul curios',
    'Ariciul curios',
  ]);
  assert.deepEqual(titles({ dupes: true, sort: 'newest' }).slice(0, 3), [
    'Bursucul vessel',
    'Bursucul vesel',
    'Micii naturaliști: Bursucul vesel',
  ]);
  // Look-alikes are found among all the books, then narrowed: a twin may be shown alone.
  assert.deepEqual(titles({ dupes: true, search: 'bursucul' }).length, 3);
  assert.deepEqual(titles({ dupes: true, read: 'read' }), ['Bursucul vesel']);
  assert.deepEqual(titles({ dupes: true, fav: true }), ['Aricul curios']);
  assert.deepEqual(titles({ dupes: true, search: 'zâna' }), []);
});
