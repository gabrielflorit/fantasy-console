# Fantasy Console — Project Plan

---

## 1. What it is

A minimal JavaScript fantasy console running in the browser. 4 colors, 64×64 pixels, one button. Games are written in JavaScript against a small constrained API. The console has a social layer — a feed, profiles, shareable URLs. Everything runs client-side except auth and storage, which are a single Cloudflare Worker.

### Locked decisions

| Decision         | Value                                                                         |
| ---------------- | ----------------------------------------------------------------------------- |
| Resolution       | 64×64 pixels                                                                  |
| Colors           | 4 (indexed 0–3, 0 = brightest, 3 = darkest)                                   |
| Palettes         | 4 fixed palettes, author picks one                                            |
| Input            | One button — tap anywhere. `a`, `aPressed`, `aReleased`                       |
| Frame rate       | 30fps max — shell owns the loop, worker self-throttles                        |
| Auth             | WebAuthn passkeys. No OAuth, no email, no third parties                       |
| Storage          | Cloudflare KV                                                                 |
| Hosting          | Cloudflare Pages + Cloudflare Worker                                          |
| Language         | TypeScript, compiled to ES modules via `tsc`                                  |
| Dependencies     | Zero npm packages in the project. Global tools: `tsc`, `prettier`, `wrangler` |
| Vendored         | CodeMirror 6 — downloaded once, audited, committed                            |
| Framework        | None. Plain ES modules, hand-rolled router, hand-rolled Redux-lite            |
| Sound            | Deferred to v2                                                                |
| Sprites          | Deferred to v2                                                                |
| Map editor       | Deferred to v2                                                                |
| LEARN mode       | Deferred to v2                                                                |
| Account recovery | Not in v1. User's responsibility to register multiple devices                 |

---

## 2. Architecture

```
SHELL (Cloudflare Pages — static)
  ├── Router — hash-based, maps #/shelf, #/run, #/code to view functions
  ├── Store — Redux-lite (getState, dispatch, subscribe, ~50 lines)
  ├── Views — plain functions that build DOM from state
  │     ├── SHELF — frecency feed, cassette cards
  │     ├── RUN — canvas + tap handler
  │     ├── CODE — CodeMirror editor + preview canvas + state pane
  │     └── AUTH — passkey registration and sign-in
  └── Canvas renderer — receives bitmap from worker, calls putImageData

WORKER (Web Worker — runs user code)
  ├── Purely reactive — no loop, no setInterval
  ├── Receives: { type: 'code', source: string } → evals, calls init(state)
  ├── Receives: { type: 'tick', input } → calls update(state, input), draw(state)
  ├── draw() populates a Uint8Array bitmap (64×64 = 4096 bytes, 1 byte per pixel)
  ├── Sends: { type: 'bitmap', buffer: Uint8Array } after each tick
  ├── Sends: { type: 'crash', message, stack } on error
  └── Sends: { type: 'state', data: object } after each tick (for state pane)

SHELL GAME LOOP
  shell sends tick + input to worker
  worker processes, sends bitmap back
  shell renders bitmap, schedules next tick via setTimeout(33ms)
  → naturally self-throttles if worker is slow, never queues up ticks

SHELL ← WORKER PROTOCOL
  shell → worker: CodeMessage | TickMessage
  worker → shell: BitmapMessage | CrashMessage | StateMessage

WATCHDOG (shell side)
  If no message from worker in 500ms → terminate + respawn + show error

API SERVER (Cloudflare Worker)
  GET  /feed                    — frecency-sorted cassettes
  GET  /:user/:slug             — single cassette
  POST /cassette               — save cassette (auth required)
  PUT  /cassette/:id           — update cassette (owner only)
  POST /auth/register           — WebAuthn registration
  POST /auth/authenticate       — WebAuthn sign-in
  POST /engagement              — record play duration (unauthenticated)
```

---

## 3. Security model

- Worker runs in a separate thread. No DOM access, no localStorage, no cookies.
- CSP header (set in Cloudflare Pages `_headers` file):
  `Content-Security-Policy: default-src 'self'; worker-src 'self'; connect-src 'none'`
- `connect-src 'none'` blocks all network requests from the worker. User code cannot exfiltrate data.
- All user-supplied strings (title, username, description) rendered with `textContent` only. Never `innerHTML`.
- Palette stored as a named constant (`noir`, `gameboy`, `dusk`, `moss`), never interpolated as CSS.
- Username and slug validated server-side: alphanumeric and hyphens only.
- Rate limiting on POST /cassette: one save per 10 seconds per user.
- Size limit on code: 64KB max.
- postMessage between shell and worker: shell validates message shape before processing.

---

## 4. Cassette API

All functions are injected into the worker scope before user code runs.

### Drawing

```
clear([color=3])                              clear screen to color
setPixel(x, y, [color=0])                  set pixel at xy
getPixel(x, y)                             return color index at xy
line(x1, y1, x2, y2, [color=0])           draw line
rectStroke(x, y, w, h, [color=0])         stroke rectangle
rectFill(x, y, w, h, [color=0])           fill rectangle
circStroke(x, y, r, [color=0])            stroke circle
circFill(x, y, r, [color=0])              fill circle
polyStroke(points, [rotate, [x,y]], color) stroke polygon, optional rotation
print(x, y, text, [color=0])              draw text
```

Color index: 0 = brightest, 3 = darkest. Default draw color is 0. Default clear color is 3.

### Math

```
rnd(n)    returns random float from 0 to n
```

### Cassette structure

```js
init(state) {
  // runs once on load and on reset
  // mutate state freely
  // state must remain serializable — plain objects, arrays, primitives only
  // no class instances, no functions on state, no circular references
}

update(state, { a, aPressed, aReleased }) {
  // runs every tick before draw
  // a          — button currently held
  // aPressed   — button pressed this frame, not last frame
  // aReleased  — button released this frame
}

draw(state) {
  // runs every tick after update
  // call drawing functions here
  // do not mutate state here
}
```

---

## 5. Data model

### User

```
id              uuid
username        string, unique, alphanumeric + hyphens
display_name    string, optional
credential_id   WebAuthn credential ID
public_key      WebAuthn public key
created_at      timestamp
```

### Cassette

```
id              short random ID (internal)
slug            string, alphanumeric + hyphens, unique per user
title           string
description     string, optional
owner           username
palette         one of: noir | dusk | moss | gameboy
code            string, max 64KB
forked_from     cassette id, nullable
play_count      integer
play_seconds    integer (total engagement seconds)
created_at      timestamp
updated_at      timestamp
```

### Frecency score (computed, not stored)

```
score = play_seconds / (age_in_hours + 2) ^ 1.6
```

Forks count as 300 seconds of engagement. Tune gravity exponent (1.6) after launch.

---

## 6. URL scheme

```
/                       SHELF — frecency feed
/:user                  profile — all cassettes by user
/:user/:slug            cassette page — RUN mode
/:user/:slug/code       CODE mode — editor
/register               passkey registration
/signin                 passkey sign-in
```

---

## 7. Modes

### SHELF

- Frecency feed of cassette cards
- Each card: title, author, palette swatch, play count
- No metrics shown to users — play_count and play_seconds are internal only
- Tap card → RUN mode

### RUN

- Full-screen canvas, 64×64 scaled to fit viewport
- Boot sequence on load (brief, ~0.5s)
- Tap anywhere = button input
- No UI chrome while game is running
- Back button or swipe returns to SHELF
- Engagement timer starts on first tap, stops on navigation

### CODE

- Desktop only — mobile shows "edit on desktop" message
- Split pane: CodeMirror editor left, preview canvas right
- Preview runs live — 300ms debounce after last keystroke, then re-eval
- State pane: JSON view of current game state, updated each tick
- Numeric scrubbing: click any number token in editor, drag to change value, game freezes, draw() reruns with new value
- Play/pause button on preview
- Save button — requires auth

### AUTH

- Register: choose username → passkey prompt → done
- Sign in: passkey prompt → done
- No email, no OAuth

---

## 8. Palettes

Four fixed palettes. Specific hex values TBD — to be designed visually before implementing the renderer.

```
noir      four grays, high contrast
gameboy   four greens
dusk      dark navy through warm cream
moss      dark green through pale yellow
```

Each palette is an ordered array of 4 hex values, index 0 brightest to index 3 darkest.

---

## 9. Dev setup

```
global tools (install once, not in project):
  npm install -g typescript
  npm install -g prettier
  npm install -g wrangler        (run inside Lima VM only, when needed)

local dev:
  npm run dev                    compiles both tsconfigs in watch mode
  node dev-server.js             static file server at localhost:3000

deploy:
  npm run build                  compile both tsconfigs
  git push                       Cloudflare Pages auto-deploys shell
  wrangler deploy                deploys Worker (from Lima VM)
```

### tsconfig structure

Three tsconfigs. Root sets shared compiler options. Shell and worker extend it, each with their own `lib` targets and `outDir`.

```
tsconfig.json              root — target, module, strict, sourceMap, declaration
tsconfig.shell.json        extends root — lib: [ES2022, DOM], outDir: dist
tsconfig.worker.json       extends root — lib: [ES2022, WebWorker], outDir: dist
```

Both shell and worker compile to `dist/`, preserving the full `src/` subdirectory structure:

```
src/shell/index.ts    →    dist/shell/index.js
src/worker/index.ts   →    dist/worker/index.js
src/shared/types.ts   →    dist/shared/types.js  (compiled twice, once per tsconfig)
```

### Directory structure

```
fantasy-console/
  index.html              entry point, served from project root
  dev-server.js           local static file server, plain Node, no dependencies
  package.json            scripts only, no dependencies
  tsconfig.json           root TypeScript config
  tsconfig.shell.json     shell config — lib: DOM
  tsconfig.worker.json    worker config — lib: WebWorker
  .prettierrc             formatter config (semi: false, singleQuote: true)
  .gitignore              ignores dist/ and node_modules/
  PLAN.md                 this file
  README.md               setup instructions for future me
  src/
    shared/               message types shared between shell and worker
    shell/                shell code — runs in the browser
    worker/               worker code — runs in a separate thread
    server/               Cloudflare Worker API
  dist/                   compiled output — do not edit, not committed
  vendor/                 CodeMirror 6 — committed, never auto-updated
```

---

## 10. Build phases

Each phase ends with something runnable.

### Phase 1 — Bitmap pipeline

Shell spawns worker, sends a tick, worker returns a bitmap, shell renders it to canvas. No cassette API, no editor, no auth. Just the pipe working end to end.

### Phase 1.5 — Worker module refactor

Refactor `src/worker/index.ts` into scoped factory modules (`graphics`, `sandbox`, `cassette`, thin `index`) before adding more drawing primitives. Bundles input into `TickMessage`, moves `WIDTH`/`HEIGHT` to `src/shared/types.ts`. See `FACTORY-PLAN.md` for full design, rationale, and sketches.

### Phase 2 — Full cassette API

All drawing functions implemented in `src/worker/graphics.ts`. Watchdog implemented. Shell game loop running at 30fps. A real one-button game running end to end.

### Phase 3 — Shell and editor

CodeMirror rendering. Live reload on keystroke (300ms debounce). State pane showing JSON. Split pane layout. Router with SHELF, RUN, CODE stubs.

### Phase 4 — Numeric scrubbing

Click a numeric token, drag to change value, game freezes, draw() reruns. The Bret Victor feature.

### Phase 5 — Auth

WebAuthn registration and sign-in. Username stored in shell state. Save button enabled when signed in.

### Phase 6 — Storage and API

Cloudflare Worker with KV. Save cassette, load cassette, user profile. Cassette page at /:user/:slug.

### Phase 7 — Feed

Frecency feed on homepage. Engagement tracking. Play count. Cassette cards.

### Phase 8 — Mobile RUN

Canvas scales to fill mobile viewport. Tap-anywhere input works. No scroll bleed. Touch event handling.

### Phase 9 — Polish

Boot sequence. Palettes finalized. Error display. Empty states. Performance pass.

---

## 11. Granular task list

Work top to bottom. One task = one evening or less. Check off as done.

### Phase 1 — Bitmap pipeline

- [x] Create repo, directory structure, root tsconfig
- [x] Create tsconfig.shell.json and tsconfig.worker.json with correct lib targets
- [x] Write worker entry point: receives any message, returns solid bitmap
- [x] Implement bitmap buffer in worker: Uint8Array, 64×64 = 4096 bytes, 1 byte per pixel
- [x] Write shell entry point: spawns worker, sends ping, receives bitmap
- [x] Write shell canvas renderer: receives bitmap, calls putImageData, expands palette to RGBA
- [x] Verify bitmap renders correctly at 64×64 in browser
- [x] Write dev-server.js — static file server, no dependencies
- [x] Write shared message types: BitmapMessage, CrashMessage, CodeMessage, StateMessage, TickMessage
- [x] Implement clear() in worker — fills buffer with color index (now in `graphics.ts`)
- [x] Implement setPixel() in worker — sets value at xy (now in `graphics.ts`)
- [x] Refactor worker to respond to TickMessage (shell owns the loop)
- [x] Implement shell game loop: setTimeout 33ms, send tick, render on response
- [x] Implement watchdog in shell: 500ms timeout, terminates and respawns worker
- [x] Implement crash handler in shell: receives CrashMessage, logs to console
  - types.ts exists but not yet imported — wire up in Phase 2
- [x] Write hardcoded test cassette that draws something recognizable (not just solid color)

### Phase 1.5 — Worker module refactor

See `FACTORY-PLAN.md` for the full design, rationale, and implementation order.

- [x] Update `src/shared/types.ts` — add `Input` type and `WIDTH`/`HEIGHT` constants; fold input into `TickMessage`; remove standalone `'input'` message type
- [x] Create `src/worker/graphics.ts` — `createGraphics` factory exposing `clear`, `setPixel`, `pixels()`
- [x] Create `src/worker/sandbox.ts` — `evaluateCassette(source, api)` with `'use strict'`
- [x] Create `src/worker/cassette.ts` — `createCassette` factory exposing `api`, `load`, `runFrame`
- [x] Rewrite `src/worker/index.ts` as a thin orchestrator wiring the factories
- [x] Update `src/shell/index.ts` — key listeners that track input state locally; bundle the current `input` snapshot into each tick; import `WIDTH`/`HEIGHT` from shared
  - also added shell-side bitmap validation (length check + `& 3` palette mask) per FACTORY-PLAN's security notes
- [x] Verify `npm run build` compiles both tsconfigs cleanly
- [x] Smoke test: starter cassette renders, tick loop runs (dot animates across canvas)
- [x] Verify input path end to end — starter cassette reads `input.a` (button moves the dot vertically), confirms key → worker plumbing

### Phase 2 — Full cassette API

All Phase 2 drawing primitives below land in `src/worker/graphics.ts` (created in Phase 1.5). The lifecycle hooks (`init`, `update`, `draw`) are already wired through `src/worker/cassette.ts`.

- [ ] Implement getPixel() — reads value from buffer
- [ ] Implement line() — Bresenham's line algorithm
- [ ] Implement rectStroke()
- [ ] Implement rectFill()
- [ ] Implement circStroke() — Bresenham's circle algorithm
- [ ] Implement circFill()
- [ ] Implement polyStroke() — with optional rotation and pivot point
- [ ] Implement print() — bitmap font, minimal character set, uppercase + numbers + punctuation
- [ ] Implement rnd()
- [ ] Write test cassettes for each API function
- [ ] Write a simple complete one-button game to validate full API

### Phase 3 — Shell and editor

- [ ] Vendor CodeMirror 6 — download, audit, commit to vendor/
- [ ] Implement basic router: hashchange listener, map routes to view functions
- [ ] Implement Redux-lite store: getState, dispatch, subscribe, ~50 lines
- [ ] Implement CODE view skeleton: split pane layout, editor left, canvas right
- [ ] Integrate CodeMirror into CODE view — renders in editor pane
- [ ] Wire CodeMirror content to worker: on change, debounce 300ms, send CodeMessage
- [ ] Implement state pane: JSON.stringify(state) rendered below editor, updated each tick
- [ ] Implement SHELF view skeleton: placeholder cards
- [ ] Implement RUN view skeleton: full-screen canvas
- [ ] Implement navigation between views
- [ ] Implement play/pause button in CODE view

### Phase 4 — Numeric scrubbing

- [ ] Write CodeMirror ViewPlugin that finds numeric tokens in the syntax tree
- [ ] Render numeric tokens as clickable widgets in the editor
- [ ] On widget click: freeze game loop, enter scrub mode
- [ ] On widget drag left/right: update numeric value, redefine draw(), call once
- [ ] Infer scrub range: current value ± 10x, step from decimal places
- [ ] Handle edge case: value is 0, use minimum range of ±10
- [ ] Handle negative values: range passes through zero
- [ ] On click elsewhere or Escape: exit scrub mode, resume game loop
- [ ] Test scrubbing on positions, speeds, sizes, colors

### Phase 5 — Auth

- [ ] Research WebAuthn API — registration and authentication flows
- [ ] Implement registration endpoint in Cloudflare Worker: POST /auth/register
- [ ] Implement authentication endpoint: POST /auth/authenticate
- [ ] Store credential_id and public_key in KV
- [ ] Implement AUTH view in shell: username field + passkey prompt for registration
- [ ] Implement sign-in flow in shell
- [ ] Store authenticated username in shell Redux store
- [ ] Show username and sign-out button when authenticated
- [ ] Gate save button on authentication state

### Phase 6 — Storage and API

- [ ] Implement POST /cassette — save new cassette, require auth, return id and slug
- [ ] Implement PUT /cassette/:id — update cassette, owner only
- [ ] Implement GET /:user/:slug — return cassette JSON
- [ ] Implement GET /:user — return all cassettes by user
- [ ] Implement save flow in shell CODE view — sends code + metadata to API
- [ ] Implement cassette page view: title, author, palette, play button
- [ ] Implement fork button: copies cassette to authenticated user's account
- [ ] Wire /:user/:slug URL to cassette page view
- [ ] Wire /:user URL to profile view

### Phase 7 — Feed

- [ ] Implement POST /engagement — records play_seconds for a cassette
- [ ] Implement engagement timer in shell RUN view: start on first tap, send on navigation
- [ ] Implement GET /feed — frecency query against KV, returns sorted cassette list
- [ ] Implement frecency scoring: play_seconds / (age_in_hours + 2) ^ 1.6
- [ ] Implement SHELF view with real feed data: cassette cards with title, author, palette
- [ ] Test frecency behavior: verify new cassettes surface, old ones decay

### Phase 8 — Mobile RUN

- [ ] Scale canvas to fill mobile viewport preserving aspect ratio
- [ ] Implement touch input: pointerdown anywhere on canvas → a = true
- [ ] Add touch-action: none to canvas and body
- [ ] Add passive: false to touchstart and touchmove listeners
- [ ] Add viewport meta tag: user-scalable=no
- [ ] Test on iOS Safari and Chrome Android
- [ ] Implement "edit on desktop" message in CODE view on mobile

### Phase 9 — Polish

- [ ] Design and implement boot sequence (~0.5s, renders to canvas)
- [ ] Finalize palette hex values — design all four visually
- [ ] Implement error display in RUN and CODE views
- [ ] Implement empty state for SHELF (no cassettes yet)
- [ ] Implement empty state for profile (no cassettes by this user)
- [ ] Performance pass: verify 30fps holds on mid-range mobile
- [ ] Deploy to Cloudflare Pages and Worker
- [ ] Smoke test on production

---

## 12. Parking lot (not v1)

- Sound — step sequencer, sfx API, audio worker
- Sprites — sprite sheet editor, sprite() API call
- Map editor — tile map, map() API call
- LEARN mode — interactive guided tutorial
- polyFill() — filled polygon
- Account recovery — backup passkey, email fallback
- Palette customization — author-defined palettes
- Multiple input buttons — d-pad, two buttons
- Cassette comments
- Featured cassettes / curation
- Export to standalone HTML
- Bit-packing bitmap (2 bits per pixel, 512 bytes) — currently 1 byte per pixel, 4096 bytes

---

_Last updated: Phase 1.5 complete. Worker factory refactor landed — graphics/sandbox/cassette split, input folded into ticks, shell bitmap validation. Render, tick loop, and input path all confirmed in browser. Ready for Phase 2 (full cassette API)._
