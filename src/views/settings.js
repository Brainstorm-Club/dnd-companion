/** Vista «settings». Vedi il contratto in views/index.js. */
import { h } from '../dom.js'

/** @type {import('./index.js').View} */
export default {
  render(contenitore, ctx) {
    contenitore.appendChild(h('p', { class: 'dc-avvio' }, `vista «settings» — non ancora implementata`))
  },
}
