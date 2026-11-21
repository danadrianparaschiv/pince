# Pince: functional requirements · Cerințe funcționale

This is the requirements document the first version of Pince was built from, dated 17 November 2026 and kept as a record of the starting point. The app has grown since: [the user guide](USER-GUIDE.md) and [the architecture](ARCHITECTURE.md) describe what it does today, and where they differ from this page, they are right.

Acesta este documentul de cerințe din care a pornit prima versiune a aplicației, din 17 noiembrie 2026, păstrat ca punct de plecare. Aplicația a evoluat de atunci; [ghidul de utilizare](USER-GUIDE.md) descrie ce face astăzi.

- [Română](#română)
- [English](#english)

## Română

**Pince · biblioteca familiei.** Un copil poate lua o carte de pe raft, o poate adăuga în bibliotecă, își poate nota impresiile și îi poate trimite unui coleg un link către carte. Părintele gestionează conturile și urmărește costurile Azure.

### Prezentare generală

#### Domeniul primei versiuni

Prima versiune este disponibilă în română și în engleză. Aplicația deservește o familie cu aproximativ 500 de cărți și două sau trei persoane care o folosesc simultan. O carte poate fi adăugată cu telefonul, dintr-o fotografie existentă sau tastând titlul. Biblioteca poate fi folosită și când recunoașterea din fotografii este oprită.

#### Cine poate folosi biblioteca

|   Utilizator     |   Acces la bibliotecă                                                                                |   Distribuire și administrare                                                                |
|------------------|------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------|
| Copilul          | Adaugă și modifică datele cărților, copertele, notițele, favoritele și starea lecturii.              | Poate vedea pagina publică și copia linkul pentru a-l trimite altcuiva.                      |
| Părintele        | Gestionează aceeași colecție, poate șterge cărți și poate exporta sau restaura o copie de siguranță. | Gestionează conturile familiei, pornește sau oprește recunoașterea și verifică cheltuielile. |
| Cititorul public | Deschide linkul unei cărți pentru a-i vedea titlul, autorul și coperta aleasă.                       | Poate citi pagina sau transmite linkul. Colegii o pot deschide fără cont și fără parolă.     |

#### Autentificarea și recuperarea accesului

**FR01 Conturile familiei** Copilul și părintele au fiecare propriul nume de utilizator și propria parolă. Numele de utilizator poate fi o poreclă. Părintele poate reseta parola unui cont al familiei sau poate dezactiva contul și închide sesiunile asociate.

**FR02 Accesul familiei** Pentru a răsfoi întregul catalog, a căuta, a citi notițe, a încărca fotografii, a solicita o scanare sau a modifica date, este necesar un cont de familie autentificat. Serverul verifică aceste drepturi. Deconectarea închide sesiunea, iar linkurile publice către cărți pot fi deschise în continuare.

#### Bugetul de funcționare

Costul total al găzduirii Azure, al stocării, al traficului și al utilizării modelului trebuie să fie sub 3 USD în fiecare lună de facturare și sub 30 USD pe parcursul a douăsprezece luni. Estimarea din secțiunea „Găzduirea în Azure și costurile” include importul inițial și utilizarea obișnuită, pe un abonament Azure cu plată care beneficiază de cote gratuite recurente.

### Adăugarea cărților

Din „Adaugă o carte”, cititorul poate introduce datele manual, poate fotografia o copertă sau poate surprinde mai multe cărți într-o singură fotografie a raftului.

#### Formularul de carte

**FR03 Adaugă o carte** Singurul câmp obligatoriu este titlul, care trebuie să conțină cel puțin un caracter diferit de spațiu. Se pot adăuga unul sau mai mulți autori, un ISBN și o copertă. Se păstrează ortografia și diacriticele. La salvare, cartea primește un identificator permanent și data adăugării. Inițial este necitită, cu notița goală și opțiunea „Favorită” debifată.

**FR04 Corectează datele** Copilul și părintele pot modifica datele cărții și pot înlocui sau elimina coperta. Dacă ISBN-ul coincide cu al unei cărți existente sau dacă titlul normalizat și autorul cunoscut coincid, aplicația semnalează un posibil duplicat. Cititorul poate deschide cartea existentă, poate sări peste înregistrare sau poate salva încă un exemplar.

#### Fotografiile copertelor și ale rafturilor

**FR05 Încarcă și verifică fotografia** Pe telefon, tabletă sau calculator se poate folosi camera sau un fișier JPEG, PNG ori WebP de cel mult 10 MB. În previzualizare se poate roti, decupa sau înlocui fotografia ori anula încărcarea. Dacă formatul sau dimensiunea nu este acceptată, un mesaj explică pasul următor și formularul păstrează datele introduse.

**FR06 Identifică o copertă** Cititorul poate atașa coperta direct sau poate alege „Identifică această carte”. Dacă recunoașterea este activă, aplicația propune titlul și autorul vizibile. Marchează textul neclar și lasă goale câmpurile lipsă. Cititorul poate corecta sugestiile înainte de salvare.

**FR07 Identifică mai multe cărți** Lângă fotografia raftului apare câte un rând editabil pentru fiecare carte detectată. Cititorul poate corecta sau elimina rânduri, adăuga o carte omisă, verifica duplicatele și alege ce salvează. Fiecare rând confirmat devine o carte cu link propriu. Până la alegerea unei coperte apare o imagine implicită.

**FR08 Continuă după o scanare nereușită** Fotografia poate fi mărită pentru introducerea manuală a titlurilor. Cititorul o poate decupa mai strâns sau poate face alta. Dacă modelul este oprit, indisponibil sau și-a atins bugetul, cititorul poate introduce mai multe titluri lângă aceeași fotografie și salva rândurile alese.

**FR09 Evită salvările repetate** Aplicația arată câte cărți au fost salvate și ce rânduri mai trebuie verificate. O apăsare dublă sau o reîncercare după pierderea răspunsului creează cel mult o carte pentru fiecare rând selectat. La o eroare de salvare, corecturile se păstrează pentru reîncercare.

#### Păstrarea fotografiilor

Se păstrează o copie optimizată a copertei și o miniatură. Se elimină metadatele despre locație și cameră. Fotografia întregului raft este privată pe durata verificării și se șterge după finalizare sau anulare. Fotografiile abandonate se șterg în cel mult 24 de ore.

### Găsirea și distribuirea cărților

#### Răsfoirea și organizarea colecției

**FR10 Răsfoiește colecția** În catalogul familiei apar coperta sau imaginea implicită, titlul, autorul cunoscut și etichetele pentru starea lecturii și favorite. Într-o colecție goală apare acțiunea „Adaugă prima ta carte”. Deschiderea cărții în contul familiei afișează toate detaliile.

**FR11 Favoritele și starea lecturii** Familia poate bifa sau debifa „Favorită” și poate alege independent „Citită” sau „Necitită”. Modificările se văd în listă și în pagina cărții și se păstrează între autentificări. Ambele conturi gestionează aceeași evidență a lecturilor copilului.

**FR12 Notița privată** Fiecare carte poate avea o notiță editabilă de cel mult 4.000 de caractere, în text simplu. Se pot introduce rânduri noi, modifica sau șterge textul. Aplicația arată dacă modificarea a fost salvată. Doar familia poate citi notița, inclusiv prin API.

**FR13 Caută și filtrează** Căutarea găsește fragmente de titlu sau de nume de autor indiferent de majuscule sau diacritice. Se poate combina cu filtrul „Favorite” și cu oricare dintre cele două stări de lectură. Aplicația arată numărul rezultatelor și oferă „Șterge filtrele” când nu există rezultate.

**FR14 Sortează rezultatele** Cărțile se pot sorta alfabetic după titlu sau autor în ambele sensuri ori după data adăugării, începând cu cele mai noi sau cele mai vechi. Ordinea implicită este după titlu, de la A la Z. Autorii necunoscuți apar ultimii. La egalitate se folosesc titlul, apoi identificatorul permanent. La revenirea dintr-o carte se păstrează căutarea, filtrele, ordinea și poziția în listă.

#### Distribuirea unei cărți

**FR15 Distribuie un link permanent** Fiecare carte salvată primește imediat o adresă HTTPS publică, de exemplu /books/{id}. Acțiunea „Distribuie cartea” permite previzualizarea paginii publice și copierea linkului. Mesajul spune „Oricine are acest link poate vedea cartea.” Modificarea titlului sau a copertei păstrează aceeași adresă.

**FR16 Pagina publică a cărții** Oricine deschide sau transmite linkul poate vedea, fără autentificare, titlul, autorul cunoscut și coperta optimizată sau imaginea implicită. Pagina și API-ul public oferă doar aceste date. Notițele, favoritele, starea lecturii, fotografiile rafturilor, fișierele originale și datele conturilor sunt private.

**FR17 Șterge o carte** Părintele poate șterge cartea după confirmarea titlului. Cererile ulterioare către pagina publică, înregistrarea din API-ul public și adresa copertei indică faptul că resursa este indisponibilă, inclusiv când linkul a fost transmis altcuiva.

#### Editarea simultană

Dacă doi membri ai familiei modifică același câmp, aplicația afișează ultima valoare salvată și păstrează ciorna celei de-a doua persoane, care poate alege ce versiune păstrează. Modificările efectuate în câmpuri diferite se salvează amândouă.

### Găzduirea în Azure și costurile

Aplicația utilizează Azure Static Web Apps Free cu API-ul HTTP gestionat, un cont privat de stocare de uz general pentru coperte, Table Storage pentru înregistrări și un model de recunoaștere a imaginilor cu plată în funcție de utilizare. API-ul servește paginile publice și verifică sesiunile pentru accesul privat. Se folosește numele de domeniu inclus de Azure.

#### Estimarea lunară în USD

Calculul presupune 500 de cărți, în medie 300 KB pentru o copertă împreună cu miniatura, 1 GB pentru fișiere, inclusiv copii de siguranță și fișiere temporare, și cel mult 2 GB de trafic lunar, inclusiv vizualizările publice. Se folosesc tarifele de stocare din West Europe și cele ale modelului Global Standard. Cotele gratuite trebuie să fie disponibile în abonament.

|   Serviciu         |   Consum și tarif                                                                                                                                              |   Estimare   |
|--------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------|
| Găzduire și API    | Static Web Apps Free, în limita cotelor incluse pentru trafic și execuții de funcții.                                                                          | 0,00 USD     |
| Stocare Blob       | 1 GB la 0,0196 USD, 10.000 de citiri la 0,0043 USD și 1.000 de scrieri la un tarif de 0,054 USD pentru 10.000.                                                 | 0,03 USD     |
| Alte costuri Azure | Sumă estimată pentru Table Storage, operațiuni suplimentare, diagnosticare și transferuri.                                                                     | 0,25 USD     |
| Recunoaștere foto  | 100 de scanări a câte 4.000 de tokeni de intrare și 1.000 de ieșire facturați. GPT-5 mini costă 0,25 USD pe milion la intrare și 2,00 USD pe milion la ieșire. | 0,30 USD     |
| Lună obișnuită     | Total Azure și recunoaștere, înainte de taxele aplicabile.                                                                                                     | 0,58 USD     |

La importul inițial, 500 de scanări individuale de coperte ar costa circa 1,50 USD pentru model, adică 1,78 USD cu Azure inclus. La același număr de tokeni pe scanare, 50 de fotografii de raft cu câte zece cărți lizibile ar costa circa 0,15 USD pentru model. O lună cu importul copertelor și unsprezece luni obișnuite ar însuma aproximativ 8,16 USD înainte de taxe. Numărul de tokeni facturați pentru imagini și raționament poate varia.

#### Controlul cheltuielilor

**FR18 Aplică limitele de scanare** Înainte de fiecare apel, aplicația rezervă atomic costul maxim facturabil, ținând cont de imaginea redimensionată, instrucțiuni și limita de tokeni la ieșire, inclusiv cei de raționament. Include reîncercările și scanările simultane. Oprește scanările care ar depăși 1,50 USD lunar sau 12 USD în douăsprezece luni. Ajustează rezerva după consumul real și păstrează sumele incerte până la clarificare.

**FR19 Protejează bugetul total** Părintele vede costul estimat cumulat în luna curentă și în ultimele douăsprezece luni. Pragurile sunt 2,25 USD, respectiv 26 USD, inclusiv taxele și conversia valutară aplicabile. La atingerea oricărui prag estimat, scanările cu plată se opresc. Aplicația limitează frecvența încărcărilor și citirilor, elimină fișierele temporare expirate și verifică estimările față de factura Azure. Alertele Azure anunță părintele după înregistrarea consumului.

Tarife verificate la 17 noiembrie 2026. [Găzduire gratuită](https://azure.microsoft.com/en-us/pricing/details/app-service/static/) · [Tarife de stocare](https://prices.azure.com/api/retail/prices?%24filter=armRegionName+eq+%27westeurope%27+and+productName+eq+%27General+Block+Blob+v2%27+and+skuName+eq+%27Hot+LRS%27) · [Tarifele modelului](https://devblogs.microsoft.com/foundry/whats-new-in-azure-ai-foundry-august-2025/) · [Trafic](https://azure.microsoft.com/en-us/pricing/details/bandwidth/) · [Alerte de buget](https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/tutorial-acm-create-budgets)

### Interfața în română și în engleză

Copilul își poate folosi biblioteca în română, iar un coleg poate deschide aceeași carte în engleză. Limba este o preferință a fiecărei persoane.

**FR20 Interfață completă în ambele limbi** Toate textele de autentificare, navigare, formulare, sugestii și verificare a fotografiilor, pagini publice, setări pentru părinte, confirmări, validări, erori și etichete pentru cititoarele de ecran au versiuni verificate în română și engleză. Datele și numerele se afișează în formatul limbii alese. Limitele de cost se exprimă în USD în ambele limbi.

**FR21 Alegerea și memorarea limbii** Opțiunile „Română” și „English” sunt disponibile pe fiecare ecran, inclusiv la autentificare și pe paginile publice. Se folosește limba salvată, apoi prima limbă acceptată din preferințele browserului, iar în lipsa lor, româna. Pentru familie, alegerea se salvează în cont. Pentru vizitatori, se salvează pe dispozitiv. Schimbarea limbii păstrează cartea deschisă, datele nesalvate din formular sau din lista cărților de pe raft, căutarea și filtrele.

**FR22 Păstrarea textului original** Titlurile, numele autorilor și notițele private își păstrează limba și ortografia. Recunoașterea transcrie textul de pe coperte și cotoare în română și în engleză, inclusiv de pe rafturi cu cărți în ambele limbi. Se păstrează diacriticele românești. Schimbarea limbii păstrează înregistrarea și linkul public, fără să declanșeze o scanare sau o traducere cu plată.

**FR23 Căutarea și sortarea** În ambele interfețe, căutarea acceptă cuvinte cu sau fără diacritice, inclusiv ă, â, î, ș, ț și formele vechi ş și ţ. Titlurile și autorii se sortează după regulile alfabetice ale limbii alese. La schimbarea limbii se păstrează sensul sortării și filtrele.

#### Etichete folosite în aplicație

|   Română                 |   English          |
|--------------------------|--------------------|
| Adaugă o carte           | Add a book         |
| Fotografiază un raft     | Photograph a shelf |
| Identifică această carte | Find book details  |
| Citită / Necitită        | Read / Not read    |
| Adaugă la favorite       | Add to favorites   |
| Distribuie cartea        | Share book         |

### Criterii de acceptare

Verificarea se face cu 500 de cărți de test, trei sesiuni active și fotografii reprezentative făcute cu telefonul familiei. Prima versiune poate fi lansată după verificarea fluxurilor în ambele limbi.

#### Verificarea fluxurilor complete

**AT01 Introducere manuală** Cu recunoașterea oprită, copilul poate adăuga o carte doar cu titlul, poate corecta titlul și poate redeschide cartea la adresa inițială. Corectura se vede din ambele conturi de familie. Un titlu format exclusiv din spații este respins.

**AT02 Introducere din fotografie** Fotografiați o copertă clară, corectați un câmp sugerat și verificați că s-a salvat forma corectată. Pentru un raft cu cinci cotoare lizibile, ținta este de cel puțin patru titluri sugerate corect. Adăugați un titlu omis, săriți peste un duplicat, salvați și reîncercați. Numărul final trebuie să coincidă cu numărul de rânduri distincte selectate.

**AT03 Lectură și căutare** Marcați o carte ca citită și favorită, salvați o notiță pe două rânduri, deconectați-vă și autentificați-vă din nou pentru a o redeschide. Căutarea „Micul Print” găsește „Micul Prinț”. Combinați „Favorite” și „Citită”, sortați după autor, deschideți un rezultat și reveniți. Ordinea filtrată și notița se păstrează.

**AT04 Distribuire publică** Deschideți linkul unei cărți în două browsere fără sesiuni active. Ambele arată titlul, autorul și coperta fără autentificare. Răspunsul public omite notițele și starea lecturii. Cererile anonime de editare, scanare sau acces la fotografia raftului sunt respinse. După ștergerea cărții, pagina, înregistrarea publică din API și coperta devin indisponibile.

**AT05 Ușurință în utilizare și viteză** Pe un telefon cu ecranul de 360 de pixeli CSS lățime și pe calculator, copilul poate adăuga, găsi și distribui o carte fără indicațiile unui adult. Comenzile au etichete text, indicator de focalizare la tastatură și zone tactile de cel puțin 44 × 44 de pixeli CSS. Cu 500 de cărți și trei sesiuni active, 95% dintre încărcările catalogului și ale paginilor de carte durează cel mult două secunde la 10 Mbps, după pornirea serviciului.

**AT06 Securitate și restaurare** Folosiți HTTPS, funcții adaptive de derivare a parolelor cu salt, cookie-uri de sesiune cu atributele Secure și HttpOnly și limitarea încercărilor de autentificare. Serverul validează conținutul fișierelor. Modelul primește doar imaginea verificată și instrucțiunile de extragere. Jurnalele exclud notițele private, datele de autentificare și imaginile. Restaurați o copie exportată de părinte într-o bibliotecă goală. Verificați linkurile publice inițiale, copertele și evidența privată a lecturilor.

**AT07 Buget și erori** Trimiteți două scanări simultane când bugetul permite una singură. Verificați că se facturează un singur apel. Repetați la limita anuală. Introducerea manuală funcționează și când o scanare este blocată sau expiră. Înainte de lansare, recalculați luna importului și anul întreg pentru regiunea, modelul, taxele și cotele alese. După prima factură, comparați costul real cu estimarea și ajustați limitele dacă este nevoie.

**AT08 Verificare bilingvă** Rulați AT01–AT07 în ambele limbi. Schimbați limba înainte de a salva corecturile unei fotografii de raft cu titluri românești și englezești. Verificați păstrarea datelor, a diacriticelor și a notiței în original. Deschideți același link ca vizitator, schimbați limba și reîncărcați pagina. Verificați preferința salvată, confidențialitatea și absența oricărui apel plătit. Confirmați că fiecare ecran și mesaj are o traducere verificată.

## English

**Pince · family library web application.** A child can pick a book from the shelf, add it to the library, keep a private reading note, and send a classmate a link to that book. A parent manages access and the household’s Azure bill.

### Overview

#### Release scope

Romanian and English are both available from the first release. The first release supports one family collection of about 500 physical books and two or three people using it at once. A phone camera, an existing photo, or a title typed into a browser are all valid starting points. The family can use the library when photo recognition is turned off.

#### Who can do what

|   User        |   Library access                                                               |   Sharing and account controls                                                   |
|---------------|--------------------------------------------------------------------------------|----------------------------------------------------------------------------------|
| Child         | Add and edit books, covers, notes, favorites, and reading status.              | Preview the public book page and copy its link to share.                         |
| Parent        | Help manage the same collection, remove books, and export or restore a backup. | Manage family accounts, switch photo recognition on or off, and review spending. |
| Public reader | Open any book link to see its title, author, and chosen cover.                 | Read or forward the link. Classmates can open it without an account or password. |

#### Sign in and recover access

**FR01 Family accounts** The child and parent each sign in with their own username and password to manage the library. Allow a nickname as the username. The parent can reset a family password or disable an account and invalidate its sessions.

**FR02 Protected family workspace** Require a signed-in family account to browse the full catalog, search, read notes, upload photos, request scans, or make changes. Enforce these permissions on the server. Signing out ends the family session. Public book links continue to work when signed out.

#### Operating budget

Azure hosting, storage, data transfer, and model use together must stay below USD 3 in every billing month and USD 30 over twelve months. Budget for the initial import as well as ordinary use. The cost model in “Azure hosting and cost” uses a paid Azure subscription with ongoing free allowances.

### Adding books

From Add a book, the reader can type the details, photograph one cover, or capture several books in a single shelf photo.

#### Book form

**FR03 Create a record** Require only a nonblank title. Accept one or more authors, an optional ISBN, and an optional cover. Display entered spelling and accents. Assign a permanent ID and date added on save. New books start as Not read, with Favorite off and an empty note.

**FR04 Correct an entry** The child and parent can change book details and replace or remove a cover. If the ISBN matches an existing book, or its normalized title and known author match, show the possible duplicate. Offer to open the existing entry, skip, or save a separate copy.

#### Cover and shelf photos

**FR05 Upload and preview** Accept a camera photo or file on phone, tablet, and desktop. Support JPEG, PNG, and WebP up to 10 MB each. Show a preview with rotate, crop, replace, and cancel. For an unsupported format or an oversized file, explain how to continue and keep any typed details.

**FR06 Identify one cover** Let the reader attach a cover immediately or choose Find book details. When enabled, recognition suggests the visible title and author. Mark unclear text for review and leave missing fields empty. The reader can correct either field before saving.

**FR07 Identify multiple spines** Show one editable draft per detected book beside the shelf preview. Let the reader correct, remove, or add a missed title, resolve duplicates, and choose which rows to save. Each confirmed row becomes a separate book with its own URL. Use a placeholder until the family chooses a cover for that book.

**FR08 Handle a blurry shelf or failed scan** Keep the preview available for zooming and manual entry. Offer a closer crop or a new photo. If the model is disabled, unavailable, or over budget, allow the reader to enter several titles beside the same photo and save the chosen rows.

**FR09 Save once** Show the saved count and identify rows still needing attention. A double tap or retry after a lost response must create each selected row at most once. Preserve unsaved corrections during a failed save so the reader can retry.

#### Photo retention

Keep an optimized copy of the chosen book cover and a thumbnail. Strip location and camera metadata. Keep the full shelf photo private while it is being reviewed, discard it after completion or cancellation, and expire abandoned uploads within 24 hours.

### Finding and sharing books

#### Browse and organize

**FR10 Browse the collection** In the family catalog, show the cover or placeholder, title, author when known, and labeled reading and favorite states. Display an Add your first book action for an empty collection. Opening a book in this workspace shows its full details.

**FR11 Favorite and reading status** Allow the family to switch Favorite on or off and choose Read or Not read independently. Each change updates the list and detail view and persists across sign-ins. Both family accounts manage the child’s single set of reading records.

**FR12 Private reading note** Keep one editable plain-text note per book, up to 4,000 characters. Allow line breaks, editing, and clearing. Show whether the change was saved. Only the family can read the note, including through the API.

**FR13 Search and filter** Match partial titles and authors regardless of case or accents. Combine the search with Favorites and either reading state. Show the number of matches and a Clear filters action when the result is empty.

**FR14 Sort results** Offer title and author in both alphabetical directions, plus newest or oldest date added. Default to title A–Z. Place missing authors last and break ties by title, then permanent ID. Returning from a book restores the search, filters, sort, and position.

#### Share a single book

**FR15 Share a permanent link** Give every saved book a permanent public HTTPS address such as /books/{id}. The Share book action previews the public page and copies its link. Tell the child “Anyone with this link can view this book.” The link works as soon as the book is saved and survives title or cover edits.

**FR16 Public book view** Anyone opening or forwarding a book link can read its title, author when known, and optimized cover or placeholder without signing in. Serve only those fields and the cover through the public page and API. Keep notes, favorites, reading status, shelf photos, original uploads, and family account details private.

**FR17 Remove a book** The parent can delete a book after confirming its title. Subsequent requests to that book’s public page, public API response, and cover URL return an unavailable response, including requests made through a forwarded link.

#### Two people editing

When two family members change the same field, show the newer saved value and preserve the second person’s draft so they can choose what to keep. Changes to different fields must both survive.

### Azure hosting and cost

Use Azure Static Web Apps Free with its managed HTTP API, a private general-purpose storage account for covers and Table Storage for records, and a pay-as-you-go vision model for requested scans. The API serves public book pages and checks family sessions on private routes. Use the included Azure hostname.

#### Monthly planning estimate in USD

Assume 500 books averaging 300 KB each for a cover and thumbnail, a 1 GB blob allowance including backups and temporary files, and up to 2 GB of monthly traffic including public book views. Use West Europe storage and Global Standard model pricing. Free allowances must be available on the subscription.

|   Item            |   Usage and pricing basis                                                                                                                 |   Estimate   |
|-------------------|-------------------------------------------------------------------------------------------------------------------------------------------|--------------|
| Hosting and API   | Static Web Apps Free, within the included bandwidth and function allowances.                                                              | $0.00        |
| Blob storage      | 1 GB at $0.0196, 10,000 reads at $0.0043, and 1,000 writes at $0.054 per 10,000.                                                          | $0.03        |
| Other Azure use   | Planning allowance for Table Storage, extra operations, diagnostics, and transfers.                                                       | $0.25        |
| Photo recognition | 100 scans × 4,000 billed input tokens and 1,000 billed output tokens each. GPT-5 mini at $0.25 / $2.00 per million input / output tokens. | $0.30        |
| Ordinary month    | Azure and recognition together, before applicable tax.                                                                                    | $0.58        |

For the initial import, 500 separate cover scans would cost about $1.50 in model use, or $1.78 including Azure. Fifty shelf photos averaging ten readable books would cost about $0.15 in model use at the same token counts. One cover-import month and eleven ordinary months total about $8.16 before tax. Actual billed image and reasoning tokens can vary.

#### Spending controls

**FR18 Enforce scan quotas** Before each call, atomically reserve its maximum billable cost using the resized image, prompt, and output limit, including reasoning tokens. Count retries and concurrent scans. Pause recognition if a new call would exceed $1.50 in the month or $12 over twelve months. Settle with actual usage and conservatively retain uncertain charges.

**FR19 Protect the total budget** Show the parent combined estimated spend for the month and trailing twelve months. Target $2.25 and $26 respectively, including tax and currency conversion where applicable. Pause paid scans when projected totals reach either target. Rate-limit uploads and reads, expire temporary files, and reconcile to Azure billing. Azure budget alerts notify the parent after usage occurs.

Price references checked 17 November 2026. [Free hosting](https://azure.microsoft.com/en-us/pricing/details/app-service/static/) · [Storage meters](https://prices.azure.com/api/retail/prices?%24filter=armRegionName+eq+%27westeurope%27+and+productName+eq+%27General+Block+Blob+v2%27+and+skuName+eq+%27Hot+LRS%27) · [Model rates](https://devblogs.microsoft.com/foundry/whats-new-in-azure-ai-foundry-august-2025/) · [Bandwidth](https://azure.microsoft.com/en-us/pricing/details/bandwidth/) · [Budget alerts](https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/tutorial-acm-create-budgets)

### Romanian and English interface

The child can use the library in Romanian while a classmate opens the same book in English. Each reader chooses their own interface language.

**FR20 Complete interface in both languages** Provide reviewed Romanian and English text for sign-in, navigation, forms, photo suggestions and review, public book pages, parent settings, confirmations, validation and error messages, and accessibility labels. Use date and number formats for the selected language. Display cost limits in USD in both languages.

**FR21 Choose and remember a language** Offer “Română” and “English” on every screen, including sign-in and public links. Use the saved choice first, then the first supported browser language, then Romanian. Save the choice to the family account when signed in and on the device for a guest. Switching keeps the current book, unsaved form or shelf edits, search, and filters.

**FR22 Keep the book as written** Display titles, author names, and private notes in their original language and spelling. Photo recognition must transcribe Romanian and English covers and spines, including mixed-language shelves. Preserve Romanian diacritics. A language change keeps the same record and public URL. It never triggers a scan or a paid translation.

**FR23 Search and sort in either language** In both interfaces, match searches with or without accents, including ă, â, î, ș, ț and the older ş and ţ forms. Sort titles and author names according to the selected language. Preserve the chosen sort direction and filters when switching.

#### Labels used in the app

|   Română                 |   English          |
|--------------------------|--------------------|
| Adaugă o carte           | Add a book         |
| Fotografiază un raft     | Photograph a shelf |
| Identifică această carte | Find book details  |
| Citită / Necitită        | Read / Not read    |
| Adaugă la favorite       | Add to favorites   |
| Distribuie cartea        | Share book         |

### Release acceptance

Use a 500-book test collection, three active sessions, and representative phone photos from the family. Release the first version after verifying the workflows in both languages.

#### End to end checks

**AT01 Manual entry** With recognition switched off, the child can add a title-only book, correct its title, and reopen it at the original URL. Both family accounts see the correction. Whitespace-only titles are rejected.

**AT02 Photo entry** Photograph one clear cover. Correct a suggested field and confirm that only the correction is saved. For a shelf with five legible spines, the release target is at least four correct title suggestions. Add a missed title, skip a known duplicate, save, and retry. The final count equals the unique selected rows.

**AT03 Reading and discovery** Mark a book read and favorite, save a two-line note, sign out, then sign back in as a family member to reopen it. Search for “Micul Print” to find “Micul Prinț”. Combine Favorites and Read, sort by author, open a result, then go back. The same filtered order and note are preserved.

**AT04 Public sharing** Copy a book link and open it in two signed-out browsers. Both show the title, author, and cover without a login prompt. Verify that the public response omits notes and reading state, and that anonymous requests to edit, scan, or fetch a shelf photo are denied. Delete the book and verify the page, public API record, and cover become unavailable.

**AT05 Usability and speed** On a phone at 360 CSS pixels wide and on a desktop, the child can add a book, find it, and share it without adult prompts. Controls have text labels, keyboard focus, and touch targets of at least 44 × 44 CSS pixels. With 500 books and three active sessions, 95% of warm catalog and detail loads finish within two seconds on a 10 Mbps connection.

**AT06 Security and recovery** Use HTTPS, salted adaptive password hashes, secure HttpOnly session cookies, and throttled sign-in attempts. Validate file contents on the server. Send only the reviewed book image and extraction instructions to the model. Keep private notes, credentials, and images out of logs. Restore a parent-exported backup into an empty library. Verify the original public URLs, covers, and family-only reading records.

**AT07 Budget and failure** Submit two scans concurrently with funds for only one and verify one billable request. Repeat at the annual limit. A blocked or timed-out scan leaves manual entry usable. Before launch, price the selected region, model, tax, and allowances for the import month and full year. After the first invoice, compare it with the estimate and adjust quotas if needed.

**AT08 Bilingual release** Run AT01–AT07 in both languages. Switch languages before saving corrections to a photo of mixed Romanian and English books. Verify draft data, original diacritics, and note text. Open the same link as a guest, switch language, and reload. Check the saved preference, privacy, and zero paid calls from switching. Verify that every screen and message has a reviewed translation.
