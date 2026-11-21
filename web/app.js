import { icon } from './icons.js';
import { duplicateGroups, sameBook } from './duplicates.js';
import { tr, hasMessage, localeChoice, countBooks, visibleBooks, shelfChoices, shelfLabel, pageOf, pageLabel, rangeLabel, selectedCount,
  deleteCount, deletingProgress, deletedMany, keptChanged, andMore, lentLabel, ratingLabel, finishedIn, finishedLabel, localDay } from './strings.js';

const main = document.querySelector('#main');
const header = document.querySelector('#header');
const modal = document.querySelector('#dialog');
const toast = document.querySelector('#notice');
const t = (key) => tr(key, state.lang);
const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const attr = esc;
const defaults = () => ({ search: '', read: '', fav: false, cover: '', shelf: '', lent: false, dupes: false, sort: 'tAsc' });
// The shelf and the wishlist are the same list page over two halves of the library.
const listPage = () => state.page === 'catalog' || state.page === 'wishlist';
const wishing = () => state.page === 'wishlist';
const listed = () => state.books.filter((b) => !!b.wanted === wishing());
// The wishlist only searches and sorts; a filter left on for the shelf does not hide wishes.
const listFilters = () =>
  wishing()
    ? { ...defaults(), search: state.filters.search, sort: state.filters.sort === 'finished' ? 'tAsc' : state.filters.sort }
    : state.filters;
const isToken = (value) => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
function storedLang() {
  try {
    return localStorage.getItem('library-language');
  } catch {
    return null;
  }
}
const state = {
  user: null,
  lang: localeChoice(storedLang(), navigator.languages),
  books: [],
  filters: defaults(),
  pageIndex: 0,
  // null outside selection mode; otherwise the ids picked for deletion, across pages and filters.
  picked: null,
  book: null,
  // The shared wishlist a signed-out visitor is looking at.
  wishes: null,
  page: '',
  widget: null,
  modal: null,
  note: null,
  catalogY: 0,
  epoch: 0,
};
let toastTimer,
  loginDraft = { username: '', password: '', visible: false, error: '' },
  sessionEpoch = 0;
// A library on your own computer is set up through a one-time link whose token follows the #,
// a part of the address the browser sends nowhere. It is taken out of the address bar at once
// and kept for this tab only, so that reloading the set-up screen does not lose it.
const localHost = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
let setupToken = '',
  setupPending = false;
function rememberSetup(token) {
  setupToken = token;
  try {
    if (token) sessionStorage.setItem('library-setup', token);
    else sessionStorage.removeItem('library-setup');
  } catch {
    /* Private browsing can disable storage. */
  }
}
if (location.pathname.replace(/\/$/, '') === '/setup') {
  if (location.hash.length > 1) {
    rememberSetup(location.hash.slice(1));
    history.replaceState({}, '', '/setup');
  } else {
    try {
      setupToken = sessionStorage.getItem('library-setup') || '';
    } catch {
      /* Without storage a reload needs the link again. */
    }
  }
}
const errorText = (err) => t(hasMessage(err?.code) ? err.code : 'error');
const btn = (label, action, image = '', kind = '') =>
  '<button type="button" class="ui-btn ' +
  kind +
  '" data-action="' +
  action +
  '">' +
  (image ? icon(image) : '') +
  esc(t(label)) +
  '</button>';
const encoded = (id) => encodeURIComponent(id);
const idOf = (path) => decodeURIComponent(path.split('/')[2]);
function saveGuestLanguage(value) {
  try {
    localStorage.setItem('library-language', value);
  } catch {
    /* Private browsing can disable storage. */
  }
}
async function api(path, method = 'GET', body, headers = {}) {
  const opts = {
    method,
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...headers },
    cache: 'no-store',
  };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const response = await fetch('/api' + path, opts);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = Object.assign(new Error(data.error || 'error'), {
      code: data.error || 'error',
      data,
      status: response.status,
    });
    if (response.status === 401 && path !== '/login' && !path.startsWith('/setup') && state.user && state.page !== 'public') {
      privateReset();
      history.replaceState({}, '', '/');
      void route();
      notify(t('unauthenticated'));
    }
    throw error;
  }
  return data;
}
function notify(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 4200);
}
function hideModal() {
  if (modal.open) modal.close();
  state.modal = null;
  modal.innerHTML = '';
}
function privateReset() {
  state.user = null;
  state.books = [];
  state.book = null;
  state.filters = defaults();
  state.pageIndex = 0;
  state.picked = null;
  state.note = null;
  state.catalogY = 0;
  sessionEpoch++;
  if (state.widget) state.widget.destroy();
  state.widget = null;
  hideModal();
  loginDraft = { username: '', password: '', visible: false, error: '' };
}
function languageButtons() {
  return (
    '<div class="lang-switch" aria-label="' +
    attr(t('lang')) +
    '" role="group"><button type="button" lang="ro" aria-label="Română" title="Română" data-lang="ro" aria-pressed="' +
    (state.lang === 'ro') +
    '">RO</button><button type="button" lang="en" aria-label="English" title="English" data-lang="en" aria-pressed="' +
    (state.lang === 'en') +
    '">EN</button></div>'
  );
}
function paintFrame() {
  document.documentElement.lang = state.lang;
  const privatePage = !!state.user && state.page !== 'public';
  document.querySelector('#skip').textContent = t('skip');
  header.innerHTML =
    '<div class="mast-inner ' +
    (privatePage ? 'has-user' : '') +
    '"><a class="brand" href="/" aria-label="' +
    attr(t('brand')) +
    '" data-action="home"><img src="/mark.svg" alt=""><span>' +
    esc(t('brand')) +
    '</span></a><div class="mast-actions">' +
    (privatePage
      ? '<nav class="nav-actions" aria-label="' +
        attr(t('account')) +
        '"><button class="nav-btn" data-action="home" aria-label="' +
        attr(t('catalog')) +
        '" title="' +
        attr(t('catalog')) +
        '">' +
        icon('book') +
        esc(t('catalog')) +
        '</button>' +
        (state.user.role === 'parent'
          ? '<button class="nav-btn" data-action="parent" aria-label="' +
            attr(t('admin')) +
            '" title="' +
            attr(t('admin')) +
            '">' +
            icon('gear') +
            esc(t('admin')) +
            '</button>'
          : '') +
        '<button class="nav-btn" data-action="logout" aria-label="' +
        attr(t('logout')) +
        '" title="' +
        attr(t('logout')) +
        '">' +
        icon('logout') +
        esc(t('logout')) +
        '</button></nav>'
      : '') +
    languageButtons() +
    '</div></div>';
  document.querySelector('#footer').innerHTML =
    '<div class="foot-inner"><div class="foot-rule"></div><span>' +
    esc(t('foot')) +
    '</span><div class="foot-rule"></div></div>';
}
function pageTitle(value) {
  document.title = (value ? value + ' · ' : '') + t('brand');
}
function setPage(name) {
  state.page = name;
  main.dataset.page = name;
  paintFrame();
}
function go(path, options = {}) {
  if (listPage()) state.catalogY = scrollY;
  if (options.replace) history.replaceState({}, '', path);
  else if (location.pathname !== path) history.pushState({}, '', path);
  void route();
}
window.addEventListener('popstate', () => {
  if (listPage()) state.catalogY = scrollY;
  void route();
});
function returnHome() {
  if (state.page === 'public' && !state.user) {
    history.pushState({}, '', '/');
    void boot();
  } else go('/');
}
function errorPanel(err, retry = true, gone = 'unavailable') {
  const missing = err?.status === 404 || err?.code === 'missing';
  pageTitle(t(missing ? gone : 'loadError'));
  main.innerHTML =
    '<section class="system-message"><h1>' +
    esc(t(missing ? gone : 'loadError')) +
    '</h1><p>' +
    esc(missing ? t('gone') : errorText(err)) +
    '</p>' +
    (retry && !missing ? btn('retry', 'retry') : '') +
    '</section>';
}
async function route() {
  const seq = ++state.epoch;
  if (state.widget) state.widget.destroy();
  state.widget = null;
  state.note = null;
  state.book = null;
  state.wishes = null;
  hideModal();
  main.removeAttribute('aria-busy');
  main.innerHTML = '';
  window.scrollTo({ top: 0, behavior: 'instant' });
  const path = location.pathname.replace(/\/$/, '') || '/';
  try {
    if (/^\/books\/[^/]+$/.test(path)) {
      setPage('public');
      main.textContent = t('loading');
      const data = await api('/public/' + encoded(idOf(path)));
      if (seq !== state.epoch) return;
      state.book = data.book;
      renderPublic();
      return;
    }
    if (/^\/wishlist\/[^/]+$/.test(path) && isToken(idOf(path))) {
      setPage('public');
      main.textContent = t('loading');
      try {
        const data = await api('/public/wishlist/' + encoded(idOf(path)));
        if (seq !== state.epoch) return;
        state.wishes = data.books;
        renderWishes();
      } catch (err) {
        if (seq === state.epoch) errorPanel(err, true, 'wishUnavailable');
      }
      return;
    }
    if (path === '/setup') {
      setPage('setup');
      pageTitle(t('setup'));
      main.textContent = t('loading');
      const mod = await import('./setup.js');
      if (seq !== state.epoch) return;
      main.replaceChildren();
      const leave = (username = '') => {
        rememberSetup('');
        privateReset();
        loginDraft.username = username;
        history.replaceState({}, '', '/');
        void boot();
      };
      state.widget = mod.mountSetup(main, {
        lang: state.lang,
        api: (target, method, body) => api('/setup' + target, method, body, { 'X-Setup-Token': setupToken }),
        done: leave,
        signIn: () => leave(),
      });
      return;
    }
    if (!state.user) {
      setPage('login');
      renderLogin();
      return;
    }
    if (path === '/add' || path === '/wishlist/add' || path === '/parent') {
      if (path === '/parent' && state.user.role !== 'parent') {
        go('/', { replace: true });
        return;
      }
      const wanted = path === '/wishlist/add';
      setPage(path === '/parent' ? 'parent' : 'import');
      pageTitle(t(path === '/parent' ? 'admin' : wanted ? 'wishAdd' : 'add'));
      main.textContent = t('loading');
      if (path !== '/parent') {
        const back = () => go(wanted ? '/wishlist' : '/');
        const [mod, data] = await Promise.all([import('./import.js'), api('/books')]);
        if (seq !== state.epoch) return;
        state.books = data.books;
        main.replaceChildren();
        state.widget = mod.mountImport(main, {
          lang: state.lang,
          user: state.user,
          books: state.books,
          api,
          // Books added from the wishlist are saved as wanted, not as owned.
          wanted,
          cancel: back,
          done: back,
          openBook: (id) => go('/library/' + encoded(id)),
        });
      } else {
        const mod = await import('./parent.js');
        if (seq !== state.epoch) return;
        main.replaceChildren();
        state.widget = mod.mountParent(main, {
          lang: state.lang,
          user: state.user,
          api,
          done: returnHome,
        });
      }
      return;
    }
    if (/^\/library\/[^/]+$/.test(path)) {
      setPage('detail');
      main.textContent = t('loading');
      const { book } = await api('/books/' + encoded(idOf(path)));
      if (seq !== state.epoch) return;
      state.book = book;
      state.note = { base: book.note || '', value: book.note || '' };
      renderDetail();
      return;
    }
    if (!['/', '/library', '/wishlist'].includes(path)) {
      errorPanel({ status: 404 }, false);
      return;
    }
    setPage(path === '/wishlist' ? 'wishlist' : 'catalog');
    main.textContent = t('loading');
    const data = await api('/books');
    if (seq !== state.epoch) return;
    state.books = data.books;
    renderCatalog();
    requestAnimationFrame(() => {
      if (seq === state.epoch) window.scrollTo(0, state.catalogY);
    });
  } catch (err) {
    if (seq === state.epoch) errorPanel(err);
  }
}
function renderLogin() {
  pageTitle(t('signin'));
  main.innerHTML =
    '<section class="login"><div class="login-copy"><h1>' +
    esc(t('welcome')) +
    '</h1><p class="lede">' +
    esc(t('signinHint')) +
    '</p>' +
    (setupPending ? '<p class="setup-hint">' + esc(t('setupHint')) + '</p>' : '') +
    '<form id="login" novalidate><div class="field"><label for="username">' +
    esc(t('username')) +
    '</label><input id="username" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="48" required value="' +
    attr(loginDraft.username) +
    '"></div><div class="field"><label for="password">' +
    esc(t('password')) +
    '</label><div class="password-field"><input id="password" name="password" autocomplete="current-password" maxlength="128" type="' +
    (loginDraft.visible ? 'text' : 'password') +
    '" required><button type="button" class="icon-btn" data-action="show-password" aria-label="' +
    attr(t(loginDraft.visible ? 'hide' : 'show')) +
    '">' +
    icon(loginDraft.visible ? 'hide' : 'eye') +
    '</button></div></div><div id="auth-error" role="alert" class="form-error" ' +
    (loginDraft.error ? '' : 'hidden') +
    '>' +
    esc(loginDraft.error ? t(loginDraft.error) : '') +
    '</div><button class="ui-btn primary large wide" type="submit">' +
    esc(t('signin')) +
    icon('arrow') +
    '</button></form></div></section>';
  main.querySelector('#password').value = loginDraft.password;
}
function thumbUrl(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url, location.origin);
    return parsed.origin === location.origin && ['http:', 'https:'].includes(parsed.protocol)
      ? parsed.href
      : '';
  } catch {
    return '';
  }
}
const palettes = [
  ['#567965', '#f2e7ba', '#d8e2d0'],
  ['#9a4938', '#f4d9ae', '#e8d7c7'],
  ['#385d6c', '#f6dfac', '#d9e1d8'],
  ['#786342', '#f3e1bd', '#e6decc'],
  ['#746071', '#f7dec0', '#e6dfe1'],
];
function coverArt(book, large = false) {
  const url = thumbUrl(large ? book.cover : book.thumbnail || book.cover),
    hash = Array.from(String(book.id || book.title)).reduce(
      (a, c) => (a * 31 + c.codePointAt(0)) >>> 0,
      0,
    ),
    [cover, foil, bg] = palettes[hash % palettes.length];
  const fallback =
    '<span class="book-faux" style="--cover:' +
    cover +
    ';--foil:' +
    foil +
    '" aria-hidden="true"><span class="floret">✳</span><strong>' +
    esc(book.title) +
    '</strong>' +
    (book.authors ? '<em>' + esc(book.authors) + '</em>' : '') +
    '</span>';
  return (
    '<span class="' +
    (large ? 'coverbox' : 'card-art') +
    '" style="background-color:' +
    bg +
    '">' +
    (url
      ? '<img src="' +
        attr(url) +
        '" alt="' +
        attr(t('cover') + ' · ' + book.title) +
        '" ' +
        (large ? '' : 'loading="lazy" ') +
        'decoding="async">'
      : fallback) +
    '</span>'
  );
}
function renderCatalog() {
  const wish = wishing(),
    books = listed(),
    year = localDay().slice(0, 4),
    finished = wish ? 0 : finishedIn(books, year),
    wishes = state.books.length - books.length;
  pageTitle(t(wish ? 'wishlist' : 'shelf'));
  const f = state.filters;
  main.innerHTML =
    (wish
      ? '<a class="link-btn detail-back" data-action="home" href="/">' + icon('back') + esc(t('back')) + '</a>'
      : '') +
    '<div class="catalog-head"><div><h1>' +
    esc(t(wish ? 'wishlist' : 'shelf')) +
    '</h1><p>' +
    esc([countBooks(books.length, state.lang), finished ? finishedLabel(finished, year, state.lang) : '']
      .filter(Boolean).join(' · ')) +
    '</p></div><div class="catalog-head-actions">' +
    (wish
      ? ''
      : '<a class="ui-btn" href="/wishlist" data-action="wishlist">' + icon('gift') + esc(t('wishlist')) +
        (wishes ? ' · ' + wishes : '') + '</a>') +
    btn(wish ? 'wishAdd' : 'add', wish ? 'wish-add' : 'add', 'plus', 'primary large') +
    '</div></div>' +
    '<div class="catalog-tools"><label class="searchbox">' +
    icon('search') +
    '<span class="sr">' +
    esc(t('search')) +
    '</span><input id="search" type="search" placeholder="' +
    attr(t('search')) +
    '" maxlength="300" value="' +
    attr(f.search) +
    '"></label><label><span class="sr">' +
    esc(t('sort')) +
    '</span><select id="sort" aria-label="' +
    attr(t('sort')) +
    '" class="sortselect">' +
    ['tAsc', 'tDesc', 'aAsc', 'aDesc', 'newest', 'oldest', ...(wish ? [] : ['finished'])]
      .map(
        (k) =>
          '<option value="' +
          k +
          '" ' +
          (k === f.sort ? 'selected' : '') +
          '>' +
          esc(t(k)) +
          '</option>',
      )
      .join('') +
    '</select></label></div>' +
    '<div class="chips" id="filters"></div><div id="results"></div>';
  updateResults();
}
function updateResults() {
  const f = state.filters,
    wish = wishing(),
    pool = listed(),
    shelves = shelfChoices(pool),
    anyLent = pool.some((b) => b.lentTo);
  // The books of a chosen shelf may all have been deleted, or its photo removed.
  if (f.shelf && !(f.shelf === 'none' ? shelves.length : shelves.some((s) => s.id === f.shelf))) f.shelf = '';
  // The last lent book may have come home.
  if (f.lent && !anyLent) f.lent = false;
  // The last pair of look-alikes may have been corrected or deleted.
  const anyTwins = !wish && duplicateGroups(pool).size > 0;
  if (f.dupes && !anyTwins) f.dupes = false;
  const books = visibleBooks(pool, listFilters(), state.lang),
    filtered = !!(wish ? f.search : f.fav || f.read || f.cover || f.shelf || f.lent || f.dupes || f.search);
  const option = (value, label) =>
    '<option value="' + attr(value) + '"' + (value === f.shelf ? ' selected' : '') + '>' + esc(label) + '</option>';
  const chip = (key, on, label, image = '') =>
    '<button type="button" class="chip" data-filter="' +
    key +
    '" aria-pressed="' +
    on +
    '">' +
    (image ? icon(image) : '') +
    esc(t(label)) +
    '</button>';
  // A wished-for book is neither read, lent nor on a shelf yet, so its list only searches and sorts.
  main.querySelector('#filters').innerHTML = wish ? '' :
    chip('all', !f.fav && !f.read && !f.cover && !f.shelf && !f.lent && !f.dupes, 'all') +
    chip('fav', f.fav, 'favorites', 'heart') +
    '<span class="chip-sep"></span>' +
    chip('read', f.read === 'read', 'read') +
    chip('unread', f.read === 'unread', 'unread') +
    '<span class="chip-sep"></span>' +
    chip('with', f.cover === 'with', 'withCover') +
    chip('without', f.cover === 'without', 'withoutCover') +
    // Shown while at least one book is away from home.
    (anyLent ? '<span class="chip-sep"></span>' + chip('lent', f.lent, 'lentOut') : '') +
    // Shown while at least two books look like the same one.
    (anyTwins ? '<span class="chip-sep"></span>' + chip('dupes', f.dupes, 'possibleDuplicates') : '') +
    // Shown once at least one book was saved from a shelf photo.
    (shelves.length
      ? '<span class="chip-sep"></span><select id="shelf-filter" class="sortselect shelfselect' +
        (f.shelf ? ' on' : '') + '" aria-label="' + attr(t('shelfFilter')) + '">' +
        option('', t('allShelves')) +
        shelves.map((s) => option(s.id, shelfLabel(s, state.lang))).join('') +
        option('none', t('noShelf')) +
        '</select>'
      : '');
  const results = main.querySelector('#results');
  const view = pageOf(books, state.pageIndex);
  state.pageIndex = view.index;
  const picking = state.picked && state.user.role === 'parent';
  if (state.picked) {
    // A book deleted elsewhere cannot stay selected.
    const present = new Set(state.books.map((b) => b.id));
    for (const id of state.picked) if (!present.has(id)) state.picked.delete(id);
  }
  results.innerHTML =
    '<div class="resultline"><span role="status">' +
    [filtered ? countBooks(books.length, state.lang) : '',
      view.pages > 1 ? rangeLabel(view.from, view.to, books.length, state.lang) : '']
      .filter(Boolean).map(esc).join(' · ') +
    '</span><span class="resultline-actions">' +
    (filtered
      ? '<button type="button" data-action="clear" class="link-btn">' +
        icon('x') +
        esc(t('clear')) +
        '</button>'
      : '') +
    (state.user.role === 'parent' && pool.length && !picking
      ? '<button type="button" data-action="select-mode" class="link-btn">' +
        icon('check') +
        esc(t('selectBooks')) +
        '</button>'
      : '') +
    '</span></div>' +
    (picking
      ? '<div class="selectbar" role="group" aria-label="' +
        attr(t('selection')) +
        '"><strong id="picked-count" role="status"></strong>' +
        // Among look-alikes "all" would mean every copy of each book, so the copies are ticked by hand.
        (books.length && !f.dupes
          ? '<button type="button" class="ui-btn" data-action="select-all">' +
            esc(t('selectAll')) +
            ' (' +
            books.length +
            ')</button>'
          : '') +
        btn('clearSelection', 'select-none') +
        btn('deleteSelected', 'delete-selected', 'trash', 'negative') +
        btn('doneSelecting', 'select-done', '', 'forest') +
        '</div>'
      : '');
  if (picking) paintPicked();
  if (!pool.length) {
    results.insertAdjacentHTML(
      'beforeend',
      '<section class="empty-catalog"><div class="empty-copy"><h2>' +
        esc(t(wish ? 'wishEmptyTitle' : 'emptyTitle')) +
        '</h2><p>' +
        esc(t(wish ? 'wishEmptyHint' : 'emptyHint')) +
        '</p>' +
        btn(wish ? 'wishAdd' : 'first', wish ? 'wish-add' : 'add', 'plus', 'primary') +
        '</div></section>',
    );
    return;
  }
  if (!books.length) {
    results.insertAdjacentHTML(
      'beforeend',
      '<section class="no-results"><h2>' +
        esc(t('nothing')) +
        '</h2><p>' +
        esc(t('trySearch')) +
        '</p>' +
        btn('clear', 'clear') +
        '</section>',
    );
    return;
  }
  const cardInfo = (b) =>
    coverArt(b) +
    '<span class="card-info"><strong class="card-title">' +
    esc(b.title) +
    '</strong>' +
    (b.authors ? '<span class="authorline">' + esc(b.authors) + '</span>' : '') +
    (wish
      ? ''
      : '<span class="state-text ' +
        (b.read ? 'read' : '') +
        '">' +
        esc(t(b.read ? 'read' : 'unread')) +
        '</span>' +
        (b.lentTo ? '<span class="state-text lent">' + esc(lentLabel(b.lentTo, '', state.lang)) + '</span>' : '')) +
    '</span>';
  const pager =
    view.pages > 1
      ? '<nav class="pager" aria-label="' +
        attr(t('pages')) +
        '">' +
        ['prev', 'next']
          .map(
            (way) =>
              '<button type="button" class="ui-btn" data-action="page-' +
              way +
              '" ' +
              ((way === 'prev' ? view.index === 0 : view.index === view.pages - 1) ? 'disabled' : '') +
              '>' +
              (way === 'prev' ? icon('back') : '') +
              esc(t(way + 'Page')) +
              (way === 'next' ? icon('arrow') : '') +
              '</button>',
          )
          .join('<span class="pager-at">' + esc(pageLabel(view.index + 1, view.pages, state.lang)) + '</span>') +
        '</nav>'
      : '';
  const markup = picking
    ? view.items
        .map(
          (b) =>
            '<article class="book-card"><button type="button" class="card-open card-pick" role="checkbox" aria-checked="' +
            state.picked.has(b.id) +
            '" data-pick-id="' +
            attr(b.id) +
            '">' +
            cardInfo(b) +
            '<span class="pick-mark">' +
            icon('check') +
            '</span></button></article>',
        )
        .join('')
    : view.items
    .map(
      (b) =>
        '<article class="book-card"><a class="card-open" href="/library/' +
        attr(encoded(b.id)) +
        '" data-book-id="' +
        attr(b.id) +
        '">' +
        cardInfo(b) +
        '</a>' + coverAttribution(b) +
        (wish
          ? ''
          : '<button class="card-favorite" type="button" data-fav-id="' +
            attr(b.id) +
            '" aria-pressed="' +
            !!b.favorite +
            '" title="' +
            attr(t(b.favorite ? 'dropFav' : 'addFav')) +
            '" aria-label="' +
            attr(t(b.favorite ? 'dropFav' : 'addFav') + ' · ' + b.title) +
            '"><span>' +
            icon('heart') +
            '</span></button>') +
        '</article>',
    )
    .join('');
  results.insertAdjacentHTML('beforeend', '<div class="book-grid">' + markup + '</div>' + pager);
}
function paintPicked() {
  const count = main.querySelector('#picked-count');
  if (!count) return;
  count.textContent = selectedCount(state.picked.size, state.lang);
  main.querySelector('[data-action="delete-selected"]').disabled = !state.picked.size;
  main.querySelector('[data-action="select-none"]').disabled = !state.picked.size;
}
function renderPublic() {
  const b = state.book;
  if (!b) return;
  pageTitle(b.title);
  main.innerHTML =
    '<article class="detail">' +
    coverArt(b, true) +
    '<div class="detail-info"><h1>' +
    esc(b.title) +
    '</h1>' +
    (b.authors ? '<p class="byline">' + esc(b.authors) + '</p>' : '') +
    coverAttribution(b) + '</div></article>';
}
function renderWishes() {
  const books = state.wishes;
  if (!books) return;
  pageTitle(t('wishShared'));
  main.innerHTML =
    '<div class="catalog-head"><div><h1>' +
    esc(t('wishShared')) +
    '</h1><p>' +
    esc(t(books.length ? 'wishSharedHint' : 'wishSharedEmpty')) +
    '</p></div></div><div class="book-grid">' +
    books
      .map(
        (b) =>
          '<article class="book-card"><a class="card-open" href="/books/' +
          attr(encoded(b.id)) +
          '">' +
          coverArt(b) +
          '<span class="card-info"><strong class="card-title">' +
          esc(b.title) +
          '</strong>' +
          (b.authors ? '<span class="authorline">' + esc(b.authors) + '</span>' : '') +
          '</span></a>' +
          coverAttribution(b) +
          '</article>',
      )
      .join('') +
    '</div>';
}
function date(value) {
  const d = new Date(value);
  return Number.isFinite(+d)
    ? new Intl.DateTimeFormat(state.lang, { dateStyle: 'medium' }).format(d)
    : '';
}
function renderDetail() {
  const b = state.book;
  if (!b) return;
  pageTitle(b.title);
  const note = state.note;
  const stars = [1, 2, 3, 4, 5]
    .map(
      (n) =>
        '<button type="button" class="star-btn" data-action="rate" data-rate="' +
        n +
        '" aria-pressed="' +
        (b.rating >= n) +
        '" aria-label="' +
        attr(ratingLabel(n, state.lang)) +
        '">' +
        icon('star') +
        '</button>',
    )
    .join('');
  main.innerHTML =
    (b.wanted
      ? '<a class="link-btn detail-back" data-action="wishlist" href="/wishlist">' + icon('back') + esc(t('wishlist')) + '</a>'
      : '<a class="link-btn detail-back" data-action="home" href="/">' + icon('back') + esc(t('back')) + '</a>') +
    '<article class="detail">' +
    coverArt(b, true) +
    '<div class="detail-info"><h1>' +
    esc(b.title) +
    '</h1>' +
    (b.authors ? '<p class="byline">' + esc(b.authors) + '</p>' : '') +
    '<div class="book-meta">' +
    (b.publisher ? esc(t('publisher') + ' · ' + b.publisher) + ' · ' : '') +
    (b.publishedDate ? esc(t('publishedDate') + ' · ' + b.publishedDate) + ' · ' : '') +
    (b.isbn ? 'ISBN ' + esc(b.isbn) + ' · ' : '') +
    esc(t('added') + ' ' + date(b.createdAt)) +
    '</div>' + coverAttribution(b) +
    (b.wanted
      ? '<p class="wanted-note">' + icon('gift') + esc(t('wantedField')) + '</p><div class="actions">' +
        btn('gotIt', 'got-it', 'check', 'primary') +
        btn('share', 'share', 'share') +
        '</div>'
      : '<div class="actions"><button type="button" data-action="fav-book" class="status-btn" aria-pressed="' +
        !!b.favorite +
        '" title="' +
        attr(t(b.favorite ? 'dropFav' : 'addFav')) +
        '">' +
        icon('heart') +
        esc(t('favorite')) +
        '</button><button data-action="read-book" class="status-btn" aria-pressed="' +
        !!b.read +
        '" title="' +
        attr(t(b.read ? 'markUnread' : 'markRead')) +
        '">' +
        icon('book') +
        esc(t(b.read ? 'read' : 'unread')) +
        '</button>' +
        btn('share', 'share', 'share', 'primary') +
        (b.shelfPhoto ? btn('shelfPhoto', 'shelf-photo', 'photo') : '') +
        '</div>' +
        // The reading log appears once the book is read.
        (b.read
          ? '<div class="reading-log"><div class="field"><label for="finished">' +
            esc(t('finishedAtField')) +
            '</label><input id="finished" type="date" min="1900-01-01" max="' +
            attr(localDay()) +
            '" value="' +
            attr(b.finishedAt) +
            '"></div><div class="field"><span class="field-label" id="rating-label">' +
            esc(t('ratingField')) +
            '</span><div class="stars" role="group" aria-labelledby="rating-label">' +
            stars +
            '</div></div></div>'
          : '') +
        '<div class="lending">' +
        (b.lentTo
          ? '<p class="lent-note">' + esc(lentLabel(b.lentTo, b.lentAt, state.lang)) + '</p>' + btn('returned', 'returned', 'check')
          : btn('lend', 'lend', 'arrow')) +
        '</div>') +
    '<form id="note-form" class="note-area"><div class="field"><label for="note">' +
    esc(t('note')) +
    '</label><span class="private-help">' +
    esc(t('private')) +
    '</span><textarea id="note" maxlength="4000" placeholder="' +
    attr(t('notePlaceholder')) +
    '">' +
    esc(note.value) +
    '</textarea></div><div class="f-row"><button type="submit" class="ui-btn" id="save-note" ' +
    (note.value === note.base ? 'disabled' : '') +
    '>' +
    esc(t('saveNote')) +
    '</button><span id="note-status" class="private-help">' +
    (note.base !== note.value ? esc(t('unsaved')) : '') +
    '</span></div></form>' +
    '<div class="detail-lower">' +
    btn('edit', 'edit', 'edit') +
    (state.user.role === 'parent' ? btn('remove', 'delete', 'trash', 'link-btn') : '') +
    '</div></div></article>';
}
function putBook(b) {
  const at = state.books.findIndex((x) => x.id === b.id);
  if (at < 0) state.books.push(b);
  else state.books[at] = b;
  if (state.book?.id === b.id) {
    state.book = b;
    if (state.note && state.note.value === state.note.base)
      state.note = { value: b.note || '', base: b.note || '' };
  }
}
function redrawCurrent() {
  if (state.page === 'detail') renderDetail();
  else if (listPage()) updateResults();
}
function openModal(spec) {
  state.modal = spec;
  renderModal();
  if (!modal.open) modal.showModal();
}
const fieldNames = {
  title: 'title',
  authors: 'authors',
  publisher: 'publisher',
  publishedDate: 'publishedDate',
  isbn: 'ISBN',
  read: 'read',
  favorite: 'favorite',
  note: 'note',
  cover: 'cover',
  lentTo: 'lentToField',
  lentAt: 'lentAtField',
  finishedAt: 'finishedAtField',
  rating: 'ratingField',
  wanted: 'wantedField',
};
function valueText(key, value) {
  if (key === 'cover') return value ? t('reviewCover') : t('blank');
  if (typeof value === 'boolean') return t(value ? 'yes' : 'no');
  return String(value || t('blank'));
}
function googleSourceLink(source) {
  if (source?.source !== 'googlebooks') return '';
  try {
    const u = new URL(source.sourceUrl);
    if (u.origin !== 'https://books.google.com' || u.pathname !== '/books' ||
        u.username || u.password || !/^[A-Za-z0-9_-]{1,80}$/.test(u.searchParams.get('id') || '')) return '';
    return '<a class="google-source" href="' + attr(u.href) + '" target="_blank" rel="noopener noreferrer">' +
      '<img src="/google-books-poweredby.png" alt="Powered by Google">' + esc(t('googleCoverSource')) + '</a>';
  } catch { return ''; }
}
function coverAttribution(book) {
  return '<span class="cover-attribution" data-cover-attribution>' + googleSourceLink(book.coverAttribution || book.catalogSource) + '</span>';
}
function coverPicker(m) {
  const options = m.original.coverOptions || [];
  const pending = ['queued', 'searching'].includes(m.original.coverLookup?.status);
  const status = m.original.coverLookup?.status;
  let choices = options;
  const isWeb = c => ['openlibrary','googlebooks','bravesearch'].includes(c.source);
  const sourceLink = c => {
    if (c.source === 'googlebooks') return googleSourceLink(c);
    try {
      const u = new URL(c.sourceUrl);
      if (u.protocol !== 'https:' || u.username || u.password || u.port) return '';
      // An image-search cover names the bookshop or publisher page it was found on.
      if (c.source === 'bravesearch') return '<a href="' + attr(u.href) + '" target="_blank" rel="noopener noreferrer">' +
        esc(t('coverFrom') + ' ' + u.hostname.replace(/^www\./, '')) + '</a>';
      const key = c.source === 'openlibrary' && u.hostname === 'openlibrary.org' ? 'coverSource' :
        c.source === 'googlebooks' && u.hostname === 'books.google.com' && u.pathname === '/books' ? 'googleCoverSource' : null;
      return key ? '<a href="' + attr(u.href) + '" target="_blank" rel="noopener noreferrer">' + esc(t(key)) + '</a>' : '';
    } catch { return ''; }
  };
  if (m.draft.cover && !options.some(c => c.cover === m.draft.cover)) {
    choices = [{ cover: m.draft.cover, thumbnail: m.draft.cover, source: 'upload' }, ...options];
  }
  return '<fieldset class="cover-picker"><legend>' + esc(t('coverChoices')) + '</legend>' +
    '<p class="muted" role="status">' + esc(t(pending ? 'coverSearching' : status === 'empty' ? 'coverEmpty' : status === 'failed' ? 'coverFailed' : m.original.coverLookup?.warnings?.length ? 'coverPartial' : 'coverHint')) + '</p>' +
    '<div class="cover-choices">' + choices.map((c, i) =>
      '<div class="cover-choice"><button type="button" data-action="choose-web-cover" data-choice="' + i + '" aria-pressed="' + (m.draft.cover === c.cover) + '"' + (m.busy ? ' disabled' : '') + '>' +
      '<img src="' + attr(c.thumbnail) + '" alt="' + attr(t(isWeb(c) ? 'coverWeb' : 'coverUploaded') + ' ' + (i + 1)) + '">' +
      '<span>' + esc(t(m.draft.cover === c.cover ? 'coverSelected' : isWeb(c) ? 'coverWeb' : 'coverUploaded')) + '</span></button>' +
      sourceLink(c) + '</div>'
    ).join('') + '</div>' +
    (!pending ? '<button type="button" class="ui-btn" data-action="find-covers"' + (m.busy ? ' disabled' : '') + '>' + esc(t('findCovers')) + '</button>' : '') + '</fieldset>';
}
function refreshCoverPicker() {
  const slot = modal.querySelector('[data-cover-picker]');
  if (slot && state.modal?.kind === 'edit') slot.innerHTML = coverPicker(state.modal);
}
let coverPolling = false, lastCatalogCovers = 0;
async function refreshPendingCovers() {
  if (coverPolling || !state.user || document.hidden) return;
  const m = state.modal, b = m?.kind === 'edit' ? m.original : state.page === 'detail' ? state.book : null;
  const pending = x => ['queued', 'searching'].includes(x?.coverLookup?.status);
  const epoch = state.epoch;
  coverPolling = true;
  try {
    if (b && pending(b)) {
      const { book } = await api('/books/' + encoded(b.id));
      if (state.epoch !== epoch) return;
      putBook(book);
      if (m && state.modal === m && m.kind === 'edit') {
        if (m.draft.cover === m.original.cover) m.draft.cover = book.cover;
        m.original = { ...m.original, cover: book.cover, coverOptions: book.coverOptions, coverLookup: book.coverLookup };
        refreshCoverPicker();
      }
      const art = main.querySelector('.detail > .coverbox');
      if (art && state.book?.id === book.id) art.outerHTML = coverArt(book, true);
      const attribution = main.querySelector('.detail [data-cover-attribution]');
      if (attribution && state.book?.id === book.id) attribution.outerHTML = coverAttribution(book);
    } else if (listPage() && state.books.some(pending) && Date.now() - lastCatalogCovers > 15000) {
      lastCatalogCovers = Date.now();
      const { books } = await api('/books');
      if (state.epoch !== epoch) return;
      state.books = books;
      // Replace artwork only, preserving filters, focus and current scroll.
      for (const item of main.querySelectorAll('.card-open')) {
        const book = books.find(b => item.getAttribute('href') === '/library/' + encoded(b.id));
        const art = item.querySelector('.card-art');
        if (book && art) art.outerHTML = coverArt(book);
        const attribution = item.parentElement.querySelector('[data-cover-attribution]');
        if (book && attribution) attribution.outerHTML = coverAttribution(book);
      }
    }
  } catch { /* The next foreground refresh can recover a transient failure. */ }
  finally { coverPolling = false; }
}
setInterval(() => { void refreshPendingCovers(); }, 5000);
function renderModal() {
  const m = state.modal;
  if (!m) return;
  let heading = '',
    body = '';
  const status =
    '<p data-modal-error class="form-error" role="alert" ' +
    (m.error ? '' : 'hidden') +
    '>' +
    esc(m.error ? errorText(m.error) : '') +
    '</p>';
  if (m.kind === 'share') {
    const b = state.book,
      url = location.origin + '/books/' + encoded(b.id);
    heading = t('share');
    body =
      '<p>' +
      esc(t('shareInfo')) +
      '</p><div class="share-review"><span class="preview-thumb">' +
      (thumbUrl(b.thumbnail || b.cover)
        ? '<img alt="" src="' + attr(thumbUrl(b.thumbnail || b.cover)) + '">'
        : icon('book')) +
      '</span><div><strong>' +
      esc(b.title) +
      '</strong><p>' +
      esc(b.authors) +
      '</p></div></div><div class="field"><label for="share-url">' +
      esc(t('link')) +
      '</label><input id="share-url" readonly value="' +
      attr(url) +
      '"></div><div class="actions"><a class="ui-btn" target="_blank" rel="noopener" href="' +
      attr(url) +
      '">' +
      icon('ext') +
      esc(t('publicPreview')) +
      '</a>' +
      btn('copy', 'copy', 'copy', 'primary') +
      '</div>';
  } else if (m.kind === 'edit') {
    heading = t('edit');
    const fld = (key, name, limit) =>
      '<div class="field"><label for="edit-' +
      key +
      '">' +
      esc(name) +
      '</label><input id="edit-' +
      key +
      '" data-edit="' +
      key +
      '" value="' +
      attr(m.draft[key]) +
      '" maxlength="' +
      limit +
      '" ' +
      (key === 'publishedDate' ? 'placeholder="' + attr(t('dateFormat')) + '"' : key === 'title' ? 'required' : '') +
      '></div>';
    body =
      '<form id="edit-form" novalidate>' +
      fld('title', t('title'), 300) +
      fld('authors', t('authors'), 400) +
      fld('publisher', t('publisher'), 200) +
      fld('publishedDate', t('publishedDate'), 10) +
      fld('isbn', 'ISBN', 30) +
      '<div data-cover-picker>' + coverPicker(m) + '</div>' +
      '<div class="field"><label for="edit-file">' +
      esc(t('chooseCover')) +
      '</label><input id="edit-file" type="file" accept="image/jpeg,image/png,image/webp">' +
      (m.draft.cover
        ? '<button type="button" class="ui-btn" data-action="remove-cover">' +
          icon('x') +
          esc(t('removeCover')) +
          '</button>'
        : '') +
      '<span class="muted">' +
      (m.draft.cover && m.draft.cover !== m.original.cover ? esc(t('coverReady')) : '') +
      '</span></div>' +
      status +
      (m.duplicate
        ? '<p role="alert" class="form-error">' + esc(t('duplicate') + ' ' + m.duplicate.title) + '</p>'
        : '') +
      '<div class="actions">' +
      btn('cancel', 'close') +
      '<button class="ui-btn primary" ' +
      (m.busy ? 'disabled' : '') +
      ' type="submit">' +
      esc(t(m.duplicate ? 'saveAnyway' : 'save')) +
      '</button></div></form>';
  } else if (m.kind === 'lend') {
    heading = t('lend');
    body =
      '<form id="lend-form" novalidate><p>' +
      esc(t('lendHint')) +
      '</p><div class="field"><label for="lend-to">' +
      esc(t('lentToField')) +
      '</label><input id="lend-to" maxlength="80" autocomplete="off" required value="' +
      attr(m.to) +
      '"></div><div class="field"><label for="lend-at">' +
      esc(t('lentAtField')) +
      '</label><input id="lend-at" type="date" min="1900-01-01" max="' +
      attr(localDay()) +
      '" value="' +
      attr(m.at) +
      '"></div>' +
      status +
      '<div class="actions">' +
      btn('cancel', 'close') +
      '<button class="ui-btn primary" ' +
      (m.busy ? 'disabled' : '') +
      ' type="submit">' +
      esc(t('lendSave')) +
      '</button></div></form>';
  } else if (m.kind === 'delete') {
    heading = t('remove');
    body =
      '<p><strong>' +
      esc(m.book.title) +
      '</strong></p><p>' +
      esc(t('deleteConfirm')) +
      '</p>' +
      status +
      '<div class="actions">' +
      btn('cancel', 'close') +
      btn('remove', 'confirm-delete', 'trash', 'negative') +
      '</div>';
  } else if (m.kind === 'shelf-photo') {
    heading = t('shelfPhoto');
    const place = m.photo.place;
    // The outline is sized in fractions of the photo, so it follows the picture at any width.
    const mark = place
      ? '<span class="shelf-mark" style="left:' +
        place.x * 100 +
        '%;top:' +
        place.y * 100 +
        '%;width:' +
        place.w * 100 +
        '%;height:' +
        place.h * 100 +
        '%;transform:translate(-50%,-50%) rotate(' +
        Number(place.angle) +
        'rad)"></span>'
      : '';
    body = m.gone
      ? '<p role="alert">' + esc(t('shelfPhotoGone')) + '</p><div class="actions">' + btn('close', 'close') + '</div>'
      : '<p class="private-help">' +
        esc(m.title + ' · ' + t(place ? 'shelfPhotoHelp' : 'shelfPhotoPlain')) +
        '</p><div class="shelf-stage"><div class="shelf-view"><img data-shelf-photo src="' +
        attr(m.photo.url) +
        '" alt="' +
        attr(t('shelfPhotoAlt')) +
        '">' +
        mark +
        '</div></div><div class="actions"><a class="ui-btn" href="' +
        attr(m.photo.url) +
        '" target="_blank" rel="noopener">' +
        icon('ext') +
        esc(t('shelfPhotoOpen')) +
        '</a>' +
        btn('close', 'close') +
        '</div>';
  } else if (m.kind === 'bulk-delete') {
    heading = t('bulkDeleteTitle');
    const left = m.total - m.done - m.kept;
    body =
      '<p><strong>' +
      esc(countBooks(left, state.lang)) +
      '</strong></p><p class="private-help">' +
      esc(m.titles.join(' · ') + (m.total > m.titles.length ? ' · ' + andMore(m.total - m.titles.length, state.lang) : '')) +
      '</p><p>' +
      esc(t('bulkDeleteConfirm')) +
      '</p>' +
      (m.busy
        ? '<p role="status">' +
          esc(deletingProgress(m.done, m.total, state.lang)) +
          '</p><progress class="bulk-progress" max="' +
          m.total +
          '" value="' +
          m.done +
          '"></progress>'
        : '') +
      status +
      '<div class="actions">' +
      btn('cancel', 'close') +
      '<button type="button" class="ui-btn negative" data-action="confirm-bulk-delete" ' +
      (m.busy || !left ? 'disabled' : '') +
      '>' +
      icon('trash') +
      esc(deleteCount(left, state.lang)) +
      '</button></div>';
  } else if (m.kind === 'conflict') {
    heading = t('conflict');
    body =
      '<p>' +
      esc(t('conflictHint')) +
      '</p>' +
      Object.keys(m.changes)
        .map(
          (key) =>
            '<div><b>' +
            esc(key === 'isbn' ? 'ISBN' : t(fieldNames[key])) +
            '</b><div class="private-help">' +
            esc(t('newValue')) +
            '</div><span class="conflict-copy">' +
            esc(valueText(key, m.current[key])) +
            '</span><div class="private-help">' +
            esc(t('myValue')) +
            '</div><span class="conflict-copy">' +
            esc(valueText(key, m.changes[key])) +
            '</span></div>',
        )
        .join('') +
      status +
      '<div class="actions">' +
      btn('keepNew', 'conflict-new') +
      btn('keepMine', 'conflict-mine', '', 'primary') +
      '</div>';
  }
  modal.classList.toggle('wide', m.kind === 'shelf-photo' && !m.gone);
  modal.setAttribute('aria-labelledby', 'dialog-title');
  modal.innerHTML =
    '<div class="dlg-top"><h2 id="dialog-title">' +
    esc(heading) +
    '</h2>' +
    languageButtons() +
    '<button type="button" class="icon-btn" data-action="close" aria-label="' +
    attr(t('close')) +
    '">' +
    icon('x') +
    '</button></div>' +
    body;
}
modal.addEventListener('cancel', () => {
  state.modal = null;
});
// A shelf photo the parent has since deleted simply fails to load.
modal.addEventListener('error', (e) => {
  if (e.target.matches?.('[data-shelf-photo]') && state.modal?.kind === 'shelf-photo') {
    state.modal.gone = true;
    renderModal();
  }
}, true);
modal.addEventListener('click', (e) => {
  if (e.target === modal) {
    const r = modal.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
      hideModal();
  }
});
async function patchBook(book, changes, base, onSaved) {
  const epoch = state.epoch;
  try {
    const data = await api('/books/' + encoded(book.id), 'PATCH', { changes, base });
    if (epoch !== state.epoch) return;
    putBook(data.book);
    onSaved?.(data.book);
    redrawCurrent();
  } catch (err) {
    if (epoch !== state.epoch) return;
    if (err.code === 'conflict' && err.data?.book) {
      const current = err.data.book;
      putBook(current);
      openModal({
        kind: 'conflict',
        id: book.id,
        current,
        changes,
        onSaved,
        previous: state.modal?.kind === 'edit' ? state.modal : null,
      });
      return;
    }
    if (state.modal) {
      state.modal.error = err;
      renderModal();
    } else notify(errorText(err));
  }
}
async function changeLang(lang) {
  if (!['ro', 'en'].includes(lang) || lang === state.lang) return;
  const oldFocus = document.activeElement;
  state.lang = lang;
  saveGuestLanguage(lang);
  paintFrame();
  if (state.widget) {
    state.widget.setLanguage(lang);
    pageTitle(t(state.page === 'setup' ? 'setup' : state.page === 'parent' ? 'admin' : location.pathname.startsWith('/wishlist') ? 'wishAdd' : 'add'));
  } else if (state.page === 'login') renderLogin();
  else if (listPage() && main.querySelector('#filters')) renderCatalog();
  else if (state.page === 'detail' && state.book) renderDetail();
  else if (state.page === 'public' && state.book) renderPublic();
  else if (state.page === 'public' && state.wishes) renderWishes();
  else if (main.querySelector('.system-message')) {
    void route();
  }
  if (state.modal) renderModal();
  if (oldFocus?.dataset.lang)
    (state.modal ? modal : header).querySelector('[data-lang="' + lang + '"]')?.focus();
  // Serialize changes so two quick switches cannot save in reverse order.
  if (state.user) {
    const account = sessionEpoch;
    languageSave = languageSave.then(async () => {
      if (account !== sessionEpoch) return;
      try {
        await api('/me', 'PATCH', { language: lang });
        if (account === sessionEpoch && state.user) state.user.language = lang;
      } catch (err) {
        notify(errorText(err));
      }
    });
  }
}
let languageSave = Promise.resolve();
main.addEventListener('input', (e) => {
  if (e.target.id === 'search') {
    state.filters.search = e.target.value;
    state.pageIndex = 0;
    updateResults();
  }
  if (e.target.id === 'username' || e.target.id === 'password') loginDraft[e.target.id] = e.target.value;
  if (e.target.id === 'note') {
    state.note.value = e.target.value;
    const dirty = state.note.value !== state.note.base;
    main.querySelector('#save-note').disabled = !dirty;
    main.querySelector('#note-status').textContent = dirty ? t('unsaved') : '';
  }
});
modal.addEventListener('input', (e) => {
  if (e.target.dataset.edit && state.modal?.kind === 'edit') {
    state.modal.draft[e.target.dataset.edit] = e.target.value;
    state.modal.duplicate = null;
  }
  // Kept on the dialog's own record, so that a language switch redraws it with what was typed.
  if (state.modal?.kind === 'lend') {
    if (e.target.id === 'lend-to') state.modal.to = e.target.value;
    if (e.target.id === 'lend-at') state.modal.at = e.target.value;
  }
});
main.addEventListener('change', (e) => {
  if (e.target.id === 'sort') {
    state.filters.sort = e.target.value;
    state.pageIndex = 0;
    updateResults();
  }
  if (e.target.id === 'shelf-filter') {
    state.filters.shelf = e.target.value;
    state.pageIndex = 0;
    updateResults();
    main.querySelector('#shelf-filter')?.focus();
  }
  // The finished day saves as soon as it is picked; an emptied field means the day is not known.
  if (e.target.id === 'finished' && state.book) {
    const b = state.book,
      value = e.target.value;
    if (value !== b.finishedAt && value <= localDay())
      void patchBook(b, { finishedAt: value }, { finishedAt: b.finishedAt }, () => notify(t('saved'))).then(() =>
        main.querySelector('#finished')?.focus(),
      );
  }
});
modal.addEventListener('change', async (e) => {
  if (e.target.id !== 'edit-file' || !e.target.files.length) return;
  const m = state.modal;
  m.busy = true;
  const file = e.target.files[0];
  renderModal();
  try {
    const { prepareCover } = await import('./import.js');
    const cover = await prepareCover(file);
    if (state.modal !== m) return;
    m.draft.cover = cover;
    m.error = null;
  } catch {
    m.error = { code: 'invalidImage' };
  } finally {
    m.busy = false;
    if (state.modal === m) renderModal();
  }
});
async function login(form) {
  const submit = form.querySelector('[type=submit]');
  submit.disabled = true;
  try {
    if (!loginDraft.username.trim() || !loginDraft.password)
      throw Object.assign(new Error('credentials'), { code: 'credentials' });
    const result = await api('/login', 'POST', {
      username: loginDraft.username.trim(),
      password: loginDraft.password,
    });
    state.user = result.user;
    sessionEpoch++;
    const language = state.user.language || state.lang;
    if (!state.user.language) {
      try {
        await api('/me', 'PATCH', { language });
      } catch {
        /* A later preference change retries the write. */
      }
    }
    state.lang = language;
    saveGuestLanguage(language);
    loginDraft = { username: '', password: '', visible: false, error: '' };
    await route();
  } catch (err) {
    loginDraft.error = hasMessage(err.code) ? err.code : 'error';
    const slot = main.querySelector('#auth-error');
    if (slot) {
      slot.hidden = false;
      slot.textContent = t(loginDraft.error);
    }
    submit.disabled = false;
  }
}
async function submitEdit() {
  const m = state.modal;
  if (m?.kind !== 'edit' || m.busy) return;
  const b = m.original,
    draft = m.draft;
  if (!draft.title.trim()) {
    m.error = { code: 'invalid' };
    renderModal();
    modal.querySelector('#edit-title').focus();
    return;
  }
  const changes = {},
    base = {};
  for (const key of ['title', 'authors', 'publisher', 'publishedDate', 'isbn', 'cover']) {
    const v = key === 'cover' ? draft[key] : draft[key].trim();
    if (v !== b[key]) {
      changes[key] = v;
      base[key] = b[key];
    }
  }
  if (!Object.keys(changes).length) {
    hideModal();
    return;
  }
  // The same rule as the add-book screen: the same ISBN, or a title no more than a typo away.
  const possible = state.books.find((item) => item.id !== b.id && sameBook(draft, item));
  if (possible && !m.duplicate && (changes.title || changes.isbn || changes.authors)) {
    m.duplicate = possible;
    renderModal();
    return;
  }
  m.busy = true;
  renderModal();
  await patchBook(b, changes, base, () => {
    hideModal();
    notify(t('editSaved'));
  });
  m.busy = false;
  if (state.modal === m) renderModal();
}
document.addEventListener('submit', async (e) => {
  if (e.target.id === 'login') {
    e.preventDefault();
    await login(e.target);
  }
  if (e.target.id === 'edit-form') {
    e.preventDefault();
    await submitEdit();
  }
  if (e.target.id === 'lend-form') {
    e.preventDefault();
    const m = state.modal,
      b = state.book;
    if (m?.kind !== 'lend' || m.busy || !b) return;
    const to = m.to.trim(),
      at = m.at || localDay();
    if (!to || at > localDay()) {
      m.error = { code: 'invalid' };
      renderModal();
      modal.querySelector(to ? '#lend-at' : '#lend-to').focus();
      return;
    }
    m.busy = true;
    renderModal();
    await patchBook(b, { lentTo: to, lentAt: at }, { lentTo: b.lentTo, lentAt: b.lentAt }, () => {
      hideModal();
      notify(t('lentSaved'));
    });
    m.busy = false;
    if (state.modal === m) renderModal();
  }
  if (e.target.id === 'note-form') {
    e.preventDefault();
    if (!state.note) return;
    const { value, base } = state.note;
    main.querySelector('#save-note').disabled = true;
    await patchBook(state.book, { note: value }, { note: base }, (b) => {
      const draftValue = state.note?.value;
      state.note = { base: b.note, value: draftValue === value ? b.note : (draftValue ?? b.note) };
      notify(t('noteSaved'));
    });
    if (state.page === 'detail' && main.querySelector('#save-note'))
      main.querySelector('#save-note').disabled = state.note.value === state.note.base;
  }
});
async function perform(action, el) {
  switch (action) {
    case 'home':
      returnHome();
      break;
    case 'parent':
      go('/parent');
      break;
    case 'add':
      go('/add');
      break;
    case 'wishlist':
      go('/wishlist');
      break;
    case 'wish-add':
      go('/wishlist/add');
      break;
    case 'lend':
      openModal({ kind: 'lend', to: '', at: localDay(), error: null });
      modal.querySelector('#lend-to')?.focus();
      break;
    case 'returned': {
      const b = state.book;
      el.disabled = true;
      await patchBook(b, { lentTo: '', lentAt: '' }, { lentTo: b.lentTo, lentAt: b.lentAt }, () => notify(t('returnedSaved')));
      break;
    }
    case 'got-it': {
      const b = state.book;
      el.disabled = true;
      await patchBook(b, { wanted: false }, { wanted: true }, () => notify(t('gotItSaved')));
      if (el.isConnected) el.disabled = false;
      break;
    }
    case 'rate': {
      // Choosing the current rating again removes it.
      const b = state.book,
        chosen = Number(el.dataset.rate),
        rating = b.rating === chosen ? 0 : chosen;
      await patchBook(b, { rating }, { rating: b.rating });
      main.querySelector('[data-rate="' + chosen + '"]')?.focus();
      break;
    }
    case 'retry':
      await boot();
      break;
    case 'logout':
      await api('/logout', 'POST', {});
      privateReset();
      go('/', { replace: true });
      break;
    case 'show-password': {
      const input = main.querySelector('#password');
      loginDraft.visible = !loginDraft.visible;
      input.type = loginDraft.visible ? 'text' : 'password';
      el.setAttribute('aria-label', t(loginDraft.visible ? 'hide' : 'show'));
      el.innerHTML = icon(loginDraft.visible ? 'hide' : 'eye');
      break;
    }
    case 'clear':
      state.filters = { ...defaults(), sort: wishing() && state.filters.sort === 'finished' ? 'tAsc' : state.filters.sort };
      state.pageIndex = 0;
      renderCatalog();
      main.querySelector('#search').focus();
      break;
    case 'share':
      openModal({ kind: 'share' });
      break;
    case 'copy': {
      const input = modal.querySelector('#share-url');
      try {
        await navigator.clipboard.writeText(input.value);
        notify(t('copied'));
      } catch {
        input.select();
        if (document.execCommand('copy')) notify(t('copied'));
        else notify(t('manualCopy'));
      }
      break;
    }
    case 'edit': {
      const original = { ...state.book };
      openModal({ kind: 'edit', original, draft: { ...original }, error: null });
      // A private deep link may open a book without visiting the catalog first.
      try {
        const { books } = await api('/books');
        if (state.user) state.books = books;
      } catch {
        /* Saving remains possible with the current details. */
      }
      break;
    }
    case 'remove-cover':
      state.modal.draft.cover = null;
      renderModal();
      break;
    case 'choose-web-cover': {
      const m = state.modal;
      if (m?.kind !== 'edit' || m.busy) break;
      let choices = m.original.coverOptions || [];
      if (m.draft.cover && !choices.some(c => c.cover === m.draft.cover)) choices = [{ cover: m.draft.cover }, ...choices];
      const chosen = choices[Number(el.dataset.choice)];
      if (chosen) { m.draft.cover = chosen.cover; refreshCoverPicker(); }
      break;
    }
    case 'find-covers': {
      const m = state.modal;
      if (m?.kind !== 'edit' || m.busy) break;
      el.disabled = true;
      try {
        const { book } = await api('/books/' + encoded(m.original.id) + '/cover-lookup', 'POST', {});
        if (state.modal !== m) break;
        putBook(book);
        m.original = { ...m.original, coverOptions: book.coverOptions, coverLookup: book.coverLookup };
        refreshCoverPicker();
      } catch (err) {
        if (state.modal === m) { m.error = err; renderModal(); }
      }
      break;
    }
    case 'page-prev':
    case 'page-next': {
      state.pageIndex += action === 'page-next' ? 1 : -1;
      updateResults();
      main.querySelector('.catalog-tools').scrollIntoView({ block: 'start' });
      const same = main.querySelector('[data-action="' + action + '"]');
      (same?.disabled ? main.querySelector('.pager .ui-btn:not([disabled])') : same)?.focus({ preventScroll: true });
      break;
    }
    case 'select-mode':
      state.picked = new Set();
      updateResults();
      main.querySelector('[data-action="select-all"],[data-action="select-none"]')?.focus();
      break;
    case 'select-done':
      state.picked = null;
      updateResults();
      main.querySelector('[data-action="select-mode"]')?.focus();
      break;
    case 'select-all':
    case 'select-none':
      // "All" means every book that matches the current search and filters, on every page.
      if (action === 'select-none') state.picked.clear();
      else if (!listFilters().dupes) for (const b of visibleBooks(listed(), listFilters(), state.lang)) state.picked.add(b.id);
      updateResults();
      main.querySelector('[data-action="' + (action === 'select-all' ? 'delete-selected' : 'select-all') + '"]')?.focus();
      break;
    case 'delete-selected': {
      const chosen = visibleBooks(listed(), { ...defaults(), sort: state.filters.sort }, state.lang)
        .filter((b) => state.picked?.has(b.id));
      if (!chosen.length) break;
      openModal({ kind: 'bulk-delete', ids: chosen.map((b) => b.id), titles: chosen.slice(0, 5).map((b) => b.title),
        total: chosen.length, done: 0, kept: 0 });
      break;
    }
    case 'confirm-bulk-delete': {
      const m = state.modal;
      if (m?.kind !== 'bulk-delete' || m.busy) break;
      m.busy = true;
      m.error = null;
      renderModal();
      let failed = false;
      while (m.ids.length && state.modal === m) {
        const chunk = m.ids.slice(0, 20);
        const rows = state.books.filter((b) => chunk.includes(b.id)).map((b) => ({ id: b.id, version: b.version }));
        try {
          if (rows.length) {
            const result = await api('/books/delete', 'POST', { books: rows });
            const gone = new Set(result.deleted);
            state.books = state.books.filter((b) => !gone.has(b.id));
            for (const book of result.conflicts) putBook(book);
            for (const row of rows) state.picked?.delete(row.id);
            m.done += result.deleted.length;
            m.kept += result.conflicts.length;
          }
          m.ids = m.ids.slice(chunk.length);
          if (state.modal === m) renderModal();
        } catch (err) {
          failed = true;
          m.busy = false;
          m.error = err;
          if (state.modal === m) renderModal();
          break;
        }
      }
      if (!state.user) break;
      const stopped = m.ids.length > 0;
      if (!failed && state.modal === m) hideModal();
      if (!stopped) state.picked = null;
      if (listPage()) renderCatalog();
      if (!failed)
        notify([m.done ? deletedMany(m.done, state.lang) : '', m.kept ? keptChanged(m.kept, state.lang) : '',
          stopped ? t('deleteStopped') : ''].filter(Boolean).join(' '));
      break;
    }
    case 'shelf-photo':
      if (state.book?.shelfPhoto) openModal({ kind: 'shelf-photo', photo: state.book.shelfPhoto, title: state.book.title });
      break;
    case 'delete':
      openModal({ kind: 'delete', book: { ...state.book } });
      break;
    case 'confirm-delete': {
      const m = state.modal;
      el.disabled = true;
      try {
        await api('/books/' + encoded(m.book.id), 'DELETE', { version: m.book.version });
        hideModal();
        notify(t('deleted'));
        if (m.book.wanted) go('/wishlist');
        else returnHome();
      } catch (err) {
        if (err.code === 'conflict') {
          hideModal();
          await route();
          notify(t('deleteStale'));
        } else {
          m.error = err;
          renderModal();
        }
      }
      break;
    }
    case 'close': {
      const previous = state.modal?.kind === 'conflict' ? state.modal.previous : null;
      hideModal();
      if (previous) {
        previous.busy = false;
        openModal(previous);
      }
      break;
    }
    case 'conflict-new': {
      const m = state.modal;
      putBook(m.current);
      if (state.note && Object.hasOwn(m.changes, 'note'))
        state.note = { base: m.current.note, value: m.current.note };
      hideModal();
      redrawCurrent();
      break;
    }
    case 'conflict-mine': {
      const m = state.modal;
      el.disabled = true;
      const base = {};
      for (const key of Object.keys(m.changes)) base[key] = m.current[key];
      await patchBook(m.current, m.changes, base, (book) => {
        hideModal();
        m.onSaved?.(book);
      });
      break;
    }
    case 'fav-book':
    case 'read-book': {
      const key = action === 'fav-book' ? 'favorite' : 'read',
        b = state.book;
      el.disabled = true;
      // A book just read is finished today, by the reader's own calendar.
      if (key === 'read' && !b.read)
        await patchBook(b, { read: true, finishedAt: localDay() }, { read: false, finishedAt: b.finishedAt });
      else await patchBook(b, { [key]: !b[key] }, { [key]: b[key] });
      if (el.isConnected) el.disabled = false;
      break;
    }
  }
}
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-lang],[data-action],[data-book-id],[data-pick-id],[data-fav-id],[data-filter]');
  if (!el) return;
  if (el.tagName === 'A' && (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey)) return;
  e.preventDefault();
  try {
    if (el.dataset.lang) {
      await changeLang(el.dataset.lang);
      return;
    }
    if (el.dataset.bookId) {
      go('/library/' + encoded(el.dataset.bookId));
      return;
    }
    if (el.dataset.pickId) {
      if (!state.picked) return;
      const id = el.dataset.pickId;
      if (!state.picked.delete(id)) state.picked.add(id);
      el.setAttribute('aria-checked', state.picked.has(id));
      paintPicked();
      return;
    }
    if (el.dataset.favId) {
      const b = state.books.find((x) => x.id === el.dataset.favId);
      if (!b) return;
      el.disabled = true;
      await patchBook(b, { favorite: !b.favorite }, { favorite: b.favorite });
      if (el.isConnected) el.disabled = false;
      return;
    }
    if (el.dataset.filter) {
      const key = el.dataset.filter,
        f = state.filters;
      if (key === 'all') {
        f.read = '';
        f.fav = false;
        f.cover = '';
        f.shelf = '';
        f.lent = false;
        f.dupes = false;
      } else if (key === 'fav') {
        f.fav = !f.fav;
      } else if (key === 'lent') {
        f.lent = !f.lent;
      } else if (key === 'dupes') {
        f.dupes = !f.dupes;
      } else if (key === 'with' || key === 'without') {
        f.cover = f.cover === key ? '' : key;
      } else {
        f.read = f.read === key ? '' : key;
      }
      state.pageIndex = 0;
      updateResults();
      main.querySelector('[data-filter="' + key + '"]')?.focus();
      return;
    }
    await perform(el.dataset.action, el);
  } catch (err) {
    notify(errorText(err));
  }
});
async function boot() {
  try {
    const isPublic = /^\/(?:books|wishlist)\/[^/]+\/?$/.test(location.pathname) && !location.pathname.startsWith('/wishlist/add');
    let user;
    try {
      ({ user } = await api('/me'));
    } catch (err) {
      if (!isPublic) throw err;
      user = null;
    }
    state.user = user;
    // A new local library says so on its sign-in page, for whoever opened it without the link.
    setupPending = false;
    if (!user && localHost && !isPublic) {
      try {
        setupPending = (await api('/setup')).pending === true;
      } catch {
        /* An older or deployed library has no set-up screen. */
      }
    }
    if (user?.language) {
      state.lang = localeChoice(user.language, navigator.languages);
      saveGuestLanguage(state.lang);
    }
    await route();
  } catch (err) {
    setPage('offline');
    main.removeAttribute('aria-busy');
    errorPanel(err);
  }
}
boot();
