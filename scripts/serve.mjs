#!/usr/bin/env node
/** Server statico per lo sviluppo e i test e2e. Niente dipendenze: è `http`. */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const PORT = Number(process.env.PORT ?? 4173)
/** @type {Record<string, string>} */
const TIPI = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' }

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  let p = decodeURIComponent(url.pathname)
  if (p.endsWith('/')) p += 'index.html'
  const file = join(process.cwd(), normalize(p).replace(/^(\.\.[/\\])+/, ''))
  try {
    const body = await readFile(file)
    res.writeHead(200, {
      'content-type': TIPI[extname(file)] ?? 'application/octet-stream',
      // Nessuna cache in sviluppo: senza questa riga il browser tiene i file per
      // conto suo e si finisce a guardare una modifica che c'è già, cercando un
      // difetto che non esiste. In produzione la cache la governa il service worker.
      'cache-control': 'no-store, must-revalidate',
    })
    res.end(body)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('non trovato')
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}`))
