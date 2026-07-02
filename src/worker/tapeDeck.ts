// The tape deck: a cassette (source) loads into it, and it plays frames.
// Lifecycle state machine — registered callbacks, game state, and the
// hot-reload rule for when to reset state vs. preserve it across edits.
import type { Cassette, Input } from '../shared/types.js'
import { evaluateCassette } from './sandbox.js'

type State = Record<string, unknown>
type InitFn = (state: State) => void
type UpdateFn = (state: State, input: Input) => void
type DrawFn = (state: State) => void

export type Lifecycle = {
  init: (fn: InitFn) => void
  update: (fn: UpdateFn) => void
  draw: (fn: DrawFn) => void
}

export function createTapeDeck() {
  let state: State = {}
  let initFn: InitFn | null = null
  let updateFn: UpdateFn | null = null
  let drawFn: DrawFn | null = null
  let lastInitSource: string | null = null

  // Last-write-wins on re-registration; all three callbacks optional.
  let lifecycle: Lifecycle = {
    init: (fn) => {
      initFn = fn
    },
    update: (fn) => {
      updateFn = fn
    },
    draw: (fn) => {
      drawFn = fn
    },
  }

  // A function call (not inline assignment) so TS doesn't narrow the fns to
  // `null` for the rest of `load` — the closures above reassign them.
  function clearFns() {
    initFn = null
    updateFn = null
    drawFn = null
  }

  function load(cassette: Cassette, extraApi: Record<string, unknown>) {
    clearFns()
    evaluateCassette(cassette.code, { ...extraApi, ...lifecycle })
    // State persists across hot reloads unless init's source changed.
    // See FACTORY-PLAN.md for the rule's rationale.
    let src = initFn?.toString() ?? null
    if (src !== lastInitSource) {
      state = {}
      initFn?.(state)
      lastInitSource = src
    }
  }

  function runFrame(input: Input) {
    updateFn?.(state, input)
    drawFn?.(state)
  }

  return { load, runFrame }
}
