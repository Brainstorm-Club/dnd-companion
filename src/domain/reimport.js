/**
 * Ri-importare sopra: aggiornare la scheda senza perdere la partita.
 *
 * Il caso è banale e capita ogni sessione. Il personaggio si modifica nel
 * builder — un livello nuovo, un oggetto, un errore corretto — e lo si riporta
 * qui. Finora c'erano due strade, e nessuna delle due era quella giusta:
 * importarlo di nuovo faceva **due** personaggi, e duplicare **azzerava** punti
 * ferita, slot, condizioni e note.
 *
 * Quello che si vuole è: la scheda nuova, la partita di prima.
 *
 * ## Cosa si tiene e cosa no
 *
 * Si tiene tutto lo stato di gioco. È il senso dell'operazione, ed è anche il
 * motivo per cui non si può tenere *ciecamente*: se nel builder il personaggio
 * è salito di livello, i punti ferita massimi sono cambiati, e i correnti
 * potrebbero puntare a un numero che non esiste più. Si sposta quindi solo ciò
 * che è diventato impossibile, e si dice cosa si è spostato.
 *
 * Gli slot funzionano al contrario: se il personaggio ne ha guadagnati di
 * nuovi arrivano vuoti, ma quelli spesi restano spesi — salire di livello non
 * ricarica niente, ci vuole un riposo.
 */

/** @typedef {import('../storage.js').CharacterEntry} CharacterEntry */
/** @typedef {import('../storage.js').PlayState} PlayState */

/**
 * @typedef {object} Cambiamento
 * @property {'livello'|'pf-max'|'pf-clampati'|'nome'|'slot-nuovi'} tipo
 * @property {number|string} [da]
 * @property {number|string} [a]
 */

/**
 * Riconosce se due schede sono lo **stesso** personaggio.
 *
 * Il builder mette un `id` in ogni export, e quello è il criterio: due schede
 * con lo stesso id sono la stessa, quale che sia il nome. Senza id — export
 * vecchi, o costruiti a mano — non si indovina: due personaggi possono
 * chiamarsi uguale, e sovrascrivere quello sbagliato è il danno peggiore che
 * questa funzione possa fare. Meglio un doppione, che si cancella.
 *
 * @param {Record<string, unknown>} a
 * @param {Record<string, unknown>} b
 * @returns {boolean}
 */
export function stessoPersonaggio(a, b) {
  const ia = a['id']
  const ib = b['id']
  return typeof ia === 'string' && ia !== '' && ia === ib
}

/**
 * La voce della libreria che il nuovo import va ad aggiornare, se c'è.
 * @param {Record<string, CharacterEntry>} caratteri
 * @param {Record<string, unknown>} snapshot
 * @returns {string|null}  la chiave nella libreria
 */
export function trovaDaAggiornare(caratteri, snapshot) {
  for (const [id, entry] of Object.entries(caratteri)) {
    if (stessoPersonaggio(entry.snapshot, snapshot)) return id
  }
  return null
}

/**
 * La scheda nuova con la partita di prima.
 *
 * @param {CharacterEntry} vecchia  quella in libreria, con lo stato di gioco
 * @param {CharacterEntry} nuova    quella appena importata
 * @returns {{entry: CharacterEntry, cambiamenti: Cambiamento[]}}
 */
export function riportaSopra(vecchia, nuova) {
  /** @type {Cambiamento[]} */
  const cambiamenti = []

  const livVecchio = intero(vecchia.snapshot['level'])
  const livNuovo = intero(nuova.snapshot['level'])
  if (livVecchio !== livNuovo) cambiamenti.push({ tipo: 'livello', da: livVecchio, a: livNuovo })

  if (vecchia.meta.name !== nuova.meta.name) {
    cambiamenti.push({ tipo: 'nome', da: vecchia.meta.name, a: nuova.meta.name })
  }

  const pfVecchi = intero(vecchia.snapshot['maxHp'])
  const pfNuovi = intero(nuova.snapshot['maxHp'])
  if (pfVecchi !== pfNuovi) cambiamenti.push({ tipo: 'pf-max', da: pfVecchi, a: pfNuovi })

  /** @type {PlayState} */
  const play = structuredClone(vecchia.play)

  // I correnti non possono superare i massimi nuovi. Al ribasso non si tocca
  // niente: un personaggio ferito resta ferito anche se è salito di livello, e
  // i punti guadagnati salendo li dà l'avanzamento, non l'import.
  if (pfNuovi > 0 && play.hp.cur > pfNuovi) {
    cambiamenti.push({ tipo: 'pf-clampati', da: play.hp.cur, a: pfNuovi })
    play.hp.cur = pfNuovi
  }

  // I dadi vita spesi non possono essere più di quelli che si hanno.
  const dvNuovi = livNuovo || intero(nuova.snapshot['level'])
  if (dvNuovi > 0 && play.hitDice.spent > dvNuovi) play.hitDice.spent = dvNuovi

  if (livNuovo > livVecchio) cambiamenti.push({ tipo: 'slot-nuovi' })

  return {
    entry: {
      ...nuova,
      play,
      // Lo storico degli avanzamenti fatti qui dentro resta: racconta cosa è
      // successo al tavolo, e non smette di essere vero perché la scheda
      // arriva aggiornata da fuori.
      levels: vecchia.levels,
      meta: { ...nuova.meta, importedAt: nuova.meta.importedAt },
    },
    cambiamenti,
  }
}

/** @param {unknown} v @returns {number} */
function intero(v) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : 0
}
