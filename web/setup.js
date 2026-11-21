// The set-up screen of a library on your own computer: the two accounts, then the optional
// services, one step at a time. It is opened by the one-time link that `npm start` prints, and
// every request it makes carries that link's token (added by the `api` it is given).
import { el, failureNote, serviceCard, serviceCopy, stateText } from './services.js';

const steps = ['accounts', 'photos', 'covers', 'ready'];
const servicesOf = { photos: ['recognition', 'textDetection'], covers: ['googleBooks', 'braveSearch'] };

export function mountSetup(root, { lang: initial, api, done, signIn }) {
  let lang = initial,
    alive = true,
    busy = false,
    info = null,
    gone = false,
    step = 0,
    error = '',
    moved = false;
  const account = { parent: null, parentPassword: '', child: null, childPassword: '', show: false };
  const drafts = {},
    notes = {};
  const tr = (ro, en) => (lang === 'ro' ? ro : en);
  const button = (text, action, kind = '') => {
    const b = el('button', text, 'ui-btn ' + kind);
    b.type = 'button';
    b.disabled = busy;
    b.onclick = action;
    return b;
  };
  const errorText = () =>
    ({
      '': '',
      username: tr(
        'Un nume are între 1 și 48 de litere fără diacritice, cifre, puncte, liniuțe sau liniuțe de subliniere.',
        'A name has 1 to 48 letters without accents, digits, dots, dashes or underscores.',
      ),
      sameUsername: tr('Alege două nume diferite.', 'Choose two different names.'),
      passwordLength: tr(
        'Fiecare parolă trebuie să aibă între 10 și 128 de caractere.',
        'Each password must have 10 to 128 characters.',
      ),
      usernameFixed: tr(
        'Numele sunt stabilite din terminal sau din fișierul .env și nu pot fi schimbate aici.',
        'The names are set in the shell or in the .env file and cannot be changed here.',
      ),
    })[error] ?? tr('Operațiunea a eșuat. Încearcă din nou.', 'That did not work. Try again.');
  async function work(fn) {
    if (busy) return;
    busy = true;
    error = '';
    render();
    try {
      await fn();
    } catch (e) {
      // The link is refused once set-up is finished or the library was started again.
      if (e.status === 401 || e.status === 404) gone = true;
      else error = e.code || 'fail';
    } finally {
      busy = false;
      render();
    }
  }
  function go(next) {
    step = next;
    error = '';
    moved = true;
    render();
  }
  const load = () =>
    work(async () => {
      info = await api('/state');
    });
  function saveAccounts() {
    const names = { parent: account.parent ?? info.accounts.parent.username, child: account.child ?? info.accounts.child.username };
    const valid = (name) => /^[a-zA-Z0-9_.-]{1,48}$/.test(name);
    if (!valid(names.parent.trim()) || !valid(names.child.trim())) error = 'username';
    else if (names.parent.trim().toLowerCase() === names.child.trim().toLowerCase()) error = 'sameUsername';
    else if ([account.parentPassword, account.childPassword].some((p) => p.length < 10 || p.length > 128))
      error = 'passwordLength';
    else error = '';
    if (error) return render();
    return work(async () => {
      await api('/accounts', 'POST', {
        parent: { username: names.parent.trim(), password: account.parentPassword },
        child: { username: names.child.trim(), password: account.childPassword },
      });
      account.parentPassword = account.childPassword = '';
      account.parent = account.child = null;
      info = await api('/state');
      step = 1;
      moved = true;
    });
  }
  const sendService = (id, body, outcome) =>
    work(async () => {
      try {
        ({ services: info.services } = await api('/services', 'POST', { service: id, ...body }));
        notes[id] = outcome;
        delete drafts[id];
      } catch (e) {
        if (e.status === 401 || e.status === 404) throw e;
        notes[id] = failureNote(e);
      }
    });
  function accountsStep(box) {
    const a = info.accounts;
    box.append(
      el(
        'p',
        tr(
          'Biblioteca are două conturi: unul pentru părinte, care poate și șterge cărți și schimba setările, și unul pentru copil. Alege numele și parolele lor.',
          'The library has two accounts: one for the parent, who can also delete books and change settings, and one for the child. Choose their names and passwords.',
        ),
      ),
    );
    const form = el('form', undefined, 'setup-accounts');
    form.noValidate = true;
    const passwords = [];
    for (const [role, title] of [
      ['parent', tr('Părinte', 'Parent')],
      ['child', tr('Copil', 'Child')],
    ]) {
      const group = el('fieldset');
      group.append(el('legend', title));
      const name = el('input');
      name.autocomplete = 'off';
      name.autocapitalize = 'none';
      name.spellcheck = false;
      name.maxLength = 48;
      name.value = account[role] ?? a[role].username;
      name.disabled = busy || a[role].fixed;
      name.oninput = () => (account[role] = name.value);
      const password = el('input');
      password.type = account.show ? 'text' : 'password';
      password.autocomplete = 'new-password';
      password.minLength = 10;
      password.maxLength = 128;
      password.value = account[role + 'Password'];
      password.disabled = busy;
      password.oninput = () => (account[role + 'Password'] = password.value);
      passwords.push(password);
      const nameLabel = el('label', tr('Nume de utilizator', 'Username'));
      nameLabel.append(name);
      const passwordLabel = el('label', tr('Parolă (minimum 10 caractere)', 'Password (at least 10 characters)'));
      passwordLabel.append(password);
      group.append(nameLabel, passwordLabel);
      form.append(group);
    }
    const show = el('input');
    show.type = 'checkbox';
    show.checked = account.show;
    show.onchange = () => {
      account.show = show.checked;
      for (const password of passwords) password.type = account.show ? 'text' : 'password';
    };
    const showLabel = el('label', tr('Arată parolele', 'Show passwords'), 'check');
    showLabel.prepend(show);
    const problem = el('p', errorText(), 'form-error');
    problem.setAttribute('role', 'alert');
    problem.hidden = !error;
    const save = el('button', tr('Salvează și continuă', 'Save and continue'), 'ui-btn primary');
    save.type = 'submit';
    save.disabled = busy;
    const actions = el('div', undefined, 'setup-actions');
    actions.append(
      save,
      button(
        a.chosen ? tr('Păstrează parolele actuale', 'Keep the current passwords') : tr('Păstrează parolele generate', 'Keep the generated passwords'),
        () => go(1),
      ),
    );
    form.append(
      showLabel,
      el(
        'p',
        tr(
          'Păstrează parolele într-un manager de parole: biblioteca nu le salvează în clar. Salvarea încheie sesiunile deja deschise.',
          'Keep the passwords in a password manager: the library does not store them in readable form. Saving ends any session that is already open.',
        ),
      ),
      problem,
      actions,
    );
    if (!a.chosen)
      form.append(
        el(
          'p',
          tr('Parolele generate la prima pornire sunt în fișierul: ', 'The passwords generated on the first start are in the file: ') + a.file,
          'setup-file',
        ),
      );
    form.onsubmit = (event) => {
      event.preventDefault();
      saveAccounts();
    };
    box.append(form);
  }
  function servicesStep(box, name) {
    box.append(
      el(
        'p',
        name === 'photos'
          ? tr(
              'Opțional. Ai nevoie de un abonament Azure al tău. Poți sări peste acest pas și reveni oricând din Setările familiei.',
              'Optional. You need an Azure subscription of your own. You can skip this step and come back at any time from Family settings.',
            )
          : tr(
              'Opțional. Open Library este folosită fără nicio cheie; cheile de mai jos adaugă alte surse. Poți sări peste acest pas și reveni oricând din Setările familiei.',
              'Optional. Open Library is used without any key; the keys below add more sources. You can skip this step and come back at any time from Family settings.',
            ),
      ),
    );
    for (const id of servicesOf[name]) {
      const service = info.services.find((s) => s.id === id);
      box.append(
        serviceCard(service, {
          tr,
          busy,
          draft: (drafts[id] ??= {}),
          note: notes[id],
          save: (values) => sendService(id, { values }, 'saved'),
          remove: () => sendService(id, { remove: true }, 'removed'),
        }),
      );
    }
    const actions = el('div', undefined, 'setup-actions');
    actions.append(button(tr('Continuă', 'Continue'), () => go(step + 1), 'primary'), button(tr('Înapoi', 'Back'), () => go(step - 1)));
    box.append(actions);
  }
  function readyStep(box) {
    const a = info.accounts;
    box.append(
      el(
        'p',
        a.chosen
          ? tr('Conturile sunt pregătite: ', 'The accounts are ready: ') + a.parent.username + ', ' + a.child.username + '.'
          : tr('Conturile folosesc parolele generate, din fișierul: ', 'The accounts use the generated passwords, in the file: ') + a.file,
      ),
    );
    const list = el('ul', undefined, 'setup-summary');
    for (const service of info.services) {
      const item = el('li', serviceCopy(service.id, tr).title);
      item.append(el('span', stateText(service, tr), 'service-state' + (service.state === 'set' ? ' is-set' : '')));
      list.append(item);
    }
    box.append(
      list,
      el(
        'p',
        tr(
          'Poți adăuga sau schimba cheile oricând, din Setările familiei. După ce deschizi biblioteca, acest link de configurare nu mai funcționează.',
          'You can add or change keys at any time, in Family settings. Once you open the library, this set-up link stops working.',
        ),
      ),
    );
    const problem = el('p', errorText(), 'form-error');
    problem.setAttribute('role', 'alert');
    problem.hidden = !error;
    const actions = el('div', undefined, 'setup-actions');
    actions.append(
      button(
        tr('Deschide biblioteca', 'Open the library'),
        () =>
          work(async () => {
            const { username } = await api('/finish', 'POST', {});
            alive = false;
            done(username);
          }),
        'primary',
      ),
      button(tr('Înapoi', 'Back'), () => go(step - 1)),
    );
    box.append(problem, actions);
  }
  function render() {
    if (!alive) return;
    const box = el('div', undefined, 'parent-panel setup-panel');
    if (gone) {
      box.append(
        el('h1', tr('Linkul de configurare nu mai funcționează', 'This set-up link no longer works')),
        el(
          'p',
          tr(
            'Linkul funcționează o singură dată, cât timp biblioteca rulează. Dacă ai terminat configurarea, intră în bibliotecă. Pentru un link nou, pornește biblioteca astfel: npm start -- --setup',
            'The link works once, while the library is running. If you have finished setting up, sign in. For a new link, start the library with: npm start -- --setup',
          ),
        ),
        button(tr('Mergi la autentificare', 'Go to sign-in'), signIn, 'primary'),
      );
      root.replaceChildren(box);
      return;
    }
    box.append(el('h1', tr('Pregătește biblioteca', 'Set up your library')));
    if (!info) {
      box.append(busy ? el('p', tr('Se încarcă…', 'Loading…')) : button(tr('Încearcă din nou', 'Try again'), load));
      root.replaceChildren(box);
      return;
    }
    const titles = [
      tr('Conturi', 'Accounts'),
      tr('Fotografii', 'Photos'),
      tr('Coperte', 'Covers'),
      tr('Gata', 'Ready'),
    ];
    const progress = el('ol', undefined, 'setup-steps');
    titles.forEach((title, index) => {
      const item = el('li', title);
      if (index === step) item.setAttribute('aria-current', 'step');
      if (index < step) item.className = 'is-done';
      progress.append(item);
    });
    const heading = el(
      'h2',
      [
        tr('Conturile familiei', 'The two accounts'),
        tr('Adăugarea din fotografii', 'Adding books from photos'),
        tr('Coperte și verificarea titlurilor', 'Covers and title checks'),
        tr('Totul este pregătit', 'Everything is ready'),
      ][step],
    );
    heading.tabIndex = -1;
    const body = el('section', undefined, 'parent-section');
    body.append(heading);
    if (steps[step] === 'accounts') accountsStep(body);
    else if (steps[step] === 'ready') readyStep(body);
    else servicesStep(body, steps[step]);
    box.append(progress, body);
    root.replaceChildren(box);
    // A new step starts at its heading, for the keyboard and for screen readers.
    if (moved) {
      moved = false;
      heading.focus();
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  }
  load();
  return {
    setLanguage(next) {
      lang = next;
      render();
    },
    destroy() {
      alive = false;
      account.parentPassword = account.childPassword = '';
    },
  };
}
