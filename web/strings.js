const labels = {
  brand: ['Pince', 'Pince'],
  skip: ['Sari la conținut', 'Skip to content'],
  welcome: ['Bine ai revenit.', 'Welcome back.'],
  signinHint: ['Intră în biblioteca familiei.', 'Sign in to your family library.'],
  signin: ['Intră în bibliotecă', 'Sign in'],
  setup: ['Configurare', 'Set-up'],
  setupHint: [
    'Prima pornire? Deschide linkul de configurare afișat în terminal de „npm start” pentru a-ți alege parolele.',
    'First start? Open the set-up link that “npm start” printed in the terminal to choose your passwords.',
  ],
  username: ['Nume de utilizator', 'Username'],
  password: ['Parolă', 'Password'],
  show: ['Arată parola', 'Show password'],
  hide: ['Ascunde parola', 'Hide password'],
  lang: ['Limba interfeței', 'Interface language'],
  shelf: ['Raftul meu', 'My bookshelf'],
  catalog: ['Bibliotecă', 'Library'],
  admin: ['Pentru părinte', 'Parent settings'],
  logout: ['Ieși din cont', 'Sign out'],
  add: ['Adaugă o carte', 'Add a book'],
  search: ['Caută după titlu sau autor', 'Search by title or author'],
  all: ['Toate', 'All books'],
  favorite: ['Favorită', 'Favorite'],
  favorites: ['Favorite', 'Favorites'],
  read: ['Citită', 'Read'],
  unread: ['Necitită', 'Not read'],
  withCover: ['Cu copertă', 'With cover'],
  withoutCover: ['Fără copertă', 'Without cover'],
  shelfFilter: ['Filtrează după raft', 'Filter by shelf'],
  allShelves: ['Toate rafturile', 'All shelves'],
  noShelf: ['Fără fotografie de raft', 'No shelf photo'],
  clear: ['Șterge filtrele', 'Clear filters'],
  sort: ['Sortează cărțile', 'Sort books'],
  tAsc: ['Titlu · A–Z', 'Title · A–Z'],
  tDesc: ['Titlu · Z–A', 'Title · Z–A'],
  aAsc: ['Autor · A–Z', 'Author · A–Z'],
  aDesc: ['Autor · Z–A', 'Author · Z–A'],
  newest: ['Adăugate recent', 'Newest first'],
  oldest: ['Adăugate întâi', 'Oldest first'],
  emptyTitle: ['Ce carte pui prima pe raft?', 'Which book goes first?'],
  emptyHint: [
    'Scrie titlul sau pornește de la o fotografie a copertei ori a raftului.',
    'Enter a title or start with a photo of a cover or shelf.',
  ],
  first: ['Adaugă prima ta carte', 'Add your first book'],
  nothing: ['Nicio carte găsită', 'No books found'],
  trySearch: ['Încearcă un alt titlu sau șterge filtrele.', 'Try another title or clear the filters.'],
  back: ['Înapoi la bibliotecă', 'Back to library'],
  edit: ['Modifică datele cărții', 'Edit book details'],
  share: ['Distribuie cartea', 'Share book'],
  remove: ['Șterge cartea', 'Delete book'],
  cover: ['Copertă', 'Cover'],
  title: ['Titlu', 'Title'],
  authors: ['Autor sau autori', 'Author or authors'],
  publisher: ['Editură', 'Publisher'],
  publishedDate: ['Data publicării', 'Publication date'],
  dateFormat: ['AAAA, AAAA-LL, AAAA-LL-ZZ', 'YYYY, YYYY-MM, YYYY-MM-DD'],
  invalidPublishedDate: ['Introdu o dată de publicare validă (AAAA, AAAA-LL sau AAAA-LL-ZZ).', 'Enter a valid publication year, month or full date (YYYY-MM-DD).'],
  chooseCover: ['Înlocuiește coperta', 'Replace cover'],
  removeCover: ['Elimină coperta', 'Remove cover'],
  coverReady: ['Coperta nouă este pregătită.', 'New cover is ready.'],
  coverChoices: ['Alege coperta', 'Choose a cover'],
  coverSelected: ['Selectată', 'Selected'],
  coverUploaded: ['Coperta ta', 'Your cover'],
  coverWeb: ['Copertă de pe web', 'Web cover'],
  coverSearching: ['Căutăm până la două coperte. Poți închide pagina.', 'Looking for up to two covers. You can close this page.'],
  coverEmpty: ['Nu am găsit coperte potrivite. Poți adăuga o fotografie.', 'No matching covers found. You can upload a photo.'],
  coverFailed: ['Căutarea copertelor nu a reușit. Poți încerca din nou.', 'Cover lookup could not finish. You can try again.'],
  coverHint: ['Verifică ediția și alege coperta preferată. Alegerea se păstrează când salvezi.', 'Check the edition and choose your favorite cover. Your choice is kept when you save.'],
  findCovers: ['Caută coperte pe web', 'Find covers online'],
  coverSource: ['Sursa: Open Library', 'Source: Open Library'],
  googleCoverSource: ['Sursa: Google Books', 'Source: Google Books'],
  coverFrom: ['Sursa:', 'Source:'],
  coverPartial: ['Unele surse de coperte nu au răspuns. Sugestiile găsite sunt disponibile.', 'Some cover sources did not respond. The covers found are available.'],
  save: ['Salvează', 'Save'],
  cancel: ['Anulează', 'Cancel'],
  close: ['Închide', 'Close'],
  note: ['Notița mea', 'My reading note'],
  private: ['Vizibilă doar familiei', 'Only visible to your family'],
  saveNote: ['Salvează notița', 'Save note'],
  noteSaved: ['Notiță salvată.', 'Note saved.'],
  saved: ['Modificări salvate.', 'Changes saved.'],
  unsaved: ['Modificări nesalvate', 'Unsaved changes'],
  notePlaceholder: [
    'Ce vrei să îți amintești despre carte?',
    'What would you like to remember about this book?',
  ],
  markRead: ['Marchează ca citită', 'Mark as read'],
  markUnread: ['Marchează ca necitită', 'Mark as not read'],
  addFav: ['Adaugă la favorite', 'Add to favorites'],
  dropFav: ['Elimină din favorite', 'Remove from favorites'],
  shareInfo: ['Oricine are acest link poate vedea cartea.', 'Anyone with this link can view this book.'],
  link: ['Link public', 'Public link'],
  copy: ['Copiază linkul', 'Copy link'],
  copied: ['Link copiat.', 'Link copied.'],
  manualCopy: ['Selectează și copiază linkul.', 'Select and copy the link.'],
  publicPreview: ['Deschide pagina publică', 'Open public page'],
  deleteConfirm: [
    'Va fi ștearsă din bibliotecă, iar linkul ei public nu va mai funcționa.',
    'This book will be removed from the library and its public link will stop working.',
  ],
  deleted: ['Carte ștearsă.', 'Book deleted.'],
  unavailable: ['Cartea nu este disponibilă', 'Book unavailable'],
  gone: ['Verifică linkul sau cere unul nou.', 'Check the link or ask for a new one.'],
  loadError: ['Biblioteca nu s-a putut deschide', 'The library could not be opened'],
  retry: ['Încearcă din nou', 'Try again'],
  loading: ['Se încarcă…', 'Loading…'],
  conflict: ['Cartea a fost modificată', 'The book has changed'],
  conflictHint: [
    'Alege ce păstrezi pentru câmpurile modificate.',
    'Choose which version to keep for the changed fields.',
  ],
  newValue: ['Versiunea salvată', 'Saved version'],
  myValue: ['Modificarea ta', 'Your change'],
  keepMine: ['Păstrează modificarea mea', 'Keep my change'],
  keepNew: ['Folosește versiunea salvată', 'Use saved version'],
  blank: ['Gol', 'Empty'],
  yes: ['Da', 'Yes'],
  no: ['Nu', 'No'],
  added: ['Adăugată', 'Added'],
  account: ['Contul familiei', 'Family account'],
  confirm: ['Confirmă', 'Confirm'],
  editSaved: ['Datele cărții au fost salvate.', 'Book details saved.'],
  deleteStale: [
    'Datele cărții s-au schimbat. Verifică-le înainte de ștergere.',
    'The book has changed. Review the details before deleting it.',
  ],
  reviewCover: ['Copertă selectată', 'Selected cover'],
  error: ['Ceva nu a funcționat. Încearcă din nou.', 'Something went wrong. Please try again.'],
  invalid: ['Verifică datele introduse.', 'Check the details you entered.'],
  credentials: [
    'Numele de utilizator sau parola nu este corectă.',
    'The username or password is incorrect.',
  ],
  throttle: [
    'Prea multe încercări. Încearcă din nou mai târziu.',
    'Too many attempts. Try again later.',
  ],
  unauthenticated: [
    'Sesiunea a expirat. Autentifică-te din nou.',
    'Your session has expired. Sign in again.',
  ],
  forbidden: ['Contul tău nu are acces la această acțiune.', 'Your account cannot perform this action.'],
  tooLarge: [
    'Fișierul este prea mare. Limita este de 10 MB.',
    'This file is too large. The limit is 10 MB.',
  ],
  missing: ['Cartea nu mai este disponibilă.', 'This book is no longer available.'],
  storage: [
    'Datele nu au putut fi salvate. Încearcă din nou.',
    'Your changes could not be saved. Try again.',
  ],
  libraryFull: ['Biblioteca a atins limita de stocare.', 'The library has reached its storage limit.'],
  invalidImage: [
    'Alege o imagine JPEG, PNG sau WebP validă de maximum 10 MB.',
    'Choose a valid JPEG, PNG, or WebP image up to 10 MB.',
  ],
  duplicate: ['Este posibil să ai deja această carte.', 'This book may already be in your library.'],
  saveAnyway: ['Salvează oricum', 'Save anyway'],
  more: ['Mai multe opțiuni', 'More options'],
  foot: ['Pince · biblioteca familiei', 'Pince · a family library'],
  shelfPhoto: ['Fotografia raftului', 'Shelf photo'],
  shelfPhotoHelp: [
    'Fotografia din care a fost adăugată cartea. Chenarul arată unde îi apare titlul.',
    'The photo this book was added from. The outline shows where its title appears.',
  ],
  shelfPhotoPlain: ['Fotografia din care a fost adăugată cartea.', 'The photo this book was added from.'],
  shelfPhotoGone: ['Fotografia raftului nu mai este disponibilă.', 'The shelf photo is no longer available.'],
  shelfPhotoOpen: ['Deschide la mărime completă', 'Open full size'],
  shelfPhotoAlt: ['Fotografia raftului de cărți', 'Photo of the bookshelf'],
  selectBooks: ['Selectează cărți', 'Select books'],
  selectAll: ['Selectează tot', 'Select all'],
  clearSelection: ['Deselectează tot', 'Clear selection'],
  deleteSelected: ['Șterge selecția', 'Delete selected'],
  doneSelecting: ['Gata', 'Done'],
  selection: ['Selecție de cărți', 'Book selection'],
  pages: ['Pagini', 'Pages'],
  prevPage: ['Pagina anterioară', 'Previous page'],
  nextPage: ['Pagina următoare', 'Next page'],
  bulkDeleteTitle: ['Șterge cărțile selectate', 'Delete selected books'],
  bulkDeleteConfirm: [
    'Vor fi șterse definitiv din bibliotecă, împreună cu notițele și copertele lor, iar linkurile publice nu vor mai funcționa. Dacă le-ai putea vrea înapoi, descarcă mai întâi o copie de siguranță din „Pentru părinte”.',
    'They will be permanently removed from the library with their notes and covers, and their public links will stop working. If you might want them back, download a backup from Parent settings first.',
  ],
  deleteStopped: [
    'Ștergerea s-a oprit înainte de final. Cărțile rămase sunt încă în bibliotecă.',
    'Deleting stopped before it finished. The remaining books are still in the library.',
  ],
  lentOut: ['Împrumutate', 'Lent out'],
  lend: ['Împrumută cartea', 'Lend this book'],
  lentToField: ['Cui i-ai dat-o?', 'Who has it?'],
  lentAtField: ['De când', 'Since'],
  lendHint: ['Notează cine are cartea, ca să știi de unde s-o ceri înapoi.', 'Note who has the book, so you know where to ask for it.'],
  lendSave: ['Notează împrumutul', 'Note the loan'],
  lentSaved: ['Împrumut notat.', 'Loan noted.'],
  returned: ['S-a întors acasă', 'It is back home'],
  returnedSaved: ['Cartea este din nou acasă.', 'The book is back home.'],
  finishedAtField: ['Terminată pe', 'Finished on'],
  ratingField: ['Cât ți-a plăcut?', 'How did you like it?'],
  finished: ['Terminate recent', 'Recently finished'],
  wishlist: ['Lista de dorințe', 'Wishlist'],
  wishAdd: ['Adaugă o dorință', 'Add a wish'],
  wishEmptyTitle: ['Ce carte îți dorești?', 'Which book do you wish for?'],
  wishEmptyHint: [
    'Pune aici cărțile pe care le vrei, dar nu le ai încă. Când una ajunge acasă, o muți pe raft.',
    'Keep the books you want but do not have yet here. When one arrives, move it to the shelf.',
  ],
  wantedField: ['Pe lista de dorințe', 'On the wishlist'],
  gotIt: ['O avem acum', 'We have it now'],
  gotItSaved: ['Cartea a ajuns pe raft.', 'The book is now on the shelf.'],
  wishShared: ['Lista noastră de dorințe', 'Our wishlist'],
  wishSharedHint: ['Cărți pe care ni le dorim.', 'Books we would love to have.'],
  wishSharedEmpty: ['Lista este goală deocamdată.', 'The list is empty for now.'],
  wishUnavailable: ['Lista nu este disponibilă', 'This list is not available'],
};
const day = (value, lang) => {
  const date = new Date(value + 'T12:00:00');
  return Number.isNaN(date.getTime()) ? ''
    : new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'ro-RO', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
};
/** "Lent to Mara · since 30 Sept 2026", or without the day when there is none. */
export const lentLabel = (name, since, lang) =>
  [(lang === 'en' ? 'Lent to ' : 'Împrumutată: ') + name, since && (lang === 'en' ? 'since ' : 'din ') + day(since, lang)]
    .filter(Boolean).join(' · ');
export const ratingLabel = (n, lang) => (lang === 'en' ? `${n} of 5` : `${n} din 5`);
/** How many books were finished in a calendar year, by the day the reader gave. */
export const finishedIn = (books, year) => books.filter((b) => String(b.finishedAt || '').startsWith(year + '-')).length;
export const finishedLabel = (n, year, lang) =>
  lang === 'en' ? `${n} finished in ${year}` : `${n} ${n === 1 ? 'terminată' : 'terminate'} în ${year}`;
/** The day on the reader's own clock, as the library stores days. */
export const localDay = (now = new Date()) =>
  [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
export const pageSize = 24;
/** One page of a list; an out-of-range page number lands on the nearest real page. */
export function pageOf(items, page, size = pageSize) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const index = Math.min(Math.max(0, Math.trunc(page) || 0), pages - 1);
  const start = index * size;
  return { index, pages, from: items.length ? start + 1 : 0, to: Math.min(items.length, start + size),
    items: items.slice(start, start + size) };
}
export const pageLabel = (page, pages, lang) => (lang === 'en' ? `Page ${page} of ${pages}` : `Pagina ${page} din ${pages}`);
export const rangeLabel = (from, to, total, lang) => `${from}–${to} ${lang === 'en' ? 'of' : 'din'} ${total}`;
export const selectedCount = (n, lang) =>
  lang === 'en' ? `${n} selected` : `${countBooks(n, lang)} ${n === 1 ? 'selectată' : 'selectate'}`;
export const deleteCount = (n, lang) => (lang === 'en' ? 'Delete ' : 'Șterge ') + countBooks(n, lang);
export const deletingProgress = (done, total, lang) =>
  lang === 'en' ? `Deleting books… ${done} of ${total}` : `Se șterg cărțile… ${done} din ${total}`;
export const deletedMany = (n, lang) =>
  countBooks(n, lang) + (lang === 'en' ? ' deleted.' : n === 1 ? ' ștearsă.' : ' șterse.');
export const keptChanged = (n, lang) =>
  countBooks(n, lang) + (lang === 'en' ? ` changed in the meantime and ${n === 1 ? 'was' : 'were'} kept.`
    : n === 1 ? ' s-a schimbat între timp și a fost păstrată.' : ' s-au schimbat între timp și au fost păstrate.');
export const andMore = (n, lang) => (lang === 'en' ? `and ${n} more` : `și încă ${n}`);
export const tr = (key, lang) => (labels[key] || labels.error)[lang === 'ro' ? 0 : 1];
export const hasMessage = (key) => Object.hasOwn(labels, key);
export function countBooks(n, lang) {
  if (lang === 'en') return `${n} ${n === 1 ? 'book' : 'books'}`;
  return `${n} ${n === 1 ? 'carte' : n === 0 || (n % 100 >= 1 && n % 100 <= 19) ? 'cărți' : 'de cărți'}`;
}
export function localeChoice(saved, browserLanguages) {
  if (saved === 'ro' || saved === 'en') return saved;
  for (const preference of browserLanguages || []) {
    const language = preference.toLowerCase().split('-')[0];
    if (language === 'ro' || language === 'en') return language;
  }
  return 'ro';
}
export const fold = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();
/**
 * The shelf photos that still have books, oldest first and numbered from 1.
 * A shelf has no name: it is the photo its books were scanned from, dated by its first book.
 */
export function shelfChoices(books) {
  const shelves = new Map();
  for (const b of books) {
    const id = b.shelfPhoto?.id;
    if (!id) continue;
    const shelf = shelves.get(id) || { id, count: 0, since: '' };
    const at = String(b.createdAt || '');
    if (at && (!shelf.since || at < shelf.since)) shelf.since = at;
    shelf.count++;
    shelves.set(id, shelf);
  }
  return [...shelves.values()]
    .sort((a, b) => a.since.localeCompare(b.since) || a.id.localeCompare(b.id))
    .map((shelf, index) => ({ ...shelf, number: index + 1 }));
}
export function shelfLabel(shelf, lang) {
  const day = new Date(shelf.since);
  const date = Number.isNaN(day.getTime()) ? ''
    : new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'ro-RO', { day: 'numeric', month: 'short' }).format(day);
  return [(lang === 'en' ? 'Shelf ' : 'Raftul ') + shelf.number, date, countBooks(shelf.count, lang)].filter(Boolean).join(' · ');
}
export function visibleBooks(books, filters, lang) {
  const term = fold(filters.search),
    collator = new Intl.Collator(lang === 'ro' ? 'ro-RO' : 'en', {
      sensitivity: 'variant',
      numeric: true,
    });
  const sort = filters.sort;
  const result = books.filter(
    (b) =>
      (!filters.fav || b.favorite) &&
      (!filters.read || b.read === (filters.read === 'read')) &&
      (!filters.cover || !!b.cover === (filters.cover === 'with')) &&
      (!filters.lent || !!b.lentTo) &&
      (!filters.shelf || (filters.shelf === 'none' ? !b.shelfPhoto : b.shelfPhoto?.id === filters.shelf)) &&
      (!term || fold(b.title).includes(term) || fold(b.authors).includes(term)),
  );
  return result.sort((a, b) => {
    let order;
    if (sort[0] === 'a') {
      if (!a.authors !== !b.authors) return a.authors ? -1 : 1;
      order = collator.compare(a.authors || '', b.authors || '') * (sort === 'aAsc' ? 1 : -1);
    } else if (sort === 'finished') {
      // Latest finished first; books with no finished day follow, by title.
      if (!a.finishedAt !== !b.finishedAt) return a.finishedAt ? -1 : 1;
      order = String(b.finishedAt || '').localeCompare(String(a.finishedAt || ''));
    } else if (sort === 'newest' || sort === 'oldest') {
      order = String(a.createdAt).localeCompare(String(b.createdAt)) * (sort === 'oldest' ? 1 : -1);
    } else {
      order = collator.compare(a.title, b.title) * (sort === 'tDesc' ? -1 : 1);
    }
    return order || collator.compare(a.title, b.title) || String(a.id).localeCompare(String(b.id));
  });
}
