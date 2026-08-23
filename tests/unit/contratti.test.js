/**
 * I contratti dei lotti ancora da fare.
 *
 * Ogni `it.todo` è un comportamento che il lotto deve rendere vero e
 * trasformare in un test vero. Sono elencati qui perché più agenti lavorano in
 * parallelo su file disgiunti: questo file è ciò che li tiene d'accordo su cosa
 * significhi «fatto», senza che debbano leggersi il codice a vicenda.
 *
 * I lotti chiusi non compaiono più: i loro comportamenti vivono nei test veri
 * (`dice.test.js`, `importer.test.js`, `character.test.js`, `rules.test.js`,
 * `spells.test.js`). Un `it.todo` che sopravvive al proprio lotto è rumore.
 */
import { describe, it } from 'vitest'

describe('lotto G — sessione', () => {
  it.todo('il danno consuma prima i PF temporanei')
  it.todo('la cura non supera i PF massimi')
  it.todo('il riposo lungo riempie PF e slot e restituisce metà dei dadi vita')
  it.todo('ogni funzione è pura: lo stato di partenza non viene toccato')
})

describe('lotto H — prove', () => {
  it.todo('il 20 naturale in una prova NON è successo automatico')
  it.todo('riporta il margine rispetto alla CD')
  it.todo('il vantaggio tiene il più alto, lo svantaggio il più basso')
  it.todo('il contrapposto dichiara il vincitore, o il pareggio secondo la regola scelta')
})

describe('lotto I — gesti', () => {
  it.todo('nessun elemento interattivo entro 24 px dai bordi verticali')
  it.todo('nessun target più piccolo di 44 × 44 px')
  it.todo('ogni gesto ha un equivalente tappabile')
  it.todo('la pressione lunga si annulla se il dito si sposta di più di 10 px')
})
