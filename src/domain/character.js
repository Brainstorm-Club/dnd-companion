/**
 * Dallo snapshot del builder ai numeri che servono al tavolo.  ── Lotto B ──
 *
 * Lo snapshot è **congelato**: questo modulo non lo modifica mai. Legge, e
 * calcola. Lo stato mutabile vive in `PlayState` (vedi `storage.js`), e i due
 * si fondono solo qui, in lettura.
 */

/** @typedef {import('../storage.js').CharacterEntry} CharacterEntry */
/** @typedef {'str'|'dex'|'con'|'int'|'wis'|'cha'} Ability */

/** @type {readonly Ability[]} */
export const ABILITIES = /** @type {const} */ (['str', 'dex', 'con', 'int', 'wis', 'cha'])

/** Come si chiamano in italiano, per esteso e in breve. */
export const ABILITY_LABELS = /** @type {Record<Ability, {nome: string, breve: string}>} */ ({
  str: { nome: 'Forza', breve: 'For' },
  dex: { nome: 'Destrezza', breve: 'Des' },
  con: { nome: 'Costituzione', breve: 'Cos' },
  int: { nome: 'Intelligenza', breve: 'Int' },
  wis: { nome: 'Saggezza', breve: 'Sag' },
  cha: { nome: 'Carisma', breve: 'Car' },
})

/**
 * Le diciotto abilità, con la caratteristica che le governa e il nome italiano
 * dell'SRD. Stanno qui e non in `lang/`: non sono interfaccia, sono regole —
 * e un pacchetto che ridefinisse l'elenco (v3) lo passa in `rules.abilita`.
 * @type {ReadonlyArray<{id: string, nome: string, caratteristica: Ability}>}
 */
export const SKILLS = /** @type {const} */ ([
  { id: 'acrobatics', nome: 'Acrobazia', caratteristica: 'dex' },
  { id: 'animal-handling', nome: 'Addestrare Animali', caratteristica: 'wis' },
  { id: 'arcana', nome: 'Arcano', caratteristica: 'int' },
  { id: 'athletics', nome: 'Atletica', caratteristica: 'str' },
  { id: 'deception', nome: 'Inganno', caratteristica: 'cha' },
  { id: 'history', nome: 'Storia', caratteristica: 'int' },
  { id: 'insight', nome: 'Intuizione', caratteristica: 'wis' },
  { id: 'intimidation', nome: 'Intimidire', caratteristica: 'cha' },
  { id: 'investigation', nome: 'Indagare', caratteristica: 'int' },
  { id: 'medicine', nome: 'Medicina', caratteristica: 'wis' },
  { id: 'nature', nome: 'Natura', caratteristica: 'int' },
  { id: 'perception', nome: 'Percezione', caratteristica: 'wis' },
  { id: 'performance', nome: 'Intrattenere', caratteristica: 'cha' },
  { id: 'persuasion', nome: 'Persuasione', caratteristica: 'cha' },
  { id: 'religion', nome: 'Religione', caratteristica: 'int' },
  { id: 'sleight-of-hand', nome: 'Rapidità di Mano', caratteristica: 'dex' },
  { id: 'stealth', nome: 'Furtività', caratteristica: 'dex' },
  { id: 'survival', nome: 'Sopravvivenza', caratteristica: 'wis' },
])

/**
 * Le armature dell'SRD, con il limite di Destrezza della loro categoria.
 * `maxDex: 0` è armatura pesante (la Destrezza non conta), `null` è leggera
 * (conta per intero). Tabella di scorta: se il pacchetto regole ne porta una
 * sua (`rules.armature`), vince quella.
 * @type {ReadonlyArray<{id: string, nome: string, ca: number, maxDex: number|null}>}
 */
export const ARMOURS = /** @type {const} */ ([
  { id: 'padded', nome: 'Imbottita', ca: 11, maxDex: null },
  { id: 'leather', nome: 'Cuoio', ca: 11, maxDex: null },
  { id: 'studded-leather', nome: 'Cuoio borchiato', ca: 12, maxDex: null },
  { id: 'hide', nome: 'Pelle', ca: 12, maxDex: 2 },
  { id: 'chain-shirt', nome: 'Giaco di maglia', ca: 13, maxDex: 2 },
  { id: 'scale-mail', nome: 'Corazza di scaglie', ca: 14, maxDex: 2 },
  { id: 'breastplate', nome: 'Corazza di piastre', ca: 14, maxDex: 2 },
  { id: 'half-plate', nome: 'Mezza armatura', ca: 15, maxDex: 2 },
  { id: 'ring-mail', nome: 'Corazza ad anelli', ca: 14, maxDex: 0 },
  { id: 'chain-mail', nome: 'Cotta di maglia', ca: 16, maxDex: 0 },
  { id: 'splint', nome: 'Corazza a strisce', ca: 17, maxDex: 0 },
  { id: 'plate', nome: 'Armatura completa', ca: 18, maxDex: 0 },
])

/** Lo scudo vale due punti in ogni edizione. */
export const BONUS_SCUDO = 2

/**
 * @typedef {object} Derived
 * @property {Record<Ability, number>} punteggi
 * @property {Record<Ability, number>} modificatori
 * @property {Record<Ability, number>} tiriSalvezza
 * @property {Array<{id: string, nome: string, caratteristica: Ability, bonus: number, competenza: boolean, maestria: boolean}>} abilita
 * @property {number} ca
 * @property {number} iniziativa
 * @property {number} competenza
 * @property {number} pfMax
 * @property {number|null} cdIncantesimi
 * @property {number|null} attaccoIncantesimi
 */

/** @param {number} punteggio @returns {number} */
export function modifier(punteggio) {
  return Math.floor((punteggio - 10) / 2)
}

/** @param {number} livello @returns {number} */
export function proficiencyBonus(livello) {
  return 2 + Math.floor((Math.min(Math.max(livello, 1), 20) - 1) / 4)
}

/** Formatta un modificatore come lo si legge su una scheda: `+3`, `−1`. @param {number} m */
export function formatModifier(m) {
  return m >= 0 ? `+${m}` : `−${Math.abs(m)}`
}

/**
 * Lo stesso modificatore in notazione da dadi: qui il segno meno deve essere
 * quello ASCII, perché lo legge il parser di `dice.js` e non un essere umano.
 * @param {number} m
 * @returns {string}
 */
export function diceModifier(m) {
  return m === 0 ? '' : m > 0 ? `+${m}` : `-${Math.abs(m)}`
}

/**
 * Tutti i valori derivati di un personaggio.
 * @param {CharacterEntry} entry
 * @param {unknown} rules  pacchetto regole dell'edizione del personaggio
 * @returns {Derived}
 */
export function derive(entry, rules) {
  const s = entry.snapshot
  const livello = intero(s['level'], 1)
  const competenza = proficiencyBonus(livello)

  const base = oggetto(s['abilityScores'])
  const razziali = oggetto(s['racialBonuses'])
  const punteggi = /** @type {Record<Ability, number>} */ ({})
  const modificatori = /** @type {Record<Ability, number>} */ ({})
  for (const ab of ABILITIES) {
    punteggi[ab] = intero(base[ab], 10) + intero(razziali[ab], 0)
    modificatori[ab] = modifier(punteggi[ab])
  }

  // Tiri salvezza: la competenza la dà la classe. Il builder l'ha già scritta
  // nello snapshot; se manca (schede vecchie, link scarni) la si chiede al
  // pacchetto regole, che è l'altra fonte legittima.
  const salvezzeSnapshot = stringhe(s['savingThrowProficiencies'])
  const competenzeSalvezza = new Set(
    salvezzeSnapshot.length ? salvezzeSnapshot : salvezzeDallaClasse(rules, s)
  )
  const tiriSalvezza = /** @type {Record<Ability, number>} */ ({})
  for (const ab of ABILITIES) {
    tiriSalvezza[ab] = modificatori[ab] + (competenzeSalvezza.has(ab) ? competenza : 0)
  }

  const competenti = new Set(stringhe(s['skillProficiencies']))
  const maestre = new Set(stringhe(s['skillExpertise']))
  const abilita = elencoAbilita(rules).map(sk => {
    const maestria = maestre.has(sk.id)
    const comp = maestria || competenti.has(sk.id)
    // La maestria **raddoppia** la competenza; la competenza semplice no.
    const dovuto = maestria ? competenza * 2 : comp ? competenza : 0
    return {
      id: sk.id,
      nome: sk.nome,
      caratteristica: sk.caratteristica,
      bonus: modificatori[sk.caratteristica] + dovuto,
      competenza: comp,
      maestria,
    }
  })

  const magia = caratteristicaMagica(s)
  const modMagia = magia ? modificatori[magia] : null

  return {
    punteggi,
    modificatori,
    tiriSalvezza,
    abilita,
    ca: classeArmatura(s, modificatori, rules),
    iniziativa: modificatori.dex,
    competenza,
    pfMax: puntiFeritaMassimi(s, modificatori.con, livello),
    cdIncantesimi: modMagia === null ? null : 8 + competenza + modMagia,
    attaccoIncantesimi: modMagia === null ? null : competenza + modMagia,
  }
}

/**
 * @typedef {object} Feature
 * @property {string} id       il valore grezzo dello snapshot, buono per l'aggancio al pacchetto
 * @property {string} nome     l'etichetta da mostrare
 * @property {number} volte    quante volte compare (il barbaro di 10° ha due ASI)
 * @property {boolean} risolto vero se il nome viene dal pacchetto regole, falso se l'abbiamo solo ripulito
 */

/**
 * I privilegi e i tratti, resi stampabili.
 *
 * Gli export veri del builder mescolano tre cose nello stesso array: id in
 * kebab-case (`draconic-ancestry`), nomi inglesi (`Rage`) e nomi con la carica
 * fra parentesi (`Action Surge (one use)`). E si ripetono: il barbaro di 10°
 * porta due volte «Ability Score Improvement». Stamparli grezzi darebbe una
 * lista mezza in codice e con dei doppioni.
 *
 * Quindi: si conserva il valore grezzo come `id` — è ciò che aggancerà il
 * pacchetto regole del lotto C — si conta quante volte compare, e il nome si
 * chiede al pacchetto. Se il pacchetto non lo conosce, l'id kebab diventa
 * leggibile e `risolto` resta falso, così l'interfaccia sa di star mostrando
 * un ripiego e non una traduzione.
 *
 * @param {CharacterEntry} entry
 * @param {unknown} rules
 * @returns {Feature[]}
 */
export function features(entry, rules) {
  const dizionario = dizionarioPrivilegi(rules, entry.snapshot)
  /** @type {Feature[]} */
  const out = []
  /** @type {Map<string, Feature>} */
  const visti = new Map()
  for (const grezzo of stringhe(entry.snapshot['featuresTraits'])) {
    const id = grezzo.trim()
    if (!id) continue
    const chiave = slug(id)
    const gia = visti.get(chiave)
    if (gia) { gia.volte += 1; continue }
    const dalPacchetto = dizionario.get(chiave)
    const voce = {
      id,
      nome: dalPacchetto ?? leggibile(id),
      volte: 1,
      risolto: dalPacchetto !== undefined,
    }
    visti.set(chiave, voce)
    out.push(voce)
  }
  return out
}

/**
 * Come agganciare un privilegio dello snapshot al pacchetto regole → il suo
 * nome italiano.
 *
 * Lo snapshot scrive la stessa cosa in tre modi (`divine-domain`,
 * `Divine Domain`, `Channel Divinity: Turn Undead`) e il pacchetto porta
 * `id`, `name` italiano e `nameEn`: si indicizza da tutte e tre le parti, in
 * forma normalizzata, così l'aggancio riesce da qualunque lato arrivi.
 * @param {unknown} rules
 * @param {Record<string, unknown>} s
 * @returns {Map<string, string>}
 */
function dizionarioPrivilegi(rules, s) {
  /** @type {Map<string, string>} */
  const mappa = new Map()
  const classi = oggetto(leggi(rules, 'classes'))
  for (const id of idClasse(s)) {
    const classe = oggetto(classi[id])
    // Anche la sottoclasse: «Frenesia» sta lì, non fra i privilegi di classe.
    const sotto = oggetto(classe['subclasses'])
    const gruppi = [classe['features'], ...Object.values(sotto).map(v => oggetto(v)['features'])]
    for (const gruppo of gruppi) {
      for (const f of lista(gruppo)) {
        const o = oggetto(f)
        const nome = stringa(o['nome']) || stringa(o['name'])
        if (!nome) continue
        for (const chiave of [o['id'], o['nameEn'], o['name'], o['nome']]) {
          const k = slug(stringa(chiave))
          if (k && !mappa.has(k)) mappa.set(k, nome)
        }
      }
    }
  }
  return mappa
}

/**
 * `draconic-ancestry` → `Draconic Ancestry`. Ripiego, non traduzione: serve a
 * non mostrare un id in mezzo a dei nomi.
 * @param {string} v
 * @returns {string}
 */
function leggibile(v) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)+$/.test(v)) return v
  return v.split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ')
}

/**
 * CA: armatura indossata, limite di Destrezza della sua categoria, scudo.
 * Senza armatura entra in gioco la Difesa senza Armatura di monaco e barbaro,
 * con la stessa regola del builder — altrimenti l'app e la scheda da cui
 * arriva il personaggio direbbero due numeri diversi.
 * @param {Record<string, unknown>} s
 * @param {Record<Ability, number>} mod
 * @param {unknown} rules
 * @returns {number}
 */
function classeArmatura(s, mod, rules) {
  const scudo = s['shield'] === true
  // Lo slug quando c'è (schema 2 del builder), il nome quando non c'è: uno
  // slug è stabile, un nome di visualizzazione può essere scritto in dieci modi
  // — ed è così che una cotta di maglia diventava «nessuna armatura».
  const indossata = trovaArmatura(stringa(s['armorId']) || stringa(s['armor']), rules)
  let ca
  if (!indossata) {
    const classi = idClasse(s)
    /** @type {number[]} */
    const senzArmatura = []
    if (classi.includes('monk') && !scudo) senzArmatura.push(mod.wis)
    if (classi.includes('barbarian')) senzArmatura.push(mod.con)
    ca = 10 + mod.dex + (senzArmatura.length ? Math.max(...senzArmatura) : 0)
  } else if (indossata.maxDex === 0) {
    ca = indossata.ca                                        // pesante: la Destrezza non conta
  } else if (indossata.maxDex !== null) {
    ca = indossata.ca + Math.min(mod.dex, indossata.maxDex)  // media: fino al limite
  } else {
    ca = indossata.ca + mod.dex                              // leggera: per intero
  }
  return ca + (scudo ? BONUS_SCUDO : 0)
}

/**
 * Il builder salva l'armatura col nome inglese (`Chain Mail`), le fixture con
 * lo slug (`chain-mail`): normalizzare li fa combaciare entrambi invece di
 * trattare in silenzio un guerriero in cotta di maglia come uno in braghe.
 * @param {string} nome
 * @param {unknown} rules
 * @returns {{id: string, nome: string, ca: number, maxDex: number|null}|null}
 */
function trovaArmatura(nome, rules) {
  if (!nome) return null
  const chiave = slug(nome)
  const tabella = tabellaArmature(rules)
  return tabella.find(a => slug(a.id) === chiave || slug(a.nome) === chiave) ?? null
}

/** @param {unknown} rules */
function tabellaArmature(rules) {
  const dalPacchetto = leggi(rules, 'armature')
  if (Array.isArray(dalPacchetto)) {
    const valide = dalPacchetto.filter(a => oggetto(a)['id'] !== undefined).map(a => {
      const o = oggetto(a)
      const maxDex = o['maxDex']
      return {
        id: stringa(o['id']),
        nome: stringa(o['nome']) || stringa(o['id']),
        ca: intero(o['ca'], 10),
        maxDex: typeof maxDex === 'number' ? maxDex : null,
      }
    })
    if (valide.length) return valide
  }
  return ARMOURS
}

/** @param {unknown} rules */
function elencoAbilita(rules) {
  const dalPacchetto = leggi(rules, 'abilita')
  if (Array.isArray(dalPacchetto) && dalPacchetto.length) {
    return dalPacchetto.map(a => {
      const o = oggetto(a)
      const car = stringa(o['caratteristica'])
      return {
        id: stringa(o['id']),
        nome: stringa(o['nome']) || stringa(o['id']),
        caratteristica: /** @type {Ability} */ (ABILITIES.includes(/** @type {Ability} */ (car)) ? car : 'dex'),
      }
    })
  }
  return /** @type {ReadonlyArray<{id: string, nome: string, caratteristica: Ability}>} */ (SKILLS)
}

/**
 * Le competenze nei tiri salvezza che il pacchetto attribuisce alla classe.
 * @param {unknown} rules
 * @param {Record<string, unknown>} s
 * @returns {string[]}
 */
function salvezzeDallaClasse(rules, s) {
  const classi = oggetto(leggi(rules, 'classes'))
  /** @type {string[]} */
  const out = []
  for (const id of idClasse(s)) {
    const dati = oggetto(classi[id])
    for (const v of stringhe(dati['savingThrows'])) if (!out.includes(v)) out.push(v)
  }
  return out
}

/**
 * Gli id di classe del personaggio: quella principale più le eventuali voci di
 * multiclasse.
 * @param {Record<string, unknown>} s
 * @returns {string[]}
 */
function idClasse(s) {
  const out = [stringa(s['className'])]
  for (const c of lista(s['classes'])) {
    const id = stringa(oggetto(c)['classId'])
    if (id) out.push(id)
  }
  return out.filter(Boolean)
}

/**
 * PF massimi: quelli scritti nello snapshot, che è la fonte di verità (il
 * giocatore può averli tirati). Solo se mancano si ricalcola dalla media.
 * @param {Record<string, unknown>} s
 * @param {number} modCon
 * @param {number} livello
 * @returns {number}
 */
function puntiFeritaMassimi(s, modCon, livello) {
  const scritti = s['maxHp']
  if (typeof scritti === 'number' && Number.isFinite(scritti) && scritti > 0) return Math.floor(scritti)
  const dado = intero(s['hitDie'], 8)
  const primo = dado + modCon
  const resto = (livello - 1) * (Math.floor(dado / 2) + 1 + modCon)
  return Math.max(primo + resto, 1)
}

/** @param {Record<string, unknown>} s @returns {Ability|null} */
function caratteristicaMagica(s) {
  const v = stringa(s['spellcastingAbility'])
  return ABILITIES.includes(/** @type {Ability} */ (v)) ? /** @type {Ability} */ (v) : null
}

// ── letture difensive: lo snapshot arriva da fuori, e `rules` pure ─────────

/** @param {unknown} o @param {string} k @returns {unknown} */
function leggi(o, k) {
  return typeof o === 'object' && o !== null ? /** @type {Record<string, unknown>} */ (o)[k] : undefined
}

/** @param {unknown} v @returns {Record<string, unknown>} */
function oggetto(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? /** @type {Record<string, unknown>} */ (v) : {}
}

/** @param {unknown} v @returns {unknown[]} */
function lista(v) {
  return Array.isArray(v) ? v : []
}

/** @param {unknown} v @returns {string[]} */
function stringhe(v) {
  return lista(v).filter(x => typeof x === 'string')
}

/** @param {unknown} v @returns {string} */
function stringa(v) {
  return typeof v === 'string' ? v : ''
}

/** @param {unknown} v @param {number} dflt @returns {number} */
function intero(v, dflt) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : dflt
}

/** @param {string} v @returns {string} */
function slug(v) {
  return v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
