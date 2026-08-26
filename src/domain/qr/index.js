/**
 * Leggere un QR code, senza librerie.
 *
 * Il builder stampa la scheda come QR: un link di condivisione compresso, che
 * si porta dietro il personaggio per intero perché dietro non c'è un server.
 * Qui lo si rilegge dalla telecamera.
 *
 * Il lavoro è in due metà, e stanno in due file perché sono due problemi
 * diversi: da un'immagine storta e rumorosa a una griglia di moduli
 * (`immagine.js`), e da una griglia di moduli al testo (`moduli.js`).
 *
 * Dove c'è, si usa `BarcodeDetector` — è il sistema operativo che decodifica,
 * ed è più veloce e più tollerante di qualunque cosa scriveremmo noi. Ma non
 * c'è su Safari, cioè sulla metà dei telefoni: la strada nostra non è un
 * ripiego, è quella che regge il caso normale.
 */

import { matriceDa } from './immagine.js'
import { testoDa } from './moduli.js'

/**
 * @param {Uint8ClampedArray} dati  RGBA, come da `ImageData`
 * @param {number} larghezza
 * @param {number} altezza
 * @returns {string|null}  il testo del codice, o null se non ce n'è uno leggibile
 */
export function leggiQr(dati, larghezza, altezza) {
  const matrice = matriceDa(dati, larghezza, altezza)
  if (!matrice) return null
  return testoDa(matrice)
}
