import http from 'http'
import fs from 'fs'
import path from 'path'
// converts a file:// URL to a filesystem path
import { fileURLToPath } from 'url'

// ES modules don't have __dirname — reconstruct it from this file's URL
let __dirname = path.dirname(fileURLToPath(import.meta.url))

// maps file extensions to MIME types for the Content-Type header
let mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.ts': 'application/javascript',
  '.css': 'text/css',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
}

// SSE reload
// holds open response objects, one per connected browser tab
let reloadClients = []

function addReloadClient(res) {
  // SSE requires these headers — text/event-stream tells the browser this is a persistent event stream
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    // keep the HTTP connection alive indefinitely
    Connection: 'keep-alive',
  })
  // initial write to flush headers to the browser immediately
  res.write('\n')
  // store this response so we can write to it later when files change
  reloadClients.push(res)
  // when the browser tab closes or navigates away, remove it from the list
  res.on('close', () => {
    reloadClients = reloadClients.filter((c) => c !== res)
  })
}

function broadcastReload() {
  // write an SSE message to every connected browser tab
  // the double newline signals end of message per the SSE spec
  for (let client of reloadClients) {
    client.write('data: reload\n\n')
  }
}

// watch the dist/ directory for any file changes and broadcast a reload
// recursive: true watches subdirectories too
fs.watch(path.join(__dirname, 'dist'), { recursive: true }, broadcastReload)
// spike/ has no build step, so watch the source directly. Optional: it only
// exists while a throwaway prototype is checked out.
let spikeDir = path.join(__dirname, 'spike')
if (fs.existsSync(spikeDir)) {
  fs.watch(spikeDir, { recursive: true }, broadcastReload)
}

// Static file serving
function resolveFilePath(url) {
  // root and /index.html both serve index.html from the project root
  if (url === '/' || url === '/index.html') {
    return path.join(__dirname, 'index.html')
    // /src/ requests are for original TypeScript source, used by devtools source maps
  } else if (url.startsWith('/src/')) {
    return path.join(__dirname, url)
    // /design/ requests are committed design assets (e.g. the room guide),
    // served straight from the project root so they're viewable in-browser
  } else if (url.startsWith('/design/')) {
    return path.join(__dirname, url)
    // /spike/ is throwaway prototypes — plain JS, no build step, served from
    // source. Directory URLs get index.html so /spike/3d/ works.
  } else if (url.startsWith('/spike/')) {
    let p = path.join(__dirname, url)
    return url.endsWith('/') ? path.join(p, 'index.html') : p
    // everything else (JS, source maps) lives in dist/
  } else {
    return path.join(__dirname, 'dist', url)
  }
}

function serveFile(url, res) {
  let filePath = resolveFilePath(url)
  // get the file extension to look up the correct MIME type
  let ext = path.extname(filePath)
  // fall back to text/plain for unknown extensions
  let mimeType = mimeTypes[ext] ?? 'text/plain'

  // read the file asynchronously and send it as the response
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404)
      res.end(`not found: ${url}`)
      return
    }
    // no-store so the browser never serves a stale asset during dev
    res.writeHead(200, { 'Content-Type': mimeType, 'Cache-Control': 'no-store' })
    res.end(data)
  })
}

// Server
let server = http.createServer((req, res) => {
  // SSE endpoint — browser connects here on page load and stays connected
  if (req.url === '/__reload') {
    addReloadClient(res)
    return
  }
  serveFile(req.url, res)
})

server.listen(3000, () => {
  console.log('http://localhost:3000')
})
