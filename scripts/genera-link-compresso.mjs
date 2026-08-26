#!/usr/bin/env node
/**
 * Genera la fixture `tests/fixtures/qr/link-compresso-2024.txt`: un link di
 * condivisione nel **formato compresso** del builder, con dentro un personaggio
 * che l'app copre davvero (D&D 2024).
 *
 * L'altra fixture compressa che abbiamo — `lucian.testo.txt`, letta da un QR
 * vero — è di Apocalisse, quindi prova solo la strada del rifiuto. Serviva
 * anche il caso che arriva in fondo, e per averlo bisogna generarlo.
 *
 * Rieseguibile: riscrive il file da capo, e a parità di sorgente il risultato è
 * lo stesso (deflate è deterministico a parità di implementazione).
 *
 *     node scripts/genera-link-compresso.mjs
 *
 * La compattazione qui sotto ricalca `compactCharacter()` di
 * `dnd-builder/src/utils/shareCharacter.ts`: è un contratto di formato, non
 * codice condiviso, e va tenuto allineato a mano come già `COMPACT_KEYS`.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { COMPACT_KEYS, MARCATORE_COMPRESSO } from '../src/domain/importer.js'

const SORGENTE = 'tests/fixtures/reale-dnd2024-guerriero-3.json'
const DESTINAZIONE = 'tests/fixtures/qr/link-compresso-2024.txt'
const BASE = 'https://brainstorm-club.github.io/dnd-character-builder/share/'

/**
 * @param {Record<string, unknown>} char
 * @returns {Record<string, unknown>}
 */
function compatta(char) {
  /** @type {Record<string, unknown>} */
  const compatto = {}
  for (const [piena, breve] of Object.entries(COMPACT_KEYS)) {
    const v = char[piena]
    if (v === undefined || v === null || v === '' || v === 0 || v === false) continue
    if (Array.isArray(v) && v.length === 0) continue
    if (typeof v === 'object' && !Array.isArray(v)) {
      const valori = Object.values(/** @type {Record<string, unknown>} */ (v))
      if (valori.every(x => x === 0 || x === null || x === undefined)) continue
    }
    compatto[breve] = v
  }
  return compatto
}

/**
 * @param {string} testo
 * @returns {Promise<Uint8Array>}
 */
async function sgonfia(testo) {
  const cs = new CompressionStream('deflate-raw')
  const w = cs.writable.getWriter()
  void w.write(new TextEncoder().encode(testo))
  void w.close()
  return new Uint8Array(await new Response(cs.readable).arrayBuffer())
}

/** @param {Uint8Array} bytes @returns {string} */
function base64url(bytes) {
  return Buffer.from(bytes).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const char = JSON.parse(readFileSync(SORGENTE, 'utf8'))
const json = JSON.stringify(compatta(char))
const payload = MARCATORE_COMPRESSO + base64url(await sgonfia(json))
writeFileSync(DESTINAZIONE, `${BASE}${payload}\n`)

console.log(`${DESTINAZIONE}: ${json.length} byte di JSON → ${payload.length} di payload`)
