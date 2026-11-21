// Parent-only UI. The server independently enforces this role on every operation.
export function mountParent(root, { lang: initial, user, api, done }) {
  let lang = initial,
    state = null,
    alive = true,
    busy = false,
    account = '',
    secret = '',
    own = '',
    cost = '',
    file = null,
    photos = [],
    doomed = null,
    // The service forms exist only for a library on your own computer, and are loaded only there.
    forms = null;
  let message = null;
  const drafts = {},
    notes = {};
  const tr = (ro, en) => (lang === 'ro' ? ro : en);
  const el = (tag, text, cls) => {
    const x = document.createElement(tag);
    if (text !== undefined) x.textContent = text;
    if (cls) x.className = cls;
    return x;
  };
  const money = (value) =>
    new Intl.NumberFormat(lang === 'ro' ? 'ro-RO' : 'en-GB', {
      style: 'currency',
      currency: 'USD',
    }).format(value);
  const button = (text, action, kind = '') => {
    const b = el('button', text, 'ui-btn ' + kind);
    b.type = 'button';
    b.disabled = busy;
    b.onclick = action;
    return b;
  };
  function label(text, input) {
    const l = el('label', text);
    l.append(input);
    return l;
  }
  function section(parent, name) {
    const s = el('section', undefined, 'parent-section');
    s.append(el('h2', name));
    parent.append(s);
    return s;
  }
  function messageText() {
    if (!message) return '';
    const [key, num] = message;
    const dictionary = {
      saved: tr('Modificările au fost salvate.', 'Changes saved.'),
      reset: tr(
        'Parola a fost schimbată. Autentifică-te din nou dacă ai schimbat parola ta.',
        'Password changed. Sign in again if you changed your own password.',
      ),
      fail: tr(
        'Operațiunea a eșuat. Verifică datele și încearcă din nou.',
        'The operation failed. Check the details and try again.',
      ),
      invalid: tr('Verifică fișierul sau valoarea introdusă.', 'Check the file or the value entered.'),
      session: tr(
        'Sesiunea a expirat. Autentifică-te din nou.',
        'Your session has expired. Please sign in again.',
      ),
      wrongCurrent: tr(
        'Parola ta actuală nu este corectă. Parola nu a fost schimbată.',
        'Your current password is not correct. The password was not changed.',
      ),
      exported: tr('Copia de siguranță a fost descărcată.', 'Backup downloaded.'),
      photoDeleted: tr('Fotografia raftului a fost ștearsă.', 'Shelf photo deleted.'),
      wishOn: tr('Lista de dorințe are acum un link public.', 'The wishlist now has a public link.'),
      wishOff: tr('Linkul listei de dorințe a fost oprit.', 'The wishlist link was switched off.'),
      wishRenewed: tr(
        'Lista de dorințe are un link nou. Cel vechi nu mai funcționează.',
        'The wishlist has a new link. The old one no longer works.',
      ),
      copied: tr('Link copiat.', 'Link copied.'),
      copyManually: tr('Selectează și copiază linkul.', 'Select and copy the link.'),
      progress: tr('Cărți procesate', 'Books processed') + ' · ' + num,
      restored:
        tr('Restaurare finalizată. Cărți procesate', 'Restore finished. Books processed') + ' · ' + num,
      partial:
        tr('Restaurarea s-a oprit. Cărți procesate', 'Restore stopped. Books processed') +
        ' · ' +
        num +
        '. ' +
        tr('Poți relua cu același fișier.', 'You can retry with the same file.'),
    };
    return dictionary[key] || dictionary.fail;
  }
  async function work(fn) {
    if (busy) return;
    busy = true;
    message = null;
    render();
    try {
      await fn();
    } catch (e) {
      if (!message || message[0] !== 'partial')
        message = [e.status === 401 ? 'session' : e.code === 'invalid' ? 'invalid' : 'fail'];
    } finally {
      busy = false;
      render();
    }
  }
  async function refresh() {
    state = await api('/admin/settings');
    ({ photos } = await api('/shelf-photos'));
    if (state.services) forms ??= await import('./services.js');
    if (!account) account = state.users.find((u) => u.role === 'child')?.username || user.username;
  }
  function progress(n) {
    message = ['progress', n];
    const p = root.querySelector('[data-feedback]');
    if (p) p.textContent = messageText();
  }
  async function imageData(url) {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok || !response.headers.get('content-type')?.startsWith('image/jpeg')) throw Error();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      response.blob().then((blob) => reader.readAsDataURL(blob), reject);
    });
  }
  async function exportBooks() {
    const { books } = await api('/books');
    const kept = (await api('/shelf-photos')).photos;
    // Version 4: shelf photos first, each on a line of its own, then the books.
    const parts = [
      JSON.stringify({ format: 'family-library', version: 4, count: books.length, photos: kept.length }) + '\n',
    ];
    for (const photo of kept)
      parts.push(
        new Blob([
          JSON.stringify({ type: 'shelf-photo', id: photo.id, at: photo.at, data: await imageData(photo.url) }) + '\n',
        ]),
      );
    let n = 0;
    for (const b of books) {
      const row = {
        id: b.id,
        title: b.title,
        authors: b.authors,
        isbn: b.isbn,
        publisher: b.publisher,
        publishedDate: b.publishedDate,
        note: b.note,
        read: b.read,
        favorite: b.favorite,
        finishedAt: b.finishedAt,
        rating: b.rating,
        lentTo: b.lentTo,
        lentAt: b.lentAt,
        wanted: b.wanted,
        createdAt: b.createdAt,
        catalogSource: b.catalogSource,
        shelfPhoto: b.shelfPhoto?.id,
        shelfPlace: b.shelfPhoto?.place || undefined,
      };
      const provenance = c => c ? { source: c.source, sourceId: c.sourceId, sourceUrl: c.sourceUrl } : undefined;
      if (b.cover) {
        row.coverData = await imageData(b.cover);
        row.coverProvenance = provenance(b.coverOptions?.find(c => c.cover === b.cover));
      }
      row.alternateCovers = [];
      for (const option of (b.coverOptions || []).filter(c => c.cover !== b.cover).slice(0,3)) {
        row.alternateCovers.push({ data: await imageData(option.cover), ...provenance(option) });
      }
      parts.push(new Blob([JSON.stringify(row) + '\n']));
      progress(++n);
    }
    const url = URL.createObjectURL(new Blob(parts, { type: 'application/x-ndjson' }));
    const a = el('a');
    a.href = url;
    a.download = 'pince-backup-' + new Date().toISOString().slice(0, 10) + '.ndjson';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    message = ['exported'];
  }
  async function restoreBooks(source) {
    if (!source || source.size > 1_000_000_000) {
      message = ['invalid'];
      return;
    }
    let n = 0,
      count = null,
      photoCount = 0,
      seenPhotos = 0,
      parsed = 0,
      buffer = '',
      batchBytes = 0;
    let batch = [];
    const ids = new Set(),
      photoIds = new Set();
    const encoder = new TextEncoder();
    async function flush() {
      if (!batch.length) return;
      if (!alive) throw Error();
      await api('/admin/restore', 'POST', { books: batch });
      n += batch.length;
      batch = [];
      batchBytes = 0;
      progress(n);
    }
    async function line(text) {
      if (!text.trim()) return;
      if (text.length > 8_800_000) throw Error();
      const row = JSON.parse(text);
      if (count === null) {
        if (
          row.format !== 'family-library' ||
          ![1, 2, 3, 4].includes(row.version) ||
          !Number.isSafeInteger(row.count) ||
          row.count < 0 ||
          (row.photos !== undefined &&
            (row.version < 4 || !Number.isSafeInteger(row.photos) || row.photos < 0))
        )
          throw Error();
        count = row.count;
        photoCount = row.photos || 0;
        return;
      }
      if (row.type === 'shelf-photo') {
        // Photos come before the books that point at them, one request each.
        if (parsed || seenPhotos >= photoCount || typeof row.id !== 'string' || photoIds.has(row.id))
          throw Error();
        photoIds.add(row.id);
        seenPhotos++;
        if (!alive) throw Error();
        await api('/admin/restore', 'POST', { photos: [row] });
        return;
      }
      if (parsed >= count || typeof row.id !== 'string' || ids.has(row.id)) throw Error();
      ids.add(row.id);
      parsed++;
      const bytes = encoder.encode(text).byteLength + 1;
      if (batch.length && (batch.length >= 20 || batchBytes + bytes > 5_000_000)) await flush();
      batch.push(row);
      batchBytes += bytes;
    }
    const reader = source.stream().pipeThrough(new TextDecoderStream()).getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += value;
        let pos;
        while ((pos = buffer.indexOf('\n')) !== -1) {
          await line(buffer.slice(0, pos));
          buffer = buffer.slice(pos + 1);
        }
        if (buffer.length > 8_800_000) throw Error();
      }
      if (buffer) await line(buffer);
      if (count !== parsed || photoCount !== seenPhotos) throw Error();
      await flush();
      message = ['restored', n];
      file = null;
    } catch (e) {
      message = ['partial', n];
      throw e;
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  function render() {
    if (!alive) return;
    const box = el('div', undefined, 'parent-panel');
    box.append(
      button(tr('Înapoi la bibliotecă', 'Back to library'), done),
      el('h1', tr('Setările familiei', 'Family settings')),
    );
    const status = el('p', messageText(), 'feedback');
    status.dataset.feedback = '';
    status.setAttribute('role', 'status');
    box.append(status);
    if (!state) {
      if (!message) box.append(el('p', tr('Se încarcă…', 'Loading…')));
      else box.append(button(tr('Încearcă din nou', 'Try again'), () => work(refresh)));
      root.replaceChildren(box);
      return;
    }
    const s = section(box, tr('Fotografii și buget', 'Photo recognition and budget')),
      u = state.usage;
    const metrics = el('div', undefined, 'parent-metrics');
    for (const [value, title] of [
      [u.totalMonth, tr('Estimare lunară', 'Estimated this month')],
      [u.totalYear, tr('Estimare pe 12 luni', 'Estimated over 12 months')],
    ]) {
      const m = el('div');
      m.append(el('strong', money(value)), document.createTextNode(title));
      metrics.append(m);
    }
    s.append(
      metrics,
      el(
        'p',
        tr('Recunoaștere foto în luna curentă', 'Photo recognition this month') +
          ' · ' +
          money(u.month) +
          ' / ' +
          money(1.5),
      ),
    );
    const toggle = el('input');
    toggle.type = 'checkbox';
    toggle.checked = u.enabled;
    toggle.disabled = busy || !u.configured;
    toggle.onchange = () =>
      work(async () => {
        await api('/admin/settings', 'PATCH', { enabled: toggle.checked });
        await refresh();
        message = ['saved'];
      });
    const toggleLabel = label(tr('Recunoaștere din fotografii', 'Photo recognition'), toggle);
    toggleLabel.className = 'check';
    s.append(toggleLabel);
    if (!u.configured)
      s.append(
        el(
          'p',
          tr(
            'Poți adăuga fotografii și completa titlurile manual. Pentru recunoaștere automată, configurează modelul în Azure.',
            'You can attach photos and enter titles by hand. Configure the Azure model to enable recognition.',
          ) + (state.services ? ' ' + tr('Adaugă cheia lui mai jos, la Servicii.', 'Add its key below, under Services.') : ''),
        ),
      );
    s.append(
      el(
        'p',
        tr(
          'Estimarea include rezerva Azure și taxele configurate. Pentru actualizare, introdu costul Azure fără model și fără taxe din luna curentă.',
          'The estimate includes the Azure allowance and configured tax. To update it, enter this month’s Azure cost excluding the model and tax.',
        ),
      ),
    );
    const amount = el('input');
    amount.type = 'number';
    amount.min = '0';
    amount.step = '.01';
    amount.value = cost;
    amount.placeholder = u.monthlyBase.toFixed(2);
    amount.oninput = () => (cost = amount.value);
    const f = el('div', undefined, 'parent-fields');
    f.append(
      label(tr('Cost Azure în USD', 'Azure cost in USD'), amount),
      button(tr('Actualizează', 'Update'), () =>
        work(async () => {
          if (cost === '' || !amount.checkValidity()) {
            message = ['invalid'];
            return;
          }
          await api('/admin/settings', 'PATCH', { monthlyInfrastructure: Number(cost) });
          cost = '';
          await refresh();
          message = ['saved'];
        }),
      ),
    );
    s.append(f);
    if (state.services && forms) {
      const services = section(box, tr('Servicii', 'Services'));
      services.append(
        el(
          'p',
          tr(
            'Cheile serviciilor externe sunt păstrate pe acest calculator, în dosarul bibliotecii. O cheie este verificată înainte de salvare și nu mai este afișată după aceea.',
            'Keys for outside services are kept on this computer, in the library’s folder. A key is checked before it is saved and is not shown again afterwards.',
          ),
        ),
      );
      const send = (id, body, outcome) =>
        work(async () => {
          try {
            await api('/admin/services', 'PATCH', { service: id, ...body });
            notes[id] = outcome;
            delete drafts[id];
          } catch (e) {
            if (e.status === 401) throw e;
            notes[id] = forms.failureNote(e);
          }
          // Whether recognition can be switched on depends on these settings.
          await refresh();
        });
      for (const service of state.services)
        services.append(
          forms.serviceCard(service, {
            tr,
            busy,
            draft: (drafts[service.id] ??= {}),
            note: notes[service.id],
            save: (values) => send(service.id, { values }, 'saved'),
            remove: () => send(service.id, { remove: true }, 'removed'),
          }),
        );
    }
    const a = section(box, tr('Conturile familiei', 'Family accounts'));
    const chooser = el('select');
    for (const u of state.users) {
      const o = el(
        'option',
        u.username + ' · ' + (u.role === 'parent' ? tr('Părinte', 'Parent') : tr('Copil', 'Child')),
      );
      o.value = u.username;
      o.selected = u.username === account;
      chooser.append(o);
    }
    chooser.onchange = () => {
      account = chooser.value;
      secret = own = '';
      render();
    };
    const pw = el('input');
    pw.type = 'password';
    pw.autocomplete = 'new-password';
    pw.minLength = 10;
    pw.maxLength = 128;
    pw.value = secret;
    pw.oninput = () => (secret = pw.value);
    // The parent's own password, asked for whichever account is being changed.
    const mine = el('input');
    mine.type = 'password';
    mine.autocomplete = 'current-password';
    mine.maxLength = 128;
    mine.value = own;
    mine.oninput = () => (own = mine.value);
    const controls = el('div', undefined, 'parent-fields');
    controls.append(
      label(tr('Cont', 'Account'), chooser),
      label(tr('Parolă nouă (minimum 10 caractere)', 'New password (at least 10 characters)'), pw),
      label(tr('Parola ta actuală', 'Your current password'), mine),
      button(tr('Schimbă parola', 'Change password'), () =>
        work(async () => {
          if (secret.length < 10 || !own) {
            message = ['invalid'];
            return;
          }
          try {
            await api('/admin/accounts', 'PATCH', { username: account, password: secret, currentPassword: own });
          } catch (e) {
            if (e.code !== 'currentPassword') throw e;
            message = ['wrongCurrent'];
            return;
          }
          secret = own = '';
          message = ['reset'];
        }),
      ),
    );
    a.append(controls);
    if (account !== user.username) {
      const current = state.users.find((x) => x.username === account);
      a.append(
        button(
          current.enabled
            ? tr('Dezactivează contul', 'Disable account')
            : tr('Activează contul', 'Enable account'),
          () =>
            work(async () => {
              await api('/admin/accounts', 'PATCH', { username: account, enabled: !current.enabled });
              await refresh();
              message = ['saved'];
            }),
        ),
      );
    }
    const wishes = section(box, tr('Lista de dorințe', 'Wishlist'));
    const sharing = state.wishlist || { shared: false, token: null };
    wishes.append(
      el(
        'p',
        tr(
          'Poți da un link public către lista de dorințe, de exemplu bunicilor. Cine îl are vede doar titlul, autorul și coperta cărților dorite. Îl poți opri sau înlocui oricând; pagina publică a fiecărei cărți din listă rămâne însă accesibilă celor care au deschis-o.',
          'You can give out a public link to the wishlist, for example to grandparents. Whoever has it sees only the title, author and cover of the wished-for books. You can switch it off or replace it at any time; the public page of each listed book stays open to those who already opened it.',
        ),
      ),
    );
    const setSharing = (body, note) =>
      work(async () => {
        ({ wishlist: state.wishlist } = await api('/admin/wishlist', 'PATCH', body));
        message = [note];
      });
    if (sharing.shared) {
      const link = el('input');
      link.readOnly = true;
      link.value = location.origin + '/wishlist/' + sharing.token;
      link.onfocus = () => link.select();
      const row = el('div', undefined, 'parent-fields');
      const linkLabel = label(tr('Link public', 'Public link'), link);
      linkLabel.className = 'parent-link';
      row.append(
        linkLabel,
        button(tr('Copiază linkul', 'Copy link'), async () => {
          try {
            await navigator.clipboard.writeText(link.value);
            message = ['copied'];
          } catch {
            message = ['copyManually'];
          }
          render();
        }),
        button(tr('Link nou', 'New link'), () => setSharing({ shared: true, renew: true }, 'wishRenewed')),
        button(tr('Oprește linkul', 'Stop sharing'), () => setSharing({ shared: false }, 'wishOff'), 'negative'),
      );
      wishes.append(row);
    } else
      wishes.append(
        button(tr('Creează un link public', 'Create a public link'), () => setSharing({ shared: true }, 'wishOn')),
      );
    const shelves = section(box, tr('Fotografii de raft', 'Shelf photos'));
    shelves.append(el('p', tr(
      'Fiecare fotografie de raft identificată este păstrată aici, doar pentru familie. Cărțile salvate din ea trimit la ea. Ștergerea este definitivă și elimină și trimiterile.',
      'Every scanned shelf photo is kept here, for the family only. Books saved from it link back to it. Deleting is permanent and also removes those links.',
    )));
    if (!photos.length) shelves.append(el('p', tr('Nicio fotografie de raft încă.', 'No shelf photos yet.')));
    const list = el('ul', undefined, 'parent-photos');
    for (const photo of photos) {
      const item = el('li');
      const open = el('a', undefined, 'parent-photo-open');
      open.href = photo.url;
      open.target = '_blank';
      open.rel = 'noopener';
      const thumb = el('img');
      thumb.src = photo.url;
      thumb.alt = tr('Fotografie de raft', 'Shelf photo');
      thumb.loading = 'lazy';
      open.append(thumb);
      const when = new Intl.DateTimeFormat(lang === 'ro' ? 'ro-RO' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(photo.at));
      const facts = el('div');
      facts.append(el('strong', when), el('span', tr('Cărți legate', 'Linked books') + ' · ' + photo.books));
      const remove = doomed === photo.id
        ? button(tr('Șterge definitiv', 'Delete for good'), () => work(async () => {
            await api(photo.url.replace(/^\/api/, ''), 'DELETE', {});
            doomed = null;
            ({ photos } = await api('/shelf-photos'));
            message = ['photoDeleted'];
          }), 'negative')
        : button(tr('Șterge', 'Delete'), () => { doomed = photo.id; render(); });
      item.append(open, facts, remove);
      if (doomed === photo.id) item.append(button(tr('Păstrează', 'Keep'), () => { doomed = null; render(); }));
      list.append(item);
    }
    if (photos.length) shelves.append(list);
    const b = section(box, tr('Copie de siguranță', 'Backup and restore'));
    b.append(
      el(
        'p',
        tr(
          'Descarcă pe acest dispozitiv cărțile, copertele, notițele private și fotografiile de raft. La restaurare, cărțile și fotografiile deja existente sunt păstrate.',
          'Download the books, covers, private notes and shelf photos to this device. Restoring keeps any books and photos that already exist.',
        ),
      ),
      button(tr('Descarcă o copie', 'Download backup'), () => work(exportBooks)),
    );
    const picker = el('input');
    picker.type = 'file';
    picker.accept = '.ndjson,application/x-ndjson';
    picker.disabled = busy;
    picker.onchange = () => {
      file = picker.files[0];
      render();
    };
    const restore = button(tr('Restaurează cărțile', 'Restore books'), () =>
      work(() => restoreBooks(file)),
    );
    restore.disabled = busy || !file;
    const files = el('div', undefined, 'parent-fields');
    files.append(
      label(file?.name || tr('Alege copia de siguranță', 'Choose backup file'), picker),
      restore,
    );
    b.append(files);
    root.replaceChildren(box);
  }
  render();
  work(refresh);
  return {
    setLanguage(next) {
      lang = next;
      render();
    },
    destroy() {
      alive = false;
      secret = own = '';
    },
  };
}
