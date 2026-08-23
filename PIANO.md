# Character Companion — piano di lavoro

**La scheda al tavolo.** App compagna del [D&D Character Builder](https://github.com/Brainstorm-Club/dnd-character-builder):
importa il JSON di un personaggio e lo rende consultabile e giocabile dal telefono.

- Repo: `Brainstorm-Club/dnd-companion`
- URL: `https://brainstorm-club.github.io/dnd-companion/`
- Locale: `/Users/fullo/Development/brainstorm/dnd-companion`
- Stato: **fase 2 conclusa** — import, scheda, dadi, prove, sessione, PX e avanzamento, compendio, vassoio dei dadi

---

## 1. Obiettivo

Al tavolo servono quattro cose, in fretta e senza rete:

1. **Consultare** la scheda: caratteristiche, tiri salvezza, abilità, CA, incantesimi, inventario, privilegi.
2. **Tirare i dadi**: `1d20`, `4d12`, `2d6 e 3d20` insieme, con vantaggio/svantaggio.
3. **Fare prove**: «tira un d20 e fai una prova di Carisma con CD 14», tiri salvezza, tiri contrapposti.
4. **Segnare i PX** che dà il master, sapere quando si sale di livello e farsi accompagnare nell'avanzamento.

Più lo stato di sessione (PF, slot, riposi) che rende inutile la matita.

Il vincolo che governa ogni scelta di interfaccia: **si usa con una mano sola, al buio, mentre parla il master.**

**Solo D&D, solo materiale SRD, in italiano, in due edizioni.** L'SRD 5.1 (regole 2014) e l'SRD 5.2.1 (regole
2024) sono **entrambi CC-BY-4.0 ed entrambi tradotti ufficialmente in italiano**. L'app li spedisce tutti e due:
niente Player's Handbook, niente zona grigia OGL, e ogni incantesimo e privilegio è consultabile nell'edizione
giusta — quella del tavolo — o nell'altra, se si vuole confrontare.

**Brancalonia, Apocalisse e gli altri giochi Acheron arrivano in v3**, come *pacchetti scaricabili*. Non è un
rinvio generico: l'architettura dei dati nasce già a pacchetti (§ 6.4), così la v3 aggiunge file e voci di
registro senza toccare né il motore né l'interfaccia.

### Non-obiettivi v1

Niente creazione di personaggi da zero (è il mestiere del builder), niente sincronizzazione cloud o account,
niente export PDF, niente strumenti da master (iniziativa, mostri, party), niente QR (valutato e rimandato:
è la dipendenza più pesante del progetto), niente materiale non-SRD: ciò che è Acheron o Player's Handbook si
mostra col nome e senza testo, dichiarando il perché (§ 5.1).

---

## 2. Decisioni prese

| Decisione | Scelta | Perché |
|---|---|---|
| Stack | **Vanilla ESM, nessun build step** | Vincolo «meno dipendenze possibili»: zero dipendenze a runtime, il repo *è* il sito. Precedente in casa: `crit-xp-sheet`. |
| Type safety | **JSDoc + `tsc --noEmit --checkJs`** | Rigore del TS strict del builder, costo a runtime zero, nessun artefatto da compilare. |
| Regole D&D | **Due edizioni: SRD 5.1 (2014) e SRD 5.2.1 (2024), entrambe in italiano** | Entrambe CC-BY-4.0. Il personaggio apre la sua, chi vuole confronta l'altra. |
| Edizione predefinita | **Dedotta dalla variante del personaggio**, con doppio scavalco (globale e per singolo incantesimo) | Brancalonia e Apocalisse sono costruite sul 2014: devono aprirsi sul 2014 senza che nessuno lo imposti. |
| Brancalonia e Apocalisse | **Fuori dalla v1, dentro la v3 come pacchetti scaricabili** | La v1 li riconosce e lo dice; l'architettura a pacchetti (§ 6.4) è pronta fin da subito perché la v3 sia un'aggiunta, non una riscrittura. |
| Compendio incantesimi | **In v1, 319 + 339 incantesimi con testo integrale, sempre offline** | Le fonti sono legali, italiane e già in casa. Precache in due tempi (§ 7) per non appesantire il primo avvio. |
| Dati regole | **Due pacchetti generati + due compendi estratti dai PDF** | Il level-up deve dire *cosa* ottieni, non solo *che* puoi salire. |
| Stato di gioco | **Tracker di sessione completo** | PF, slot, dadi vita, condizioni, monete, usi dei privilegi, ispirazione, PX. |
| Import | **File JSON + incolla + link di condivisione** | Le tre vie senza dipendenze. Il formato compatto `#share` del builder è già lì e si riusa. |
| Hosting | **GitHub Pages dalla root di `main`** | Nessun build: si pubblica quello che c'è. Router a hash, niente trucco `404.html`. |
| Persistenza | **localStorage + migrazioni versionate** | API sincrona, ~20 KB per personaggio, nessun costo di IndexedDB per il volume in gioco. |
| Gesti | **Scroll-snap nativo + pochi gesti a puntatore, mai esclusivi** | Il browser gestisce già bene ciò che gli si lascia gestire; ogni gesto ha un bottone equivalente. |
| Design system | **Esteso in modo additivo, a monte** | I pezzi che mancano servono anche alle altre app del club: si aggiungono al DS, non si copiano qui. |

---

## 3. Architettura

### 3.1 Struttura dei file

```
dnd-companion/
├── index.html                  shell unica (app-shell + <template> dei blocchi)
├── manifest.webmanifest
├── sw.js                       service worker scritto a mano
├── .nojekyll
├── app.css                     solo ciò che il design system non copre
├── src/
│   ├── main.js                 bootstrap: store → router → UI
│   ├── router.js               router a hash (~50 righe)
│   ├── store.js                stato + persistenza + eventi (pub/sub minimale)
│   ├── storage.js              wrapper localStorage, versioning, migrazioni
│   ├── dom.js                  helper di rendering + delega eventi
│   ├── gestures.js             pressione lunga e trascinamento maniglia (~90 righe)
│   ├── i18n.js                 t() minimale
│   ├── domain/                 ── LOGICA PURA, zero DOM, 100% unit-testata ──
│   │   ├── rng.js              RNG crypto iniettabile (seedabile nei test)
│   │   ├── dice.js             parser + valutatore della notazione
│   │   ├── check.js            prove, tiri salvezza, contrapposti
│   │   ├── character.js        normalizzazione snapshot + valori derivati
│   │   ├── progress.js         PX, soglie, calcolo del level-up (per edizione)
│   │   ├── edition.js          quale edizione vale qui, e con che precedenza
│   │   ├── session.js          PF, slot, riposi, condizioni, usi
│   │   ├── spells.js           indice, ricerca, caricamento dei blocchi, confronto fra edizioni
│   │   └── importer.js         JSON del builder + link #share → snapshot
│   ├── views/                  library, sheet, dice, checks, progress, levelup, spells, settings
│   └── components/             sheet-blocks, dice-tray, numpad, pips
├── data/
│   ├── rules/2014.json  rules/2024.json  rules/index.json
│   └── spells/2014/index.json  2014/l0.json … l9.json      319 incantesimi
│       spells/2024/index.json  2024/l0.json … l9.json      339 incantesimi
├── scripts/
│   ├── build-rules.mjs         genera il pacchetto regole dal repo del builder
│   ├── build-spells.mjs        estrae i due compendi dai PDF degli SRD italiani
│   ├── build-bridge.mjs        ponte id inglesi del builder → incantesimi italiani, per edizione
│   └── size-check.mjs          fa fallire la CI se si sfonda il budget
├── design-system/              submodule Brainstorm-Club/design-system (pin a un commit)
├── lang/{it,en}.json
├── tests/{unit,e2e,fixtures}/
└── CLAUDE.md AGENTS.md README.md DATA-SOURCES.md LICENSE
```

### 3.2 Il modello dati: snapshot congelato + stato di gioco

La regola che tiene in piedi tutto: **quello che arriva dal builder non si tocca mai**.

```js
{
  v: 1,                                  // versione dello schema, per le migrazioni
  characters: {
    "<id>": {
      snapshot: { /* CharacterData del builder, congelato */ },
      meta:     { importedAt, source, variant, name, snapshotFormat, edition: '2014'|'2024' },
      play: {
        hp: { cur, temp }, hitDice: { spent }, slots: { "1": {used}, … },
        conditions: [], inspiration: false, coins: {…}, uses: { "<featureId>": n },
        xp: 0, deaths: { succ, fail }, notes: ""
      },
      levels: [ /* storico degli avanzamenti: { at, from, to, diff } */ ]
    }
  },
  activeId,
  settings: { theme, lang, xpMode: 'xp'|'milestone', edition: 'auto'|'2014'|'2024' },
  diceLog: [ /* ring buffer, max 50 */ ]
}
```

Il level-up **non muta** lo snapshot: ne produce uno nuovo e registra il diff in `levels`, così si torna indietro
se il master cambia idea. La vista scheda legge sempre `snapshot + play` fusi da `character.js`.

### 3.3 Rendering senza framework

Niente virtual DOM: ogni vista è una funzione `render(state) → void` che riscrive il proprio contenitore da
`<template>` clonati, più **delega eventi** a livello di contenitore (un listener per vista, non uno per riga).
Lo store notifica per *sezione* (`hp`, `slots`, `dice`, …), così un tap sui PF non ridisegna l'inventario.

---

## 4. Design system: cosa c'è, cosa manca, come si estende

Consumato come **git submodule**, importando `brainstorm.css`. Già pronto e usato così com'è: `.bsc-stat`,
`.bsc-tabs`, `.bsc-sheet`, `.bsc-toast`, `.bsc-table`, `.bsc-badge`, `.bsc-field`, `.bsc-switch`, `.bsc-btn`,
`.bsc-card`, `.bsc-appbar`, più `theme.js` (tri-stato scuro → chiaro → auto) e `ui.js`.

### 4.1 Le lacune, verificate leggendo il CSS

Il design system è nato per il **sito**, non per un'app a schermo intero tenuta in mano. Il segnale è netto:
`env(safe-area-inset-*)` **non compare nemmeno una volta** in tutto il repo. Su iPhone questo significa appbar
sotto la Dynamic Island, toast e bottom sheet sotto la barra home.

| Manca | Cosa aggiungere | Perché serve qui (e altrove) |
|---|---|---|
| Safe area | Utility `.bsc-safe-t/-b` + varianti `.bsc-appbar--app`, `.bsc-sheet--app`, `.bsc-toast--app` | Qualunque app del club installata come PWA ha lo stesso problema |
| Navigazione da pollice | `.bsc-tabbar` — barra inferiore, icona + etichetta, safe-area inclusa | `.bsc-appbar` sta in alto, `.bsc-tabs` sono tab testuali |
| Contatori a pallini | `.bsc-pips` (usati/liberi, tap per consumare) | Slot, dadi vita, tiri salvezza contro morte, usi dei privilegi: **il componente più usato dell'app** |
| Barra risorsa | `.bsc-meter` con stati (pieno / ferito / critico) | PF e avanzamento PX |
| Tastierino | `.bsc-numpad` — cifre grandi, target ≥ 44 px | Danno, cura, CD, PX: si digita al buio |
| Stepper | `.bsc-stepper` — −/valore/+ touch | Monete, PX rapidi, contatori |
| Pager | `.bsc-pager` — contenitore scroll-snap orizzontale + indicatore | Lo swipe fra sezioni (§ 5.2.1) senza una riga di JS |
| Chip selezionabile | `.bsc-chip` / `.bsc-chip--on` | Condizioni attive, filtri del compendio |
| Riga chiave/valore | `.bsc-kv` — etichetta, valore, azione | Il pane e burro della vista scheda |
| Dado e risultato | `.bsc-die` (pulsante-dado) e `.bsc-roll` (totale grande, dadi singoli, critico/fallimento) | Specifico dei GDR, ma il club fa solo quello |
| Sheet trascinabile | `.bsc-sheet--grab` (maniglia + stati chiusa/mezza/aperta) | Il dice tray e la scheda di un incantesimo |
| Token mancanti | `--bsc-tap-min: 44px`, `--bsc-z-appbar/-tabbar/-sheet/-toast` (stessi valori già hardcoded: 50/200/300) | Oggi gli z-index sono numeri sparsi nel CSS |

### 4.2 Regole di estensione

1. **Additivo e basta.** Nessun selettore o token esistente viene modificato o rimosso. Le varianti nuove sono
   modificatori (`--app`, `--grab`), mai riscritture.
2. **A monte, non qui.** Ogni componente nasce nel repo `Brainstorm-Club/design-system`, su un branch, con la sua
   voce nella style guide `index.html` e una riga nel README.
3. **Il push lo fa l'utente.** Il lavoro arriva fino al branch e alla descrizione della PR.
4. **Il companion consuma un pin.** Il contratto fra i lotti è il nome della classe, non la sua implementazione.
5. **Se una regola CSS finisce in `app.css` con un colore o una spaziatura scritti a mano, è un bug.**

---

## 5. Le funzioni, in dettaglio

### 5.1 Import, libreria, e l'edizione di ogni personaggio

Tre percorsi verso lo stesso `importer.js`: **file**, **incolla**, **link** (`…/share/<base64url>` del builder,
decodificato riscrivendo in ~40 righe il formato compatto `COMPACT_KEYS`, con gli stessi limiti di sicurezza).

Ogni personaggio importato riceve un'**edizione**, dedotta dalla variante e non chiesta all'utente:

| Variante nello snapshot | Edizione | Perché |
|---|---|---|
| `dnd2024` | 2024 — SRD 5.2.1 | è nata lì |
| `dnd5e` | 2014 — SRD 5.1 | idem |
| `brancalonia`, `apocalisse` | *nessuna, in v1* | l'import si ferma con un messaggio esplicito: «serve il pacchetto Brancalonia, arriva nella v3». Niente import mutilato, niente scheda a metà |

Da lì in avanti la scheda parla una lingua sola: privilegi, incantesimi, slot e avanzamento vengono tutti
dall'SRD di quell'edizione. Chi vuole guardare l'altra può (§ 5.1.1), ma deve **scegliere di farlo**.

**Cosa resta senza testo, e lo dice.** I tredici incantesimi che il builder prende dal Player's Handbook non
sono nell'SRD: l'app ne mostra il **nome** salvato nello snapshot e una riga che spiega perché non c'è altro.
Meglio un buco dichiarato che un testo inventato — o copiato da dove non si può.

### 5.1.1 Le edizioni, e come si passa dall'una all'altra

I nomi in giro sono quattro per due cose sole. L'app ne usa due, e mostra gli altri come sottotitolo:

| Etichetta in app | Documento | Come lo chiama la gente |
|---|---|---|
| **2014** | SRD 5.1 | «5.0», «5e classica», «la vecchia» |
| **2024** | SRD 5.2.1 | «5.5», «One D&D», «la nuova» |

Tre livelli di scelta, dal più generale al più puntuale:

1. **Automatica** (predefinita): decide la variante del personaggio, come sopra.
2. **Preferenza globale** in impostazioni: «apri sempre il 2024», per chi ha convertito il tavolo.
3. **Interruttore sulla singola scheda**: un selettore segmentato `2014 | 2024` in cima all'incantesimo o al
   privilegio. Cambia solo quello che stai guardando, e non si appiccica: chiusa la scheda si torna alla regola.

Quello che rende la cosa utile invece che confusa:

- **Un'etichetta sempre visibile.** Il testo di un incantesimo non compare mai senza dire di quale edizione è.
- **Il segnale di differenza.** In fase di generazione i due testi vengono confrontati (normalizzati: spazi,
  maiuscole, unità di misura); dove divergono il record porta `differisce: true` e la scheda mostra un segno
  discreto — «cambia nel 2024» — che è un invito a guardare, non un allarme.
- **Le assenze sono spiegate.** *Dardo tracciante* non esiste nel 5.1 e *forza fantasma* non è passato nel 5.2.1:
  in quei casi il selettore mostra il lato mancante disattivato, con la ragione. Mai un pannello vuoto.
- **L'edizione del personaggio non cambia mai per sbaglio.** Guardare il 2024 su un personaggio di Brancalonia
  è una consultazione, non una conversione: slot, CD e avanzamento continuano a usare il 2014.

Libreria: elenco con nome, classe/livello, variante, PF correnti; azioni: apri, duplica, esporta, elimina,
ri-importa sopra (aggiorna lo snapshot **conservando** `play`).

### 5.2 Vista scheda

**Mobile** — sei sezioni in un pager orizzontale, ordinate per frequenza d'uso al tavolo:

1. **Gioco** (default): PF grandi + temporanei, CA, iniziativa, velocità, PB, ispirazione, condizioni, dadi vita.
2. **Prove**: le sei caratteristiche (`.bsc-stat`), tiri salvezza, abilità con competenza/maestria. **Tap = tira.**
3. **Azioni**: armi con bonus d'attacco, danno e **proprietà di maestria** (2024), attacchi speciali.
4. **Magia**: slot a pallini, CD incantesimi, bonus d'attacco, incantesimi preparati e conosciuti — ognuno apre
   la sua scheda completa dal compendio (§ 6.2).
5. **Zaino**: equipaggiamento, monete (editabili), tesoro.
6. **Storia**: privilegi e tratti col testo, personalità/ideali/legami/difetti, background, alleati, note.

Navigazione: `.bsc-tabbar` in basso (zona pollice) + swipe fra le sezioni. Il dice tray si apre dal basso da
qualunque sezione: **tirare non deve mai costare la perdita di quello che stai guardando.**

**Tablet** — master-detail a tre colonne: sinistra la lista personaggi e le sezioni, centro il contenuto, destra
**fissa** il dice tray con storico e prove rapide. Breakpoint a 768 px e 1024 px con CSS grid — **nessun ramo JS
sul viewport**, così non esistono due implementazioni da tenere allineate.

#### 5.2.1 Gesti, e le zone in cui non si può giocare

Il rischio dei gesti su web non è inventarli: è che il **sistema operativo abbia già prenotato quel movimento**.

| Zona | iOS (Safari e PWA) | Android (Chrome, navigazione a gesti) |
|---|---|---|
| Bordo sinistro / destro | indietro / avanti (~20 px) | indietro di sistema (~24 px per lato) |
| Bordo superiore | Notification Center e Control Center | tendina delle notifiche |
| Bordo inferiore | home indicator e app switcher (~34 px) | barra home |
| In cima allo scorrimento | — | pull-to-refresh |

Nessuna API web permette di rivendicare quelle zone. L'unica difesa è **non metterci dentro i propri gesti**.

- **Lo swipe fra sezioni non è codice mio: è `scroll-snap` CSS.** Il browser gestisce inerzia, accessibilità e la
  precedenza col gesto di sistema: dito dal bordo → vince il sistema, dito dentro il contenuto → vince lo scorrimento.
- **Il dice tray si apre da una maniglia, non dal bordo**, ~32 px sopra la safe-area inferiore. Si trascina su
  (`gestures.js`, pointer events) **oppure** si tocca.
- **Niente pull-to-refresh**: `overscroll-behavior-y: contain`. Ricaricare per sbaglio a metà combattimento è il
  peggior modo di perdere il posto.

| Gesto | Dove | Azione | Equivalente sempre disponibile |
|---|---|---|---|
| Swipe orizzontale | contenuto, non dai bordi | sezione precedente/successiva | tab bar in basso |
| Trascina su la maniglia | ~32 px sopra la safe-area | apre il dice tray | tap sulla maniglia |
| Trascina giù / tap sul fondo | tray aperto | chiude | tasto chiudi, Esc |
| Tap | riga di abilità, arma, incantesimo | tira / lancia / apre la scheda | — |
| Pressione lunga 400 ms | riga di abilità o arma | prova con CD, o opzioni | tasto «…» a fine riga |
| Tap sui pallini | slot, dadi vita, usi | consuma / recupera | stepper in dettaglio |

Regole che non si negoziano:

- **Nessuna funzione raggiungibile solo con un gesto** (WCAG 2.5.1 *Pointer Gestures*, 2.5.7 *Dragging Movements*).
- Lo **zoom non si disabilita** (WCAG 1.4.4): niente `user-scalable=no`; `touch-action: manipulation` sui controlli.
- Pressione lunga: `-webkit-touch-callout: none` e `user-select: none` solo sulle righe interessate, annullata se
  il dito si sposta di più di 10 px.
- `viewport-fit=cover` + padding da `env(safe-area-inset-*)`.
- Target ≥ 44 × 44 px e **nessun elemento interattivo entro 24 px dai bordi verticali**: verificato in CI (§ 9).
- `navigator.vibrate` come miglioria progressiva; Wake Lock dove supportato.

### 5.3 Dadi

I dadi tirabili sono **d2, d3, d4, d6, d8, d10, d12, d20, d100**, in qualunque combinazione. Il d2 e il d3 non si
tirano quasi mai fisicamente, ma nelle tabelle esistono: sono di prima classe come gli altri. Il d100 si mostra
con i due d10 visibili — decine e unità — perché è così che si legge al tavolo.

```
gruppi     := espressione ( (',' | ';' | ' e ') espressione )*             → tiri indipendenti
espressione:= termine ( ('+'|'-') termine )*
termine    := [N]dM[mod] | intero
mod        := kh<n> | kl<n> | dh<n> | dl<n> | r1        (tieni/scarta alto/basso, ritira gli 1)
facce M    ∈ { 2, 3, 4, 6, 8, 10, 12, 20, 100 }        ← insieme chiuso, costante ALLOWED_FACES
scorciatoie: vantaggio|adv → 2d20kh1 ; svantaggio|dis → 2d20kl1
limiti     : N ≤ 100 per termine, ≤ 10 gruppi
```

Una faccia fuori insieme non dà un errore criptico: «il d7 non esiste — dadi ammessi: d2 d3 d4 d6 d8 d10 d12 d20 d100».

Esempi che devono funzionare: `1d20+5`, `4d12`, `2d6 e 3d20`, `4d6dl1`, `2d20kh1+3`, `1d8+1d6+2`, `1d100`, `3d3`.

- **RNG**: `crypto.getRandomValues` con rejection sampling (uniforme davvero), iniettabile per test deterministici.
- **UI**: i nove dadi come pulsanti (`.bsc-die`), contatore, campo per la notazione libera, vantaggio/svantaggio, «ritira».
- **Risultato**: totale grande, dadi singoli visibili (naturali 20 e 1 evidenziati), formula in chiaro sotto.
- **Storico**: ultimi 50 tiri con etichetta di provenienza («Furtività», «Spadone — danno»).

### 5.4 Prove, tiri salvezza, contrapposti

- **Prova**: abilità o caratteristica, CD dal tastierino, esito con **margine** («18 contro CD 14 — riuscita di 4»).
  Il naturale 20 è segnalato ma **non** trasformato in successo automatico: nelle prove quella regola non esiste,
  e l'app non deve insegnare regole sbagliate.
- **Tiro salvezza**: stesso flusso, bonus dai `savingThrowProficiencies`.
- **Contrapposto**: A = il tuo personaggio, B = un altro personaggio importato **oppure** un bonus a mano.
  Vantaggio/svantaggio per lato, pareggio configurabile.
- Da ogni riga della scheda ci si arriva precompilati: tap = tiro secco, pressione lunga = prova con CD.

### 5.5 PX e aumento di livello

- Soglie di PX dell'SRD (0, 300, 900, 2 700, … 355 000) — **identiche nelle due edizioni**; modalità **traguardi**
  per i tavoli che non le contano.
- Aggiunta rapida `+50 +100 +250 +500` o valore libero, storico, barra verso il livello successivo.
- Al superamento compare **«puoi salire di livello»**, mai automatico: sale il giocatore quando il master lo dice.
- **Procedura guidata**, un passo per schermata. I passi comuni: classe in cui salire (multiclasse compresa) →
  PF (media fissa o tiro del dado vita, tirato dall'app) → bonus di competenza → privilegi nuovi col testo
  italiano → incantesimi → riepilogo del diff e conferma.

Dove le due edizioni divergono, e il pacchetto regole deve saperlo:

| | 2014 (SRD 5.1) | 2024 (SRD 5.2.1) |
|---|---|---|
| Sottoclasse | a livelli diversi per classe (1°, 2°, 3°) | **al 3°, per tutte** |
| ASI | 4, 8, 12, 16, 19 + extra per guerriero (6, 14) e ladro (10) | stessi livelli, ma **il 19° è il dono epico**, non un ASI |
| Maestria d'arma | non esiste | proprietà per arma, quantità per classe |
| Incantesimi | «conosciuti» per bardo, stregone, ranger, warlock | quasi tutte le classi **preparano** |
| Talenti d'origine | non esistono | li dà il background |

Per questo `asiLevels` sta **per classe e per edizione** nel pacchetto regole, non come lista globale: è
esattamente il genere di dettaglio che un'app sbaglia in silenzio per vent'anni.

Per i personaggi Brancalonia e Apocalisse la procedura arriva fino in fondo sulla parte di classe base e si
ferma sulla sottoclasse, dicendo cosa non può fare e rimandando al builder per quel passo.

### 5.6 Sessione

PF (danno/cura col tastierino, temporanei separati, tiri salvezza contro morte), dadi vita spesi, slot a pallini,
condizioni (elenco con testo dell'SRD in bottom sheet), usi limitati dei privilegi, ispirazione, monete, note.
**Riposo breve** e **riposo lungo**: due bottoni che fanno la cosa giusta, con conferma e annullamento.

---

## 6. I dati

### 6.1 I due pacchetti regole

`scripts/build-rules.mjs` legge il repo del builder (default `../../dnd-builder`) e produce `data/rules/2014.json`
e `data/rules/2024.json`, stessa forma, contenuti diversi:

```json
{ "edizione": "2024", "srd": "5.2.1", "generatedAt": "…", "sourceCommit": "…",
  "xpThresholds": [...],
  "classes": { "fighter": { "hitDie": 10, "subclassLevel": 3, "casterType": null,
                            "asiLevels": [4,6,8,12,14,16], "epicBoonLevel": 19,
                            "features": [{ "level": 3, "name": "…", "description": "…" }],
                            "subclasses": { … } } },
  "spellSlots": {…}, "cantripsKnown": {…}, "preparedSpells": {…},
  "weaponMastery": {…}, "conditions": [...] }
```

Il testo italiano dei privilegi viene dagli SRD (§ 6.2), non da traduzioni nostre. Generati, non scritti a mano;
committati (GH Pages non compila nulla); si carica solo il pacchetto dell'edizione del personaggio aperto.

### 6.2 I due compendi — l'estrazione è stata provata, non stimata

Le fonti, entrambe già sul tuo disco e **entrambe CC-BY-4.0**:

| Edizione | File | Peso | Licenza |
|---|---|---|---|
| 2014 | `SRD_CC_v5.1_IT.pdf` | 5,0 MB | CC-BY-4.0, traduzione ufficiale |
| 2024 | `IT_SRD_CC_v5.2.1.pdf` | 9,3 MB | CC-BY-4.0, traduzione ufficiale (dic. 2025) |

Ho estratto entrambi prima di scrivere questa sezione, perché era il punto più rischioso del piano. I fatti:

- **Con `-layout` le due colonne si intrecciano** riga per riga e il testo esce spazzatura — che è, quasi
  certamente, l'origine del difetto noto del builder («sessanta su 307 illeggibili»).
  **Senza `-layout` l'ordine di lettura è giusto quasi ovunque, ma «quasi» non basta**: su una decina di pagine
  per edizione il riquadro colorato dell'intestazione di scuola esce dal flusso e finisce a valle del corpo,
  attaccando a un incantesimo l'intestazione del successivo — una ventina di casi per edizione. L'estrazione
  definitiva usa **`-bbox-layout`** e ricostruisce le colonne dalle coordinate; in regalo tornano i rientri di
  capoverso, che l'estrazione piatta perde. *(Corretto in fase 1: l'esplorazione si era fermata al flag
  sbagliato per il motivo giusto.)*
- **Le due edizioni hanno intestazioni diverse, e vanno due parser, non uno:**

| | 2014 (SRD 5.1) | 2024 (SRD 5.2.1) |
|---|---|---|
| Trucchetto | `Trucchetto di <Scuola>` | `Trucchetto di <Scuola> (classi)` |
| Livellato | `<Scuola> di 2° livello` | `<Scuola> di 2º livello (classi)` |
| Ordinale | `°` (U+00B0) | `º` (U+00BA) — **caratteri diversi**, un parser solo li sbaglia |
| Classi | **non nell'intestazione**: stanno nelle liste per classe | nell'intestazione, fra parentesi |
| Maiuscole | incoerenti (`Trucchetto di necromanzia`) | coerenti |

- **I conti del 2024 tornano da soli: 27 trucchetti + 312 livellati = 339, e le righe `Tempo di lancio:` sono
  esattamente 339.** Distribuzione per livello: 57, 57, 42, 34, 38, 31, 20, 17, 16.
- **Nel 2014 la discrepanza era doppia, e nessuna delle due era quella che sembrava.** I trucchetti sono **24**,
  non 26: *Blade Ward* e *Friends* sono del Player's Handbook e nell'SRD 5.1 non ci sono — il conteggio
  dell'esplorazione era sbagliato. E il vero difetto era **una riga sola**: l'intestazione di *Dominare persone*
  esce come `Ammaliamento di 5° li Eroismoello`, perché nel PDF il nome dell'incantesimo successivo si sovrappone
  alla parola «livello». Riparata quella, **319 = 319**. È esattamente ciò per cui serve un'invariante: non ha
  detto «il parser è rotto», ha detto *dove* guardare.
- **Il piè di pagina è ovunque:** «Rivendita vietata. È permesso fotocopiare o stampare questo documento per il
  solo uso personale.» compare **453 volte** nel PDF 5.1 e finisce dentro il flusso del testo. È la versione
  italiana esatta della riga che nel builder è colata dentro undici descrizioni di incantesimi. Il sanificatore
  la toglie, insieme ai numeri di pagina e alle intestazioni correnti, e **la CI fallisce se ne resta una**.

Le classi del 2014 non stanno nell'intestazione, come invece nel 2024: stanno nelle «Liste degli incantesimi»
più avanti nel documento. **Si prendono da lì**, non dal builder: coprono tutti e 319 gli incantesimi (il builder
ne ha 317) e sono la fonte autorevole. *(In fase 1 si è rivelata una scelta migliore di quella pianificata.)*

Formato prodotto, un record per incantesimo per edizione:

```json
{ "id": "dardo-incantato", "nome": "Dardo incantato", "livello": 1,
  "scuola": "Invocazione", "classi": ["mago","stregone"],
  "tempoDiLancio": "azione", "gittata": "36 metri", "componenti": "V, S",
  "durata": "istantanea", "rituale": false, "concentrazione": false,
  "testo": "…", "aLivelliSuperiori": "…",
  "edizione": "2024", "fonte": "SRD 5.2.1 IT", "differisce": true }
```

`differisce` vuol dire **«le regole sono cambiate»**, non «il testo è cambiato»: i due SRD italiani sono
traduzioni indipendenti, e confrontare la prosa accendeva la spia su 308 incantesimi su 315 — un segnale che si
accende su tutto non dice niente. Si confrontano livello, scuola, rituale, concentrazione e lista di classi, e
`cambiamenti: string[]` dice *cosa* è cambiato. Risultato: **58 cambi di lista di classe — esattamente la cifra
che il builder documenta**, raggiunta per una strada del tutto indipendente; 23 di scuola, 9 di concentrazione,
22 assenti da un'edizione. **Dei 317 comuni, 231 restano invariati.**

**Il ponte.** Il builder salva gli incantesimi come **id inglesi** (`fire-bolt`, `1-bane`). `build-bridge.mjs`
costruisce due tabelle id → incantesimo italiano, una per edizione, agganciando per (livello, scuola, lista di
classi) e rifinendo a mano i residui, che vanno **elencati in un rapporto**, non ignorati. Ciò che non aggancia —
i tredici incantesimi del Player's Handbook, per esempio — resta visibile col nome e senza testo.

**Attribuzione, obbligatoria e verbatim**, una per edizione, in app, nel README e in `DATA-SOURCES.md`:

> Quest'opera include materiale tratto dal System Reference Document 5.2.1 ("SRD 5.2.1") di Wizards of the Coast
> LLC, disponibile all'indirizzo https://www.dndbeyond.com/srd. Il SRD 5.2.1 è concesso in licenza ai sensi della
> licenza di attribuzione 4.0 Internazionale di Creative Commons, disponibile all'indirizzo
> https://creativecommons.org/licenses/by/4.0/legalcode.

> Questo lavoro include materiale del System Reference Document 5.1 ("SRD 5.1") di Wizards of the Coast LLC
> disponibile al sito https://dnd.wizards.com/it/resources/systems-reference-document. L'SRD 5.1 è concesso in
> licenza sotto l'Attribuzione 4.0 Internazionale di Creative Commons disponibile al sito
> https://creativecommons.org/licenses/by/4.0/legalcode.it.

I PDF **non entrano nel repo**: si committa solo il JSON generato, e lo script documenta da dove si scaricano.

### 6.3 Come stanno in memoria senza sfondare il budget

658 incantesimi con testo integrale sono ~2,6 MB di JSON: tenerli vivi costerebbe più di quanto un telefono debba
spendere per una scheda. Quindi ogni compendio è **sfaccettato**:

- `spells/<ed>/index.json` (~25 KB gz l'uno): id, nome, livello, scuola, classi, rituale, concentrazione,
  `differisce`. **Entrambi sempre in memoria**: bastano per elenchi, ricerca, filtri, confronti e per tutto ciò
  che la scheda mostra senza aprire nulla.
- `spells/<ed>/l0.json … l9.json` (~25-45 KB gz l'uno): il testo. Si carica il blocco che serve, se ne tengono al
  massimo due vivi, gli altri si lasciano andare.

Il service worker li mette **tutti** in cache (§ 7), quindi «sempre disponibili offline» è vero anche cambiando
edizione senza rete; ma la memoria viva resta quella dei due indici più un blocco o due.

### 6.4 Architettura a pacchetti — perché la v3 sarà un'aggiunta

Tutto ciò che è «regole» vive in **pacchetti** dietro un registro, `data/packs.json`:

```json
{ "v": 1, "packs": [
  { "id": "srd-2014", "nome": "D&D 2014 — SRD 5.1", "edizione": "2014",
    "incluso": true,  "licenza": "CC-BY-4.0", "kb": 470,
    "regole": "rules/2014.json", "incantesimi": "spells/2014/" },
  { "id": "srd-2024", "nome": "D&D 2024 — SRD 5.2.1", "edizione": "2024",
    "incluso": true,  "licenza": "CC-BY-4.0", "kb": 490,
    "regole": "rules/2024.json", "incantesimi": "spells/2024/" }
] }
```

`incluso: true` significa «spedito con l'app e precaricato». La v3 aggiungerà voci con `incluso: false` e un
`url`: si scaricano da dentro l'app, finiscono in cache, e da quel momento le varianti che dichiarano si
importano. Il motore non sa cosa siano Brancalonia o Apocalisse: sa leggere un pacchetto.

Tre conseguenze da rispettare **fin dalla fase 0**, altrimenti la v3 diventa una riscrittura:

1. **Nessun `if (variante === …)` sparso.** Chi può gestire una variante lo decide il registro, in un punto solo
   (`domain/packs.js`). L'import interroga il registro e, se nessun pacchetto la copre, si ferma con garbo.
2. **Il pacchetto porta le sue regole, non solo i suoi testi**: livelli di sottoclasse, ASI, slot, dado vita.
   Un pacchetto Acheron dichiarerà `"base": "srd-2014"` e ne erediterà tutto ciò che non ridefinisce.
3. **La licenza è un campo del pacchetto**, mostrato dove il pacchetto si scarica e nei crediti. Ciò che non è
   CC-BY non viene spedito con l'app: si scarica, con la sua attribuzione addosso.

## 7. PWA e offline

- `manifest.webmanifest`: icone (SVG del DS + PNG 192/512), `display: standalone`, `start_url: "./"`, tema carbone.
- `sw.js` scritto a mano (~90 righe, nessun Workbox), con **precache in tre tempi**:
  1. la shell (app, CSS, font) e i due indici dei compendi — l'app è usabile appena finisce, e già si cerca;
  2. il pacchetto regole e i blocchi di testo dell'**edizione in uso**;
  3. in coda, l'altra edizione per intero.
  Chi apre l'app e la chiude dopo dieci secondi ha comunque tutto la volta dopo; chi resta ce l'ha subito. In
  nessuno dei tre tempi il primo avvio rallenta: la shell è già in pagina prima che il secondo cominci.
- `skipWaiting` su richiesta esplicita con toast «aggiornamento disponibile».
- Tutto è già locale: funziona in aereo, in cantina, in un capanno senza campo. È il caso d'uso normale.

---

## 8. Budget e sostenibilità

Il compendio sempre incluso cambia i conti, e vanno scritti onestamente: cresce il **peso installato**, non il
**primo avvio**.

| Metrica | Limite | Cosa protegge |
|---|---|---|
| **Avvio (soli import statici da `main.js`)** | **< 40 KB** | il tempo che passa prima che l'app sia usabile |
| **La vista più grossa, da sola** | **< 20 KB** | che una vista non diventi un pezzo di app (tetto deciso dall'utente) |
| Primo caricamento (avvio + CSS + lingua + registro) | < 115 KB | idem, misurato dalla rete |
| JS applicativo, tutto compreso | < 200 KB | la tendenza, non la singola riga (tetto deciso dall'utente a fine fase 2) |
| CSS totale, design system incluso | < 22 KB | |
| Indici dei due compendi | < 55 KB | restano sempre in memoria |
| Testo di un compendio, 10 blocchi | < 350 KB | |
| **Peso totale installato** | **< 1,3 MB** | quanto occupa il telefono |
| Heap JS in uso su mobile | < 25 MB | |
| Lighthouse Accessibilità | ≥ 95 | |
| Lighthouse Prestazioni (mobile) | ≥ 90 | |
| Nodi DOM vivi | < 1 500 | |

**Due correzioni di rotta, dichiarate.** Il tetto sul JS applicativo era 50 KB, fissato prima che esistesse una riga di codice; a fine fase 1 è passato a 75. In fase 2 ha sfondato di nuovo, e la seconda volta il segnale non era «l'app è troppo grossa» ma **«il metro è sbagliato»**: «primo caricamento» contava `src/` per intero, viste comprese, cioè proprio i file che si caricano su richiesta. Due voci misuravano la stessa cosa e nessuna delle due l'avvio.

Ora l'avvio si misura seguendo i soli import **statici** da `src/main.js` — 11 file, **18,7 KB** — e il tetto che morde davvero è quello sulla singola vista, dove `sheet.js` sta a 11,2 su 12. Un budget che si alza ogni volta che dà fastidio non serve a niente; uno che misura la cosa sbagliata è peggio, perché rassicura.

`scripts/size-check.mjs` misura e fa fallire la CI: un budget che nessuno verifica è un desiderio. Impostazione
W3C WSG come nel builder: client-only, zero tracciamento, zero cookie, niente immagini raster, tema scuro di
default, `prefers-reduced-motion` rispettato, contrasto AA in entrambi i temi.

---

## 9. Test: cosa si verifica, e quando

1. **Unit (Vitest)** su `src/domain/`, che è puro apposta. Copertura **≥ 90 %** su `dice`, `check`, `progress`,
   `character`, `importer`, `spells`. Include test di proprietà sul parser dei dadi (mille espressioni casuali:
   nessuna deve lanciare, ogni risultato dentro il minimo e il massimo teorici), il rifiuto delle facce fuori
   insieme, l'uniformità dell'RNG, e i livelli di ASI **per classe** (il guerriero ne ha sei, non quattro).
2. **Estrazione**, con invarianti esatte **per edizione**: intestazioni = blocchi di campi = record prodotti
   (339 per il 2024, 319 per il 2014 una volta risolta la discrepanza di uno); nessun record con testo vuoto;
   **nessun testo che contenga «Rivendita vietata», «Not for resale», un numero di pagina o un'intestazione
   corrente**; ogni scuola fra le otto ammesse; ogni classe fra quelle dell'edizione. Il ponte id-inglese →
   incantesimo italiano deve coprire **tutti** gli incantesimi presenti nelle fixture in entrambe le edizioni, e
   i residui vanno elencati in un rapporto, non ignorati. Il segnale `differisce` va verificato su un campione
   noto: incantesimi identici non devono risultare cambiati, e *dardo tracciante* (assente nel 5.1) deve
   comparire come mancante da un lato, non come vuoto.
3. **E2E (Playwright)**, Chromium con `hasTouch`, **due viewport**: iPhone 390×844 e iPad 820×1180. Percorsi:
   importa → apri scheda → swipe fra sezioni → tira → prova con CD → contrapposto → apri un incantesimo →
   **cambia edizione e torna indietro** → assegna PX → sali di livello → riposo lungo → ricarica e ritrova tutto
   → rete spenta (entrambi i compendi compresi). Un percorso dedicato importa un personaggio di **Brancalonia** e
   verifica che l'app si fermi con il messaggio giusto — «serve un pacchetto che arriva nella v3» — invece di
   importarlo a metà.
4. **Gesti e zone morte**, automatizzato: per ogni vista si misurano i bounding box di tutti gli elementi
   interattivi e si asserisce che nessuno sia entro 24 px dai bordi verticali né più piccolo di 44 × 44 px.
5. **Accessibilità e budget**: axe-core dentro Playwright su ogni vista + Lighthouse CI + `size-check`.

**Fixture**: personaggi veri esportati dal builder — 2024 (livello 1, livello 20 multiclasse, incantatore pieno,
campi mancanti), **uno 2014 puro**, più **uno di Brancalonia** che serve a provare il rifiuto garbato.

Regola di lotto: **un lotto non si chiude senza i suoi test.** Nessuna eccezione, nemmeno per la UI.

---

## 10. Lo sviluppo: lotti e agenti in parallelo

Modello preso dal builder. La condizione che lo rende possibile è una sola: **i contratti si congelano prima di
aprire i rubinetti.** Ogni agente riceve un brief scritto, file di sua competenza disgiunti, criteri di
accettazione, e chiude con i propri test verdi. Prima del merge passa un agente revisore.

### Fase 0 — Fondamenta *(sequenziale, un agente)*

Scaffold, submodule, `index.html`, router, store/storage con migrazioni, i18n, helper DOM, CI, fixture,
`CLAUDE.md` + `AGENTS.md`, e **le firme JSDoc di tutti i moduli di dominio con i test già scritti e rossi**.
Qui si congelano anche i **nomi delle classi CSS nuove**, lo **schema del record incantesimo** e le **regole di
precedenza dell'edizione** (`domain/edition.js`: automatica → preferenza globale → scavalco sulla singola scheda):
sono contratti quanto le firme delle funzioni, e tre lotti diversi ci si appoggiano.
*Gate: CI verde sugli stub, app installabile, budget misurato a vuoto.*

### Fase 1 — Sei agenti in parallelo

| | Lotto | File | Dipende da |
|---|---|---|---|
| **A** | Motore dadi (9 facce) + RNG + vista dadi + storico | `domain/dice.js`, `domain/rng.js`, `views/dice.js` | — |
| **B** | Import + normalizzazione + libreria + deduzione dell'edizione | `domain/importer.js`, `domain/character.js`, `views/library.js` | contratto `edition.js` |
| **C** | **Due** pacchetti regole (2014 e 2024) + PX e soglie + `domain/edition.js` | `scripts/build-rules.mjs`, `data/rules/`, `domain/progress.js`, `domain/edition.js` | repo builder |
| **D** | Shell responsive + tema + PWA + safe-area + precache a tre tempi | `app.css`, `sw.js`, `manifest` | contratto DS |
| **M** | **Estrazione dei due compendi**: parser separati per 5.1 e 5.2.1, sanificazione del piè di pagina, invarianti per edizione, sfaccettatura, segnale `differisce`, ponte id inglesi → italiano | `scripts/build-spells.mjs`, `scripts/build-bridge.mjs`, `data/spells/` | i due PDF |
| **DS** | **Estensione del design system** (12 voci di § 4.1), branch + PR + style guide | *altro repo* | — |

*Merge in ordine DS → D → B → A → C → M.*

### Fase 2 — Cinque agenti in parallelo

| | Lotto | Dipende da |
|---|---|---|
| **E** | Vista scheda mobile, sei sezioni, tiro rapido da ogni riga | A, B |
| **F** | Vista tablet master-detail + dice tray fisso | D, E |
| **G** | Tracker di sessione: PF, slot, dadi vita, condizioni, riposi, monete, usi | B |
| **H** | Prove, tiri salvezza, contrapposti | A |
| **I** | Gesti: pager scroll-snap, maniglia del tray, pressione lunga, test delle zone morte | D |

### Fase 3 — Quattro agenti in parallelo

| | Lotto |
|---|---|
| **J** | Avanzamento di livello guidato **per entrambe le edizioni** — dipende da C, G |
| **N** | Vista compendio: ricerca, filtri, scheda dell'incantesimo, **selettore di edizione a tre livelli e segnale «cambia nel 2024»**, aggancio dalla sezione Magia — dipende da C, M |
| **K** | Hardening: a11y, contrasto, budget, WSG, Lighthouse, memoria, gesti su dispositivo vero |
| **L** | E2E completi, README, DATA-SOURCES con l'attribuzione CC-BY, card sul sito del club, deploy |

Commit in italiano, nello stile del builder («Il tiro contrapposto non teneva conto del vantaggio del difensore»).

---

## 11. Rischi

| Rischio | Mitigazione |
|---|---|
| Il formato JSON del builder cambia | Importer tollerante + `snapshotFormat` versionato + fixture rigenerabili + test di contratto |
| Il ponte id inglesi → incantesimi italiani lascia residui | Due tabelle, una per edizione; corrispondenza per (livello, scuola, classi), residui **elencati in un rapporto** e risolti a mano; ciò che resta fuori si mostra col nome e senza testo |
| Estrazione dal PDF sporca | Invarianti per edizione in CI; `pdftotext` **senza** `-layout`; controlli su testo vuoto, piè di pagina («Rivendita vietata» compare 453 volte nel 5.1), numeri di pagina |
| Un parser solo per due edizioni | Sono formati diversi fino all'ordinale (`°` contro `º`): due parser, due suite di invarianti, nessuna astrazione prematura |
| Le 320 intestazioni contro 319 blocchi nel 5.1 | Discrepanza nota di **uno**, da chiudere a mano nel lotto M prima del merge: è il primo compito, non una sorpresa |
| L'utente non capisce quale edizione sta leggendo | Etichetta sempre visibile sul testo, edizione dedotta e mai cambiata di nascosto, consultare l'altra non converte niente |
| I due compendi sfondano la memoria | I due indici in RAM (~55 KB gz), testo sfaccettato per livello e per edizione, al massimo due blocchi vivi |
| I gesti litigano col sistema operativo | Scroll-snap nativo invece di codice, zone morte verificate in CI, ogni gesto con equivalente tappabile |
| Estendere il DS rompe le altre app | Solo additivo; il companion consuma un pin, non `main` |
| La v3 dei pacchetti Acheron diventa una riscrittura | Registro dei pacchetti e `domain/packs.js` già in fase 0; **nessun `if (variante === …)` fuori da lì**, verificato da un test che cerca la stringa nel sorgente |
| localStorage pieno (5 MB) | ~20 KB per personaggio, avviso all'80 %, storico tiri a ring buffer |
| «Vanilla» che diventa un mini-framework fatto in casa | Tetto duro: `dom.js` ≤ 100 righe, `gestures.js` ≤ 100 righe |
| Multiclasse nel level-up | Supportata, ma è la parte più fragile: fixture di livello 20 multiclasse fin dalla fase 0 |

---

## 12. Fatto significa

- I percorsi end-to-end passano su viewport telefono **e** tablet, gesti compresi.
- Nessun elemento interattivo nelle zone di sistema, nessun target sotto i 44 px: verificato dalla CI.
- L'app funziona con la rete spenta, entrambi i compendi compresi, dopo la prima visita.
- 319 + 339 incantesimi in italiano, ognuno raggiungibile dalla scheda in un tap, ognuno con la sua edizione
  scritta accanto e le due attribuzioni CC-BY al loro posto.
- Tutti i budget della § 8 rispettati, misurati dalla CI.
- Nessun colore o spaziatura fuori dai token `--bsc-*`.
- Un personaggio 2024 e uno 2014 si importano, si giocano e salgono di livello.
- Aggiungere un pacchetto nella v3 non richiede di toccare il motore: solo `data/packs.json` e i suoi file.

---

## 13. Dove siamo, e cosa resta

**Fatto**, con 266 test di unità e 50 end-to-end su due viewport:

| | |
|---|---|
| Import | file, incolla, link di condivisione; edizione dedotta; varianti non coperte rifiutate con una frase |
| Scheda | sei sezioni in un pager a scroll-snap, valori verificati contro il builder stesso |
| Dadi | nove facce, gruppi indipendenti, vantaggio, storico unico condiviso con scheda, prove e vassoio |
| Prove | abilità, tiri salvezza, contrapposti, CD col tastierino, margine dichiarato |
| Sessione | PF, temporanei, tiri contro morte, dadi vita, slot, condizioni, riposi con annullamento |
| Zaino | monete che si muovono, oggetti raccolti al tavolo, equipaggiamento iniziale in sola lettura |
| PX e livello | soglie, traguardi, avanzamento guidato in sette passi, annullabile |
| Compendio | 658 incantesimi, ricerca e filtri, selettore di edizione, «cosa cambia» |
| Vassoio | maniglia trascinabile o toccabile, terza colonna fissa su tablet |

**Fatto anche**: impostazioni (tema, lingua, PX, edizione, copia dei dati, crediti), copertura del dominio al
92,55 % con soglia in CI, controllo axe su ogni vista e in entrambi i temi, end-to-end a rete spenta,
pubblicazione su GitHub Pages e card sul sito del club.

**Resta aperto**, e sono decisioni di chi possiede i repo, non lavoro tecnico:

1. **Il design system va pubblicato.** Il branch `componenti-app` è fuso in `main` in locale — 1597 righe
   aggiunte, **zero rimosse** — ma non è su GitHub. Finché non ci arriva, il submodule del companion resta sul
   commit vecchio e `app.css` tiene le due sezioni marcate `PONTEGGIO`. Appena il repo è pubblicato si sposta
   il pin e si tolgono i ponteggi: mezz'ora, con i test a fare da rete.
2. **La nota sull'SRD**: la voce «Incapacitato» dell'SRD 5.2.1 italiano ufficiale apre dicendo «ha la condizione
   "paralizzato"». È un errore della fonte, lasciato verbatim. Se va segnalato in app, va deciso.
3. **La v3 dei pacchetti Acheron**, per cui l'architettura è già pronta (§ 6.4).
4. **Un accento conforme nel design system.** `--bsc-rosso-400` non raggiunge l'AA su nessuno dei due temi
   (4,44 su carbone, 3,63 su carta, contro 4,5): il companion lo aggira con `--bsc-text-muted`, ma la
   correzione vera è un token nuovo a monte. Il marchio resta rosso: la 1.4.3 esenta i logotipi.
5. **Wake Lock e vibrazione**, migliorie progressive del § 5.2.1 mai implementate. Al tavolo lo schermo si
   spegne ancora da solo.
6. **Ri-importa sopra** (§ 5.1): aggiornare lo snapshot conservando lo stato di gioco. Oggi «duplica» azzera.
7. **Note di sessione e usi dei privilegi**: i campi ci sono nello stato, l'interfaccia no.
