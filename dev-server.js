import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

let __dirname = path.dirname(fileURLToPath(import.meta.url))

let mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.ts': 'application/javascript',
  '.css': 'text/css',
  '.map': 'application/json',
}

let server = http.createServer((req, res) => {
  let url = req.url === '/' ? '/index.html' : req.url

  let filePath
  if (url === '/index.html') {
    filePath = path.join(__dirname, 'index.html')
  } else {
    filePath = path.join(__dirname, 'dist', url)
  }

  let ext = path.extname(filePath)
  let mimeType = mimeTypes[ext] ?? 'text/plain'

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404)
      res.end(`not found: ${url}`)
      return
    }
    res.writeHead(200, { 'Content-Type': mimeType })
    res.end(data)
  })
})

server.listen(3000, () => {
  console.log('http://localhost:3000')
})
