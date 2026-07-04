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
      try {
        self.postMessage({ type: 'state', data: tapeDeck.getState() })
      } catch {
        // State isn't structured-cloneable — the cassette violated the
        // serializable-state rule (a function/class instance on state).
        // Skip the state-pane update rather than crash the frame.
      }
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
