// Lifecycle state machine: registered callbacks, game state, and the
// hot-reload rule for when to reset state vs. preserve it across edits.
import type { Input } from '../shared/types.js'
import { evaluateCassette } from './sandbox.js'

type State = Record<string, unknown>
type InitFn = (state: State) => void
type UpdateFn = (state: State, input: Input) => void
type DrawFn = (state: State) => void

export type CassetteApi = {
  init: (fn: InitFn) => void
  update: (fn: UpdateFn) => void
  draw: (fn: DrawFn) => void
}

export function createCassette() {
  let state: State = {}
  let initFn: InitFn | null = null
  let updateFn: UpdateFn | null = null
  let drawFn: DrawFn | null = null
  let lastInitSource: string | null = null

  // Last-write-wins on re-registration; all three callbacks optional.
  let api: CassetteApi = {
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

  function load(source: string, extraApi: Record<string, unknown>) {
    clearFns()
    evaluateCassette(source, { ...extraApi, ...api })
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

  return { api, load, runFrame }
}
