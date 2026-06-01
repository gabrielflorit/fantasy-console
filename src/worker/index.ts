import { type ShellToWorker, WIDTH, HEIGHT } from '../shared/types.js'
import { createGraphics } from './graphics.js'
import { createCassette } from './cassette.js'

let graphics = createGraphics(WIDTH, HEIGHT)
let cassette = createCassette()

self.onmessage = (e: MessageEvent) => {
  let msg = e.data as ShellToWorker
  try {
    if (msg.type === 'code') {
      cassette.load(msg.source, graphics.api)
    } else if (msg.type === 'tick') {
      cassette.runFrame(msg.input)
      self.postMessage({ type: 'bitmap', buffer: graphics.pixels().slice() })
    }
  } catch (err) {
    let e = err as Error
    self.postMessage({
      type: 'crash',
      message: String(e.message),
      stack: String(e.stack),
    })
  }
}
