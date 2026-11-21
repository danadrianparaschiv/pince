// The optional outside services of a library on your own computer, each as one small form.
// Used by the set-up screen and by Family settings. A key typed here is sent to the library once
// and never comes back: afterwards the form only says whether the service is set.
export const el = (tag, text, cls) => {
  const x = document.createElement(tag);
  if (text !== undefined) x.textContent = text;
  if (cls) x.className = cls;
  return x;
};

/** Title, explanation and fields of one service, in the chosen language. */
export function serviceCopy(id, tr) {
  const key = tr('Cheie', 'Key');
  return {
    recognition: {
      title: tr('Recunoaștere din fotografii', 'Photo recognition'),
      about: tr(
        'Citește titlurile din fotografia unei coperte sau a unui raft, cu un model de viziune din resursa ta Azure OpenAI. Fără ea, scrii titlurile și încarci copertele. Verificarea trimite o singură cerere scurtă, care costă mai puțin de un cent. După salvare, pornește recunoașterea din Setările familiei.',
        'Reads titles from a photo of a cover or a shelf, with a vision model in your own Azure OpenAI resource. Without it you type titles and upload covers. The check sends one short request, which costs less than a cent. After saving, switch recognition on in Family settings.',
      ),
      fields: [
        ['AZURE_OPENAI_ENDPOINT', tr('Adresa resursei (endpoint)', 'Resource address (endpoint)'), 'https://….openai.azure.com'],
        ['AZURE_OPENAI_DEPLOYMENT', tr('Numele implementării modelului', 'Model deployment name'), 'gpt-5-mini'],
        ['AZURE_OPENAI_API_KEY', key],
      ],
    },
    textDetection: {
      title: tr('Detectarea textului', 'Text detection'),
      about: tr(
        'Găsește locul fiecărui titlu în fotografie, pentru decupajele de titlu și de copertă, cu resursa ta Azure AI Vision. Nivelul gratuit este suficient. Fără ea, scanările funcționează, dar fără decupaje.',
        'Finds where each title is in a photo, for the title and cover cut-outs, with your own Azure AI Vision resource. Its free tier is enough. Without it scans still work, without cut-outs.',
      ),
      fields: [
        ['AZURE_VISION_ENDPOINT', tr('Adresa resursei (endpoint)', 'Resource address (endpoint)'), 'https://….cognitiveservices.azure.com'],
        ['AZURE_VISION_KEY', key],
      ],
    },
    googleBooks: {
      title: 'Google Books',
      about: tr(
        'A doua sursă pentru verificarea titlurilor și pentru coperte, după Open Library, care nu are nevoie de cheie. Creează în Google Cloud o cheie restricționată la Books API; căutările nu au nevoie de facturare.',
        'A second source for title checks and covers, after Open Library, which needs no key. Create a key restricted to the Books API in Google Cloud; lookups need no billing.',
      ),
      fields: [['GOOGLE_BOOKS_API_KEY', tr('Cheie API', 'API key')]],
    },
    braveSearch: {
      title: tr('Căutare de imagini Brave', 'Brave image search'),
      about: tr(
        'Caută coperte pe paginile librăriilor și editurilor, pentru edițiile românești pe care cataloagele nu le au. Fiecare căutare se scade din creditul lunar Brave, iar biblioteca se oprește la 900 pe lună. Verificarea folosește o căutare.',
        'Looks for covers on bookshop and publisher pages, for the Romanian editions the catalogues lack. Each search comes out of Brave’s monthly credit, and the library stops at 900 a month. The check uses one search.',
      ),
      fields: [['BRAVE_SEARCH_API_KEY', tr('Cheie API', 'API key')]],
    },
  }[id];
}

export const stateText = (service, tr) =>
  service.state === 'set'
    ? tr('Configurat', 'Set')
    : service.state === 'partial'
      ? tr('Incomplet', 'Incomplete')
      : tr('Neconfigurat', 'Not set');

/** What to say under a form after the library refused to save it. */
export const failureNote = (error) =>
  error.code === 'serviceCheck'
    ? 'check:' + (error.data?.status ?? 0)
    : error.code === 'serviceValue'
      ? 'value:' + error.data?.name
      : ['serviceFixed', 'throttle'].includes(error.code)
        ? error.code
        : 'fail';

function noteText(note, copy, tr) {
  if (!note) return '';
  const [kind, detail] = note.split(':');
  const unsaved = ' ' + tr('Nimic nu a fost salvat.', 'Nothing was saved.');
  if (kind === 'saved') return tr('Verificat și salvat.', 'Checked and saved.');
  if (kind === 'removed') return tr('Eliminat.', 'Removed.');
  if (kind === 'throttle') return tr('Prea multe încercări. Așteaptă un minut.', 'Too many tries. Wait a minute.');
  if (kind === 'serviceFixed')
    return tr('Acest serviciu este stabilit din terminal sau din fișierul .env.', 'This service is set in the shell or in the .env file.');
  if (kind === 'value') {
    const label = copy.fields.find(([name]) => name === detail)?.[1] || '';
    return (
      tr('Verifică valoarea din câmpul „' + label + '”.', 'Check the value in “' + label + '”.') +
      (detail?.endsWith('_ENDPOINT')
        ? ' ' + tr('Trebuie să fie adresa HTTPS a resursei tale Azure.', 'It must be the HTTPS address of your Azure resource.')
        : '') +
      unsaved
    );
  }
  if (kind === 'check') {
    const status = Number(detail);
    if (!status)
      return tr('Serviciul nu a răspuns. Verifică adresa și conexiunea.', 'The service did not answer. Check the address and your connection.') + unsaved;
    const http = ' (HTTP ' + status + ').';
    if (status === 401 || status === 403) return tr('Serviciul a refuzat cheia', 'The service refused the key') + http + unsaved;
    if (status === 404)
      return tr('Serviciul nu cunoaște această adresă sau acest model', 'The service does not know this address or model') + http + unsaved;
    if (status === 429)
      return tr('Serviciul a refuzat cererea: limită atinsă sau credit epuizat', 'The service refused the request: limit reached or credit used up') + http + unsaved;
    return tr('Serviciul a refuzat cererea', 'The service refused the request') + http + unsaved;
  }
  return tr('Operațiunea a eșuat. Încearcă din nou.', 'That did not work. Try again.');
}

/**
 * One service as a card. `draft` keeps what is being typed across redraws, `note` is the outcome
 * of the last save, and `save(values)` and `remove()` are called by its two buttons.
 */
export function serviceCard(service, { tr, busy, draft, note, save, remove }) {
  const copy = serviceCopy(service.id, tr);
  const card = el('section', undefined, 'service-card');
  const head = el('h3', copy.title);
  head.append(el('span', stateText(service, tr), 'service-state' + (service.state === 'set' ? ' is-set' : '')));
  card.append(head, el('p', copy.about));
  if (service.fixed) {
    card.append(
      el(
        'p',
        tr(
          'Stabilit din terminal sau din fișierul .env. Schimbă-l acolo.',
          'Set in the shell or in the .env file. Change it there.',
        ),
        'service-fixed',
      ),
    );
    return card;
  }
  const form = el('form', undefined, 'service-fields');
  form.noValidate = true;
  for (const [name, text, placeholder] of copy.fields) {
    const secret = name.endsWith('_KEY');
    const input = el('input');
    input.type = secret ? 'password' : 'text';
    input.name = name;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.autocapitalize = 'none';
    input.maxLength = 300;
    input.disabled = busy;
    input.value = draft[name] ?? service.details[name] ?? '';
    input.placeholder =
      secret && service.state === 'set'
        ? tr('salvată; lipește alta pentru a o înlocui', 'saved; paste another to replace it')
        : placeholder || '';
    input.oninput = () => (draft[name] = input.value);
    const label = el('label', text);
    label.append(input);
    form.append(label);
  }
  const send = el('button', tr('Verifică și salvează', 'Check and save'), 'ui-btn');
  send.type = 'submit';
  send.disabled = busy;
  form.append(send);
  form.onsubmit = (event) => {
    event.preventDefault();
    save(Object.fromEntries(copy.fields.map(([name]) => [name, (draft[name] ?? service.details[name] ?? '').trim()])));
  };
  if (service.state !== 'unset') {
    const clear = el('button', tr('Elimină', 'Remove'), 'ui-btn negative');
    clear.type = 'button';
    clear.disabled = busy;
    clear.onclick = remove;
    form.append(clear);
  }
  const status = el('p', noteText(note, copy, tr), 'feedback');
  status.setAttribute('role', 'status');
  card.append(form, status);
  return card;
}
