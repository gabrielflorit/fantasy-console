import type { ShellToWorker } from '../shared/types.js'

const WIDTH = 64
const HEIGHT = 64

let bitmap = new Uint8Array(WIDTH * HEIGHT)
let state: Record<string, unknown> = {}

type InitFn = (state: Record<string, unknown>) => void
type UpdateFn = (state: Record<string, unknown>, input: unknown) => void
type DrawFn = (state: Record<string, unknown>) => void

let initFn: InitFn | null = null
let updateFn: UpdateFn | null = null
let drawFn: DrawFn | null = null
let lastInitSource: string | null = null
let input = { a: false }

function clear(color: number = 3) {
  bitmap.fill(color)
}

function setPixel(x: number, y: number, color: number = 0) {
  if (x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT) {
    bitmap[y * WIDTH + x] = color
  }
}

function init(fn: InitFn) {
  initFn = fn
}
function update(fn: UpdateFn) {
  updateFn = fn
}
function draw(fn: DrawFn) {
  drawFn = fn
}

function resetFns() {
  initFn = null
  updateFn = null
  drawFn = null
}

function loadCode(source: string) {
  resetFns()

  let fn = new Function('clear', 'setPixel', 'init', 'update', 'draw', source)
  fn(clear, setPixel, init, update, draw)

  let initSource = initFn ? initFn.toString() : null
  if (initSource !== lastInitSource) {
    state = {}
    if (initFn) initFn(state)
    lastInitSource = initSource
  }
}

function crash(err: unknown) {
  let e = err as Error
  self.postMessage({ type: 'crash', message: String(e.message), stack: String(e.stack) })
}

self.onmessage = (e: MessageEvent) => {
  let msg = e.data as ShellToWorker
  try {
    if (msg.type === 'code') {
      loadCode(msg.source)
    } else if (msg.type === 'input') {
      input = { a: msg.a }
    } else if (msg.type === 'tick') {
      if (updateFn) updateFn(state, input)
      if (drawFn) drawFn(state)
      self.postMessage({ type: 'bitmap', buffer: bitmap.slice() })
    }
  } catch (err) {
    crash(err)
  }
}
