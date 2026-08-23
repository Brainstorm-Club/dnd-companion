# D&D Companion — la scheda al tavolo

App compagna del [D&D Character Builder](https://brainstorm-club.github.io/dnd-character-builder/) del
**Brainstorm Club**. Si importa il JSON di un personaggio e lo si gioca dal telefono: statistiche, inventario,
dadi, prove con CD, tiri contrapposti, punti esperienza e aumento di livello.

**→ [Apri l'app](https://brainstorm-club.github.io/dnd-companion/)** · funziona senza rete, si installa dal browser.

## Come si porta un personaggio dal builder al telefono

Tre vie, tutte offline:

1. **File** — nel builder, «esporta JSON»; nell'app, «importa da file».
2. **Incolla** — apri il JSON, copialo, incollalo nell'app.
3. **Link** — nel builder, «condividi»; incolla il link nell'app.

Da lì in poi il personaggio vive sul telefono: nessun account, nessun server, niente esce dal dispositivo.

## Cosa copre

- **D&D 2014** (SRD 5.1) e **D&D 2024** (SRD 5.2.1), in italiano, con il testo integrale degli incantesimi.
- L'edizione si sceglie da sé in base al personaggio; si può confrontare l'altra in un tap, senza convertire niente.
- Brancalonia, Apocalisse e gli altri giochi Acheron arriveranno come **pacchetti scaricabili**.

## Sviluppo

```bash
git clone --recurse-submodules https://github.com/Brainstorm-Club/dnd-companion.git
cd dnd-companion && npm install
npm run serve     # http://localhost:4173
npm test          # unità
npm run test:e2e  # telefono e tablet
```

Nessun passo di build: il repo *è* il sito. Le uniche dipendenze sono di sviluppo — a runtime l'app non ne ha.

## Licenze

Il codice è MIT. I dati di gioco vengono dagli SRD di Wizards of the Coast sotto CC-BY-4.0: vedi
[DATA-SOURCES.md](DATA-SOURCES.md) per le attribuzioni, che sono obbligatorie e sono riportate anche in app.
