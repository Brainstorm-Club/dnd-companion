/**
 * Il minimo indispensabile per costruire DOM senza un framework.
 *
 * Tetto dichiarato nel piano: **cento righe**. Se serve di più, la complessità
 * è nel posto sbagliato — quasi sempre in una vista che vuole diventare un
 * componente. Niente virtual DOM, niente reattività: chi disegna sa quando.
 */

/**
 * Crea un elemento. Gli attributi che iniziano per `on` diventano listener,
 * `class` accetta stringa o array, i figli possono essere nodi o testo.
 * @param {string} tag
 * @param {Record<string, any>} [attrs]
 * @param {Array<Node|string|false|null|undefined>|Node|string} [children]
 * @returns {HTMLElement}
 */
export function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue
    if (k === 'class') el.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : String(v)
    else if (k === 'dataset') Object.assign(el.dataset, v)
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v)
    else if (v === true) el.setAttribute(k, '')
    else el.setAttribute(k, String(v))
  }
  append(el, children)
  return el
}

/**
 * @param {Node} parent
 * @param {Array<Node|string|false|null|undefined>|Node|string} children
 */
export function append(parent, children) {
  const list = Array.isArray(children) ? children : [children]
  for (const c of list) {
    if (c == null || c === false) continue
    parent.appendChild(typeof c === 'string' ? document.createTextNode(c) : c)
  }
}

/**
 * Svuota un contenitore. Rimuovere i figli stacca anche i loro listener: è il
 * motivo per cui le viste possono ridisegnarsi senza perdere memoria.
 * @param {Element} el
 */
export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild)
}

/**
 * Clona un `<template>` per id.
 * @param {string} id
 * @returns {DocumentFragment}
 */
export function tpl(id) {
  const t = document.getElementById(id)
  if (!(t instanceof HTMLTemplateElement)) throw new Error(`template mancante: ${id}`)
  return /** @type {DocumentFragment} */ (t.content.cloneNode(true))
}

/**
 * Delega: **un** listener sul contenitore invece di uno per riga. È la
 * differenza fra una scheda che scorre e una che singhiozza.
 * @param {Element} root
 * @param {string} evento
 * @param {string} selettore
 * @param {(el: Element, ev: Event) => void} handler
 * @returns {() => void} per staccare
 */
export function on(root, evento, selettore, handler) {
  /** @param {Event} ev */
  const fn = (ev) => {
    const t = ev.target
    if (!(t instanceof Element)) return
    const hit = t.closest(selettore)
    if (hit && root.contains(hit)) handler(hit, ev)
  }
  root.addEventListener(evento, fn)
  return () => root.removeEventListener(evento, fn)
}

/** @param {string} sel @param {ParentNode} [root] @returns {HTMLElement} */
export function $(sel, root = document) {
  const el = root.querySelector(sel)
  if (!(el instanceof HTMLElement)) throw new Error(`elemento mancante: ${sel}`)
  return el
}
