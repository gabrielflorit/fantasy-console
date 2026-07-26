import {
  type WorkerToShell,
  type Input,
  type Cassette,
  WIDTH,
  HEIGHT,
} from '../shared/types.js'
import { createStore } from './store.js'
import { starterCassette } from './starter.js'

// ---- UI state (the only thing in the store) ---------------------------------
// The room navigates on two independent axes, each a rigid tray:
//   horizontal — the workbench slides in/out. 'run' hides it (game centered);
//                'work' shows it. Drives the camera (run = wide, work = push-in).
//   tool       — which frame the inner (vertical) tray registers in the left
//                pane: the editor ('code') or the help card ('help'), etc.
// RUN is a pure horizontal move that leaves `tool` untouched, so returning to
// work lands on whatever tool you left. userPaused is the PAUSE switch's own
// position; effective pause is derived (see isPaused).
type Horizontal = 'run' | 'work'
type Tool = 'code' | 'help'
interface UIState {
  horizontal: Horizontal
  tool: Tool
  userPaused: boolean
}
type Action =
  { type: 'run' } | { type: 'tool'; tool: Tool } | { type: 'togglePause' }

function reducer(state: UIState, action: Action): UIState {
  switch (action.type) {
    case 'run':
      // Radio-ish: re-throwing RUN is a no-op (same ref). `tool` is preserved.
      if (state.horizontal === 'run') return state
      return { ...state, horizontal: 'run' }
    case 'tool':
      // CODE/HELP both mean "show the workbench" + pick a tool. Re-throwing the
      // active tool while already in work is a no-op.
      if (state.horizontal === 'work' && state.tool === action.tool)
        return state
      return { ...state, horizontal: 'work', tool: action.tool }
    case 'togglePause':
      return { ...state, userPaused: !state.userPaused }
    default:
      return state
  }
}

// HELP forces a pause, but only while you're actually looking at it (in work) —
// hitting RUN with the inner tray still parked on help must not freeze the game.
// The PAUSE switch position (userPaused) is untouched by help.
function isPaused(s: UIState): boolean {
  return s.userPaused || (s.horizontal === 'work' && s.tool === 'help')
}

let store = createStore(reducer, {
  ...stateFromHash(),
  userPaused: false,
})

// ---- Camera -----------------------------------------------------------------
// Framings are rectangles in scene space; frameToRect scales one to fit and
// centers it in the fixed stage. RUN is the whole scene (identity); the
// machine push-in frames the console (its box + a margin) for CODE/HELP.
const STAGE_W = 1512
const STAGE_H = 857
interface Rect {
  x: number
  y: number
  w: number
  h: number
}
// Framings trace the art (design/room-art-wide.png). RUN frames the whole
// all-in-one console with the shelf peeking in at the right; the machine
// push-in frames the monitor glass + the four bezel buttons, cropping the
// keyboard/deck/shelf for max editor real estate while the buttons stay in view.
const FRAMINGS: Record<'run' | 'machine', Rect> = {
  run: { x: 70, y: 20, w: 1380, h: 820 },
  machine: { x: 235, y: 70, w: 910, h: 510 },
}

// The camera rides the horizontal axis: RUN pulls back to the wide shot, work
// (CODE/HELP/ART) leans into the machine. CODE↔HELP share this framing, so
// switching tools is a pure inner-tray slide with no camera move.
function framingFor(h: Horizontal): Rect {
  return h === 'run' ? FRAMINGS.run : FRAMINGS.machine
}

function frameToRect(r: Rect): string {
  let scale = Math.min(STAGE_W / r.w, STAGE_H / r.h)
  let tx = (STAGE_W - r.w * scale) / 2 - r.x * scale
  let ty = (STAGE_H - r.h * scale) / 2 - r.y * scale
  return `translate(${tx}px, ${ty}px) scale(${scale})`
}

// ---- DOM handles ------------------------------------------------------------
let scene = document.getElementById('scene') as HTMLDivElement
let hTray = document.getElementById('h-tray') as HTMLDivElement
let innerTray = document.getElementById('inner-tray') as HTMLDivElement
let canvas = document.getElementById('canvas') as HTMLCanvasElement
let ctx = canvas.getContext('2d')!
let editor = document.getElementById('editor') as HTMLTextAreaElement
let statePane = document.getElementById('state') as HTMLPreElement
let pauseLight = document.getElementById('pause-light') as HTMLSpanElement
let modeSwitches = Array.from(
  document.querySelectorAll<HTMLButtonElement>('.switch[data-mode]'),
)
let pauseBtn = document.getElementById('pause') as HTMLButtonElement

// ---- Router (hash <-> state) ------------------------------------------------
// #code / #help map to work + a tool; anything else (incl. #run and empty) is
// RUN, defaulting the tool to code. Used for the initial state and for external
// hash changes; render() writes the hash back the other way.
function stateFromHash(): { horizontal: Horizontal; tool: Tool } {
  let h = location.hash.replace(/^#/, '')
  if (h === 'code') return { horizontal: 'work', tool: 'code' }
  if (h === 'help') return { horizontal: 'work', tool: 'help' }
  return { horizontal: 'run', tool: 'code' }
}

window.addEventListener('hashchange', () => {
  let h = location.hash.replace(/^#/, '')
  if (h === 'code') store.dispatch({ type: 'tool', tool: 'code' })
  else if (h === 'help') store.dispatch({ type: 'tool', tool: 'help' })
  else store.dispatch({ type: 'run' })
})

// Switches are the whole navigation model — no menu. They must never take
// focus: they sit inside the camera-transformed #scene, and focusing a control
// inside a scaled/translated box makes the browser scroll the stage to "reveal"
// it (overflow: hidden does NOT prevent focus-scroll), nudging the whole scene a
// few px — different per button, so CODE vs HELP would land slightly off. A
// preventDefault on mousedown blocks the focus (and thus the scroll) outright;
// it also keeps the keyboard button (space/etc.) as game input, since a switch
// can never become the focused element.
for (let btn of [...modeSwitches, pauseBtn]) {
  btn.addEventListener('mousedown', (e) => e.preventDefault())
}
for (let btn of modeSwitches) {
  btn.addEventListener('click', () => {
    let m = btn.dataset.mode
    if (m === 'run') store.dispatch({ type: 'run' })
    else store.dispatch({ type: 'tool', tool: m as Tool })
  })
}
pauseBtn.addEventListener('click', () => {
  store.dispatch({ type: 'togglePause' })
})

// ---- Render (store subscriber) ----------------------------------------------
// Pure projection of UI state onto the DOM: the camera (depth), the two rigid
// trays (horizontal + vertical), switch/light states, hash sync, and loop
// gating. Never touches the worker or game state.
function render() {
  let s = store.getState()
  let work = s.horizontal === 'work'
  scene.style.transform = frameToRect(framingFor(s.horizontal))

  // Horizontal axis: the whole bottom tray (left pane + game + state) slides as
  // one rigid unit — home in work, left in RUN. The RUN offset centers the game
  // in the aperture (a partial slide, so a strip of the editor stays in view).
  hTray.style.transform = work ? 'translateX(0)' : 'translateX(-258px)'
  // Vertical axis: register the tool's frame in the left pane, independently.
  innerTray.style.transform =
    s.tool === 'help' ? 'translateY(-415px)' : 'translateY(0)'

  // Exactly one switch reads as thrown: RUN, or the active tool while in work.
  for (let btn of modeSwitches) {
    let m = btn.dataset.mode
    let on = m === 'run' ? s.horizontal === 'run' : work && s.tool === m
    btn.classList.toggle('on', on)
  }
  pauseBtn.classList.toggle('on', s.userPaused)
  pauseLight.classList.toggle('lit', isPaused(s))

  let hash =
    s.horizontal === 'run' ? '#run' : s.tool === 'help' ? '#help' : '#code'
  if (location.hash !== hash) location.hash = hash

  // A change may have unpaused the game — re-kick the self-clocked loop.
  scheduleNext()
}
store.subscribe(render)

// ---- Persistent console (imperative, outside the store) ---------------------
// The worker, game loop, input, and monitor canvas survive every mode switch:
// switching never reloads the cassette (only picking a new one, or a debounced
// edit, does). The loop is self-clocked — one tick in flight at a time.
let watchdog: ReturnType<typeof setTimeout> | null = null
let nextTimer: ReturnType<typeof setTimeout> | null = null
let worker: Worker
let running = false // a cassette is loaded and should animate
let inFlight = false // a tick was posted, awaiting its bitmap
let lastTick = 0
let currentCassette = starterCassette

// Local input state; a snapshot is bundled into each tick.
let input: Input = { a: false }
let buttonKeys = new Set([' ', 'z', 'x', 'Enter'])

// Keyboard drives the preview, but only when focus is NOT in the editor —
// otherwise pressing space while typing would fire the button.
window.addEventListener('keydown', (e) => {
  if (document.activeElement === editor) return
  if (buttonKeys.has(e.key)) {
    input.a = true
    e.preventDefault()
  }
})
window.addEventListener('keyup', (e) => {
  if (document.activeElement === editor) return
  if (buttonKeys.has(e.key)) {
    input.a = false
    e.preventDefault()
  }
})

// Pointer input is scoped to the monitor canvas: pressing starts on the
// canvas, but release/cancel are tracked on the window so the button can't get
// stuck held if the pointer leaves the canvas before lifting.
canvas.addEventListener('pointerdown', () => {
  input.a = true
})
window.addEventListener('pointerup', () => {
  input.a = false
})
window.addEventListener('pointercancel', () => {
  input.a = false
})

let palette = ['#f0f0f0', '#a8a8a8', '#4a4a4a', '#0d0d0d']

function hexToRgb(hex: string): [number, number, number] {
  let r = parseInt(hex.slice(1, 3), 16)
  let g = parseInt(hex.slice(3, 5), 16)
  let b = parseInt(hex.slice(5, 7), 16)
  return [r, g, b]
}

// Precomputed index → [r,g,b] lookup. There are only 4 colors but 4096 pixels
// per frame, so parsing hex per pixel is pure waste — resolve each palette
// entry once here. Rebuild this if the palette ever changes.
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

function renderState(data: Record<string, unknown>) {
  statePane.textContent = JSON.stringify(data, null, 2)
}

function onWorkerMessage(e: MessageEvent<WorkerToShell>) {
  let msg = e.data
  if (watchdog) {
    clearTimeout(watchdog)
    watchdog = null
  }

  if (msg.type === 'bitmap') {
    renderBitmap(msg.buffer)
    inFlight = false
    scheduleNext()
  } else if (msg.type === 'state') {
    renderState(msg.data)
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
  inFlight = true
  lastTick = performance.now()
  watchdog = setTimeout(() => {
    console.error('worker hung, respawning')
    running = false
    inFlight = false
    spawnWorker()
    loadCassette(currentCassette)
  }, 500)
  worker.postMessage({ type: 'tick', input: { ...input } })
}

// Schedule the next tick ~33ms after the last one started (≈30fps). Bails when
// stopped, effectively paused, or a tick is already in flight — so it's the
// single choke point that both throttles the loop and honors PAUSE/HELP.
function scheduleNext() {
  if (nextTimer) {
    clearTimeout(nextTimer)
    nextTimer = null
  }
  if (!running || inFlight || isPaused(store.getState())) return
  let delay = Math.max(0, 33 - (performance.now() - lastTick))
  nextTimer = setTimeout(() => {
    nextTimer = null
    tick()
  }, delay)
}

function loadCassette(cassette: Cassette) {
  currentCassette = cassette
  worker.postMessage({ type: 'load', cassette })
  running = true
  scheduleNext()
}

// The editor's textarea is the single source of the cassette code. Boot and
// live edit both flow through this one bridge; loadCassette stays generic so
// RUN and server-loaded cassettes (later phases) can reuse it directly.
function loadFromEditor() {
  loadCassette({ code: editor.value })
}

// Live edit: reload the preview 300ms after the last keystroke. The tape deck
// preserves game state across reloads unless init's source changed, so editing
// update/draw keeps the running game; editing init resets it.
let reloadTimer: ReturnType<typeof setTimeout> | null = null
editor.addEventListener('input', () => {
  if (reloadTimer) clearTimeout(reloadTimer)
  reloadTimer = setTimeout(loadFromEditor, 300)
})

render()
editor.value = starterCassette.code
spawnWorker()
loadFromEditor()
