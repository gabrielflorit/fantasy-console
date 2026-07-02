import { type ShellToWorker, WIDTH, HEIGHT } from '../shared/types.js'
import { createGraphics } from './graphics.js'
import { createTapeDeck } from './tapeDeck.js'

let graphics = createGraphics(WIDTH, HEIGHT)
let tapeDeck = createTapeDeck()

self.onmessage = (e: MessageEvent<ShellToWorker>) => {
  let msg = e.data
  try {
    if (msg.type === 'load') {
      tapeDeck.load(msg.cassette, graphics.api)
    } else if (msg.type === 'tick') {
      tapeDeck.runFrame(msg.input)
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
