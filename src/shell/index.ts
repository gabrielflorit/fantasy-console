import type { WorkerToShell } from '../shared/types.js'
import { starterCassette } from './starter.js'

let canvas = document.getElementById('canvas') as HTMLCanvasElement
let ctx = canvas.getContext('2d')!
let watchdog: ReturnType<typeof setTimeout> | null = null
let worker: Worker
let running = false
let lastTick = 0
let currentSource = starterCassette

let palette = ['#f0f0f0', '#a8a8a8', '#4a4a4a', '#0d0d0d']

function hexToRgb(hex: string): [number, number, number] {
  let r = parseInt(hex.slice(1, 3), 16)
  let g = parseInt(hex.slice(3, 5), 16)
  let b = parseInt(hex.slice(5, 7), 16)
  return [r, g, b]
}

function renderBitmap(buffer: Uint8Array) {
  let imageData = ctx.createImageData(64, 64)
  for (let i = 0; i < buffer.length; i++) {
    let [r, g, b] = hexToRgb(palette[buffer[i]])
    imageData.data[i * 4] = r
    imageData.data[i * 4 + 1] = g
    imageData.data[i * 4 + 2] = b
    imageData.data[i * 4 + 3] = 255
  }
  ctx.putImageData(imageData, 0, 0)
}

function onWorkerMessage(e: MessageEvent) {
  let msg = e.data as WorkerToShell
  if (watchdog) {
    clearTimeout(watchdog)
    watchdog = null
  }

  if (msg.type === 'bitmap') {
    renderBitmap(msg.buffer)
    if (running) {
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
    sendCode(currentSource)
  }, 500)
  worker.postMessage({ type: 'tick' })
}

function sendCode(source: string) {
  currentSource = source
  worker.postMessage({ type: 'code', source })
  if (!running) {
    running = true
    tick()
  }
}

spawnWorker()
sendCode(starterCassette)
