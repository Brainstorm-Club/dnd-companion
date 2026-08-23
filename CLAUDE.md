# Character Companion — guida per chi ci lavora

**La scheda al tavolo.** App compagna del [D&D Character Builder](https://github.com/Brainstorm-Club/dnd-character-builder):
si importa il JSON di un personaggio e lo si gioca dal telefono. Il piano completo è in `PIANO.md`.

## Comandi

```bash
npm test           # unità (vitest)
npm run check      # tipi (tsc --checkJs su src/ e scripts/)
npm run size       # budget di peso — fa fallire la CI se si sfonda
npm run test:e2e   # end-to-end (playwright, viewport telefono e tablet)
npm run serve      # server statico su :4173
```

## Architettura in sei righe

- **Vanilla ESM, nessun build step.** Il repo *è* il sito: GitHub Pages serve la root così com'è.
- **Zero dipendenze a runtime.** Le uniche dipendenze sono di sviluppo (test, tipi, lighthouse).
- **Tipi con JSDoc**, verificati da `tsc --checkJs`. Niente TypeScript da compilare.
- **`src/domain/` è puro**: nessun DOM, nessuna rete. È lì che vive la logica, ed è il motivo per cui si testa.
- **Router a hash**, perché su GitHub Pages i percorsi richiederebbero il trucco del `404.html`.
- **Due edizioni**: `2014` (SRD 5.1) e `2024` (SRD 5.2.1), entrambe CC-BY-4.0 e in italiano.

## Le cinque regole che non si negoziano

1. **Lo snapshot del builder non si tocca mai.** Lo stato di gioco vive a parte; salire di livello crea uno
   snapshot nuovo con il diff, non modifica il vecchio.
2. **Nessun confronto sulla variante di gioco fuori da `src/domain/packs.js`.** La v3 aggiungerà Brancalonia
   scrivendo una voce in `data/packs.json`: se le varianti si spargono nel codice, quella promessa è già rotta.
   C'è un test che lo verifica leggendo i sorgenti.
3. **Nessun gesto senza equivalente tappabile** (WCAG 2.5.1 e 2.5.7), nessun controllo entro 24 px dai bordi
   verticali, nessun target sotto i 44 px. Verificato in end-to-end, non a occhio.
4. **Nessun colore o spaziatura scritti a mano.** O si usa un token `--bsc-*`, o il componente manca al design
   system e va aggiunto **lì**, in modo additivo (mai modificare l'esistente). C'è un test anche per questo.
5. **Un lotto non si chiude senza i suoi test.** Nemmeno per la UI.

## Dove sta cosa

| Cosa | Dove |
|---|---|
| Logica pura, testata | `src/domain/` |
| Stato e persistenza | `src/store.js`, `src/storage.js` |
| Viste | `src/views/`, template in `index.html` |
| Design system (submodule) | `design-system/` |
| Registro dei pacchetti | `data/packs.json` |
| Regole e compendi generati | `data/rules/`, `data/spells/` |
| Generatori | `scripts/build-rules.mjs`, `scripts/build-spells.mjs` |
| Contratti dei lotti | `tests/unit/contratti.test.js` |
| Regole sul codice | `tests/unit/architettura.test.js` |

## Sui tipi

`jsconfig.json` controlla `src/` e `scripts/`, **non** `tests/`: i test usano finti parziali di proposito
(un `localStorage` finto non è uno `Storage`), e tiparli davvero aggiungerebbe rumore invece che sicurezza.

## Sui dati

I PDF degli SRD **non entrano nel repo** (`.gitignore` esclude `*.pdf`): si committa solo il JSON generato.
Ogni pacchetto porta la propria attribuzione CC-BY verbatim, e va mostrata in app. Materiale non-SRD non si
spedisce: se ne mostra il nome e si dichiara perché non c'è il testo.

## Stile

Commit in italiano, una frase che dice cosa è cambiato e perché — come nel builder («Il tiro contrapposto non
teneva conto del vantaggio del difensore»). Commenti in italiano, e solo dove spiegano una *ragione*: il codice
dice già cosa fa.
