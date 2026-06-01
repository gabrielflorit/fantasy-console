# FACTORY-PLAN.md

Plan for refactoring `src/worker/index.ts` into clean, scoped factory modules. Captures the *why* behind each decision so the rationale isn't re-litigated.

## Overview

The current worker tangles five distinct concerns at module scope: drawing primitives, lifecycle registration, cassette state machine, sandbox / code loading, and shell protocol. Each gets its own module. State lives in factory closures — no module-level `let`s outside `index.ts`'s one-time construction.

### Shape: factory functions, not classes

Each concern is a `create…()` function that returns an object with two halves:

- **`api`** — the surface injected into user cassette code (destructured into `new Function(...)`).
- **handles** — what `index.ts` calls to drive frames (`load`, `runFrame`, `pixels`).

**Why not classes:** the cassette API gets destructured into `new Function(...)`, which strips `this`. Class methods would need `.bind(this)` on every API entry — exactly the ceremony classes are supposed to eliminate. There's also only ever one of each instance, so polymorphism/identity buys nothing.

### File layout

```
src/worker/
  index.ts       ← onmessage loop, wires everything
  graphics.ts    ← bitmap + drawing primitives
  sandbox.ts     ← evaluate source with an API injected
  cassette.ts    ← lifecycle hooks, state, hot-reload rule
```

### Dependency graph

```
index.ts ──▶ cassette ──▶ sandbox
        ╲
         ──▶ graphics
```

Acyclic. Cassette imports sandbox because cassette's job IS to load user code, and loading means evaluating.

## graphics.ts

Owns the bitmap. Exposes drawing primitives as `api`, and a read handle for the worker glue.

### Decision: expose `pixels: () => bitmap` as a live read handle

Graphics has no opinion about transport — the caller (`index.ts`) decides whether to `.slice()`, transfer, hash, or save.

**Why not return a `.slice()` from graphics (sealed-contract option):** would force a copy before we've decided whether transferables are coming. If/when we adopt transferables, we'd undo it.

**Why not present-style buffer swap:** correct destination *if* we commit to transferables, but bakes in a transport assumption today. The getter form keeps this reachable later — we can swap to internal rotation without breaking callers.

### Sketch

```ts
// src/worker/graphics.ts

export function createGraphics(width: number, height: number) {
  let bitmap = new Uint8Array(width * height)
  let api = {
    clear(color = 3) {
      bitmap.fill(color)
    },
    setPixel(x: number, y: number, color = 0) {
      if (x >= 0 && x < width && y >= 0 && y < height) {
        bitmap[y * width + x] = color
      }
    },
  }
  return { api, pixels: () => bitmap }
}
```

## sandbox.ts

One-function module: inject an API object's keys as local variable names into a source string, then run it under strict mode.

### Decision: `'use strict'`

Catches **implicit-global leakage across cassette loads.** Without strict, a missing `let` (`gameState = {...}`) binds to the worker's `self` and persists into the next cassette load — silent cross-cassette state contamination. Strict turns it into a clear ReferenceError at load time.

### Decision: no scope shadowing

Sandbox doesn't shadow worker globals (`self`, `setTimeout`, `postMessage`, …). Every "footgun" they'd catch is just *cassette breaks itself*:

- `setTimeout`/`setInterval` → cassette becomes non-deterministic; its problem.
- `self.postMessage(forged)` → shell validates and ignores or treats as a bitmap. Equivalent to "cassette drew something."
- `self.onmessage = …` → worker stops ticking → watchdog kills it. Self-DoS.
- `importScripts(evil)`, `fetch`, `XHR`, `WebSocket` → CSP blocks network and cross-origin loads.

None threaten the user. Shadowing was also never bulletproof — `Function('return self')()` runs in global scope and resurrects `self` regardless. Theater against anyone who knows JS.

### Real security boundaries (NOT sandbox's job)

Sandbox is not the security layer. Where the actual defenses are:

1. **CSP must be tight.** `script-src 'self'`, `worker-src 'self'` or `'none'`, `connect-src 'none'`, `default-src 'none'`. Current `connect-src` is set; the others need verification before publishing.
2. **Shell-side message validation.** Whitelist `msg.type`. For `bitmap`: check `buffer instanceof Uint8Array && buffer.length === WIDTH * HEIGHT`, mask values via `buffer[i] & 3` before indexing palette. Never `eval` / `innerHTML` / `URL` anything from the worker.
3. **No secrets in console-origin storage.** If we later use IndexedDB/localStorage, treat it as cassette-accessible.

Worker isolation + tight CSP + strict shell parsing = the actual attack surface. A hostile cassette can draw pixels and annoy itself. That's the entire blast radius.

### Not doing

- **Caching the compiled `Function`.** Each `load` has new source — cache hit rate is 0.
- **try/catch inside sandbox.** Errors propagate to `onmessage`'s try/catch, where crash reporting lives.
- **Async support.** Cassettes are sync frame loops; no top-level `await`.

### Sketch

```ts
// src/worker/sandbox.ts

export function evaluateCassette(source: string, api: Record<string, unknown>) {
  let body = `'use strict';\n${source}`
  new Function(...Object.keys(api), body)(...Object.values(api))
}
```

## cassette.ts

Owns the lifecycle state machine: registered callbacks, game state, and the hot-reload rule for when to reset state vs. preserve it across code edits.

### Surface

**`api`** (injected into user code):
- `init(fn)` — register an init callback
- `update(fn)` — register an update callback
- `draw(fn)` — register a draw callback

**Handles** (called by `index.ts`):
- `load(source, extraApi)` — replace the cassette: clear registered fns, run the evaluator, apply the hot-reload state rule
- `runFrame(input)` — call `updateFn(state, input)` then `drawFn(state)`

### Decision: single `load(source, extraApi)` entry point, cassette imports sandbox directly

The three steps (clear fns → eval user code → apply state rule) are inseparable — no legitimate reason to skip one or reorder. Merging into one `load` enforces the protocol and keeps the state-preservation rule entirely inside cassette.

**Rejected: callback-style `load(evaluate)`** where caller passes a closure that does the eval. It keeps cassette ignorant of sandbox, but the indirection (control bouncing index → cassette → callback-in-index → sandbox → user-code and back) is hard to trace, for a decoupling benefit that buys nothing — there's only ever one evaluator.

### Decision: hot-reload state preservation rule

**State resets iff `initFn`'s source text changed** (compared via `initFn.toString()`).

Behavior matrix:

| User edits | source(init) | Result | Right? |
|---|---|---|---|
| Tweaks `update` only | unchanged | preserve state | ✓ keep playing |
| Adds field in `init` | changed | reset | ✓ fresh init |
| Refactors `init` whitespace | changed | reset | ✗ false positive |
| Adds field used only in `update` | unchanged | preserve | ✗ field is `undefined` |

False positives are minor in practice; the win (edit `update`, keep playing) is the main ergonomic benefit of hot reload. Alternatives rejected:

- **Always reset on hot-reload.** Predictable but kills the ergonomic benefit.
- **Never reset implicitly; user calls a reset API.** More ceremony than it saves.
- **Hash entire source.** Equivalent to "always reset".

The `initFn.toString()` comparison looks weird out of context — code should comment-link back here.

### Other decisions

- **Last-write-wins on re-registration.** If user calls `update(fn)` twice, the second wins. No warnings, matches "you wrote it last, you meant it."
- **All three callbacks are optional.** A cassette with no `draw` is legal (useful during scaffolding).
- **`state` typed as `Record<string, unknown>`.** Honest about what we promise the user: an object. Can't statically type what they put in it.
- **Mutation-style `init` (`(state) => void`), not return-style (`() => state`).** Matches update/draw shape; one fewer special case.
- **`Input` type lives in `src/shared/types.ts`.** Both shell and worker agree on its shape; cassette imports from shared.

### Sketch

```ts
// src/worker/cassette.ts
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

  let api: CassetteApi = {
    init: (fn) => { initFn = fn },
    update: (fn) => { updateFn = fn },
    draw: (fn) => { drawFn = fn },
  }

  function load(source: string, extraApi: Record<string, unknown>) {
    initFn = updateFn = drawFn = null
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
```

## index.ts

Thin orchestrator. Constructs the factories once, dispatches messages, posts results back. Zero mutable state of its own.

### Decision: bundle input into the `tick` message

Eliminates the input-vs-tick race and removes module-level `input` state from the worker. Shell tracks input locally and includes a snapshot with each tick. The `'input'` message type is removed entirely; `runFrame(msg.input)` reads directly from the tick.

Requires a small shell change: track input state locally, bundle into each tick. `Input` type lives in `src/shared/types.ts`.

### Decision: `WIDTH` and `HEIGHT` live in `src/shared/types.ts`

Single source of truth for the console dimensions, shared between shell (`createImageData(WIDTH, HEIGHT)`) and worker (`createGraphics(WIDTH, HEIGHT)`). Importing constants from a types file is mildly unconventional, but a separate `constants.ts` would be ceremony for two numbers.

### Decision: crash reporting inline, not a helper

Three lines. Lifting into a named function adds a hop without adding clarity.

### Decision: one try/catch covers all dispatch

Every error path — syntax errors during `evaluateCassette`, throws in user's init/update/draw, programming errors in cassette/graphics — flows through synchronous code called from inside `onmessage`. One try/catch at the dispatch boundary catches all of them.

### Decision: no "ready" handshake

Worker is reactive. If shell sends a `tick` before the first `code`, all callbacks are null and `runFrame` is a no-op — one blank frame at startup. Acceptable; a handshake would add a message type and a shell-side state machine for no real win.

### Sketch

```ts
// src/worker/index.ts
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
```

## Implementation notes

Files to **create**:
- `src/worker/graphics.ts`
- `src/worker/sandbox.ts`
- `src/worker/cassette.ts`

Files to **rewrite**:
- `src/worker/index.ts` — collapses from the current single-file design to the thin orchestrator above.

Files to **update**:
- `src/shared/types.ts` — add `Input` type and `WIDTH`/`HEIGHT` constants; change `ShellToWorker`'s `tick` message to include `input: Input`; remove the standalone `'input'` message type.
- `src/shell/index.ts` — add key listeners that track input state locally; bundle the current `input` snapshot into each tick message instead of sending separate `'input'` messages. Import `WIDTH`/`HEIGHT` from shared and replace the hardcoded `64, 64` in `createImageData`.

What's NOT changing:
- `tsconfig.shell.json`, `tsconfig.worker.json`, build setup, dev server.
- Shell's watchdog respawn flow (still re-sends code after a respawn).
- Bitmap protocol shape (still `Uint8Array`, still indexed 0–3).
- The `starterCassette` import in shell.

Verify before publishing:
- CSP completeness (see "Real security boundaries" in sandbox.ts section).
- Shell's bitmap-message handler bounds-checks `buffer.length` and masks `buffer[i] & 3`.

Suggested implementation order (matches the dependency graph):
1. Update `src/shared/types.ts` first (everything else depends on the new types).
2. Create `graphics.ts` and `sandbox.ts` (no inter-deps).
3. Create `cassette.ts` (depends on sandbox + shared).
4. Rewrite `src/worker/index.ts`.
5. Update `src/shell/index.ts` (input listeners, tick payload, shared constants).
6. Run `npm run build` and verify both tsconfigs compile clean.
