import {
  type WorkerToShell,
  type Input,
  type Cassette,
  WIDTH,
  HEIGHT,
} from '../shared/types.js'
import { starterCassette } from './starter.js'

let canvas = document.getElementById('canvas') as HTMLCanvasElement
let ctx = canvas.getContext('2d')!
let watchdog: ReturnType<typeof setTimeout> | null = null
let worker: Worker
let running = false
let lastTick = 0
let currentCassette = starterCassette

// Local input state; a snapshot is bundled into each tick.
let input: Input = { a: false }
let buttonKeys = new Set([' ', 'z', 'x', 'Enter'])

// TODO: window-level listening is temporary. Once there's an editor,
// input must be scoped to the focused preview (editor + preview will be
// on screen at once).
window.addEventListener('keydown', (e) => {
  if (buttonKeys.has(e.key)) {
    input.a = true
    e.preventDefault()
  }
})

window.addEventListener('keyup', (e) => {
  if (buttonKeys.has(e.key)) {
    input.a = false
    e.preventDefault()
  }
})

// Tap anywhere on the page = the one button — the canvas is centered
// with empty space above and below, and tapping there should still
// count (so a thumb on a phone doesn't have to cover the canvas).
// Pointer events unify mouse and touch; pointercancel covers the OS
// yanking the touch away (e.g. a system gesture) so the button can't
// get stuck held.
window.addEventListener('pointerdown', () => {
  input.a = true
})
window.addEventListener('pointerup', () => {
  input.a = false
})
window.addEventListener('pointercancel', () => {
  input.a = false
})

// touch-action: none already suppresses scroll/zoom, but iOS Safari
// still needs an explicit preventDefault on non-passive touch listeners
// to fully kill scroll bleed and double-tap zoom.
window.addEventListener('touchstart', (e) => e.preventDefault(), {
  passive: false,
})
window.addEventListener('touchmove', (e) => e.preventDefault(), {
  passive: false,
})

let palette = ['#f0f0f0', '#a8a8a8', '#4a4a4a', '#0d0d0d']

function hexToRgb(hex: string): [number, number, number] {
  let r = parseInt(hex.slice(1, 3), 16)
  let g = parseInt(hex.slice(3, 5), 16)
  let b = parseInt(hex.slice(5, 7), 16)
  return [r, g, b]
}

// Precomputed index → [r,g,b] lookup. There are only 4 colors but 4096
// pixels per frame, so parsing hex per pixel is pure waste — resolve each
// palette entry once here. Rebuild this if the palette ever changes.
let paletteRgb = palette.map(hexToRgb)

function renderBitmap(buffer: Uint8Array) {
  if (!(buffer instanceof Uint8Array) || buffer.length !== WIDTH * HEIGHT)
    return
  let imageData = ctx.createImageData(WIDTH, HEIGHT)
  for (let i = 0; i < buffer.length; i++) {
    // Mask to 0–3 so a malformed bitmap can't index past the palette.
    let [r, g, b] = paletteRgb[buffer[i] & 3]
    imageData.data[i * 4] = r
    imageData.data[i * 4 + 1] = g
    imageData.data[i * 4 + 2] = b
    imageData.data[i * 4 + 3] = 255
  }
  ctx.putImageData(imageData, 0, 0)
}

// TODO: flat if/else dispatch is fine while there are two message
// types; revisit (a lookup table?) as the protocol grows.
function onWorkerMessage(e: MessageEvent<WorkerToShell>) {
  let msg = e.data
  if (watchdog) {
    clearTimeout(watchdog)
    watchdog = null
  }

  if (msg.type === 'bitmap') {
    renderBitmap(msg.buffer)
    if (running) {
      // Self-clocked loop: each tick yields exactly one render (above),
      // and the next tick is scheduled to land ~33ms after this one
      // started — so ticks are spaced 33ms (≈30fps). Only one tick is
      // ever in flight, so a frame taking >33ms just stretches the
      // period (fps drops) rather than piling up a backlog.
      let delay = Math.max(0, 33 - (performance.now() - lastTick))
      setTimeout(tick, delay)
    }
  } else if (msg.type === 'crash') {
    console.error('worker crash:', msg.message)
    console.error(msg.stack)
    running = false
  }
}

function spawnWorker() {
  if (worker) worker.terminate()
  worker = new Worker('./worker/index.js', { type: 'module' })
  worker.onmessage = onWorkerMessage
}

function tick() {
  lastTick = performance.now()
  watchdog = setTimeout(() => {
    console.error('worker hung, respawning')
    running = false
    spawnWorker()
    loadCassette(currentCassette)
  }, 500)
  worker.postMessage({ type: 'tick', input: { ...input } })
}

function loadCassette(cassette: Cassette) {
  currentCassette = cassette
  worker.postMessage({ type: 'load', cassette })
  if (!running) {
    running = true
    tick()
  }
}

spawnWorker()
loadCassette(starterCassette)
