# Lavorare a lotti, in parallelo

Sei o cinque agenti alla volta, ognuno nel proprio worktree, su **file disgiunti**. Funziona per una ragione
sola: i contratti sono congelati prima che i rubinetti si aprano.

## Il contratto è già scritto

- **Firme e tipi**: le JSDoc in `src/domain/*.js`. Le funzioni sono lì, con la loro documentazione, e lanciano
  `non implementato — lotto X`. Non cambiare le firme senza dirlo agli altri lotti che le usano.
- **Comportamenti attesi**: `tests/unit/contratti.test.js`. Ogni `it.todo` è un compito. Il lotto lo trasforma
  in un test vero. **Non si cancellano**: si implementano.
- **Nomi delle classi CSS**: `PIANO.md` § 4.1. Se il design system non le ha ancora, si usano lo stesso: il
  contratto è il nome, non l'implementazione.
- **Regole sul codice**: `tests/unit/architettura.test.js`. Valgono per tutti.

## Come si chiude un lotto

1. I `it.todo` del proprio lotto sono diventati test veri, e passano.
2. `npm run check` pulito, `npm test` verde, `npm run size` dentro i budget.
3. Se il lotto tocca l'interfaccia: un end-to-end che prova il percorso, su **entrambi** i viewport.
4. Un agente revisore prima del merge.

## Ordine di merge

**Fase 1**: DS → D → B → A → C → M
**Fase 2**: E, F, G, H, I (dopo la fase 1)
**Fase 3**: J, N, K, L

## Il lotto DS è speciale

Vive nel repo `Brainstorm-Club/design-system`, non qui. **Solo aggiunte**: nessun selettore o token esistente
va modificato o rimosso, perché altre app del club dipendono da quel file. Ogni componente nuovo porta la sua
voce nella style guide. Il push su quel repo lo decide l'utente, non l'agente.
