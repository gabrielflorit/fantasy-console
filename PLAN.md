# Fantasy Console — Project Plan

---

## 1. What it is

A minimal JavaScript fantasy console running in the browser. 4 colors, 64×64 pixels, one button. Games — called _cassettes_ — are written in JavaScript against a small constrained API. The whole console is presented as a "desk room": a monitor on an IMSAI 8080 and a tape deck, with a cassette shelf, navigated by a scripted camera (§7). It has a social layer — a feed, profiles, shareable URLs. Everything runs client-side except auth and storage, which are a single Cloudflare Worker.

### Locked decisions

| Decision         | Value                                                                         |
| ---------------- | ----------------------------------------------------------------------------- |
| Resolution       | 64×64 pixels                                                                  |
| Colors           | 4 (indexed 0–3, 0 = brightest, 3 = darkest)                                   |
| Palettes         | 4 fixed palettes, author picks one                                            |
| Viewport         | 1512×982 desktop target; monitor fixed-size, smaller viewports clip           |
| Art direction    | Pixelated line art, monochrome; color only on cassettes and running games      |
| Presentation     | One "desk-room" scene in real 3D — WebGL housing + live CSS3D screens; scripted camera flies between machine and shelf. Degree of realism still open (§7, `design/handoff-realism.md`) |
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
  ├── Router — hash-based; each route parks the camera at a framing (§7)
  ├── Store — Redux-lite (getState, dispatch, subscribe, ~50 lines)
  ├── Room — one fixed 1512×982 scene; a scripted 2D camera (translate/scale)
  │          zooms/pans between framings, never free-look
  │     ├── Machine framings — RUN (wide) / CODE / ART / HELP (zoomed in) on the
  │     │     console (monitor + IMSAI switches + tape deck)
  │     └── Shelf — the one non-machine framing; click a cassette to load it
  ├── Console — persistent while a cassette is loaded: worker, game loop,
  │             watchdog, input, monitor canvas; survives mode switches
  └── Canvas renderer — receives bitmap from worker, calls putImageData

WORKER (Web Worker — runs user code)
  ├── Purely reactive — no loop, no setInterval
  ├── Receives: { type: 'load', cassette: { code } } → evals, calls init(state)
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
  shell → worker: LoadMessage | TickMessage
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

> The "scripted 2D camera (translate/scale)" above describes the **current** shell
> code. The presentation layer is being replaced with a real-3D scene (WebGL
> housing + CSS3D screens, camera flights); see §7 and `design/handoff-realism.md`.

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

Each route parks the camera at a framing in the room (§7); moving between them is
a scripted camera move, not a page swap (a 2D pan/zoom in the current shell, a 3D
camera flight in the new presentation — see §7). First load opens on the
establishing wide shot, console booting a game.

```
/                       landing — RUN a featured cassette (establishing shot)
/shelf                  SHELF — frecency feed of cassettes
/:user                  profile — all cassettes by user
/:user/:slug            cassette running — RUN
/:user/:slug/code       CODE — editor
/:user/:slug/art        ART — sprite / map editor (v2)
/:user/:slug/help       HELP — API + reference
/register               passkey registration
/signin                 passkey sign-in
```

---

## 7. The room

> **Partly superseded — pending full rewrite.** This section describes the
> original **2D-plane** presentation. The 3D housing spike falsified its central
> premise (see the corrected bullet below), and the presentation is moving to
> real 3D. The _design_ decisions here — machine layout, the RUN/CODE/ART/HELP +
> SHELF map, tape-deck behavior, persistence, art direction — still stand; only
> the rendering technique changed. A full rewrite waits until the look settles
> (the live open question). Live design: `design/handoff-realism.md` +
> `design/handoff-3d-spike.md`.

Everything is one continuous scene: a single fixed 1512×982 pixel drawing that
holds the whole console — a monitor on a base of an **IMSAI 8080** (left) and a
**tape deck** (right), in the center — with the cassette **shelf** to the right.
You move through it with a scripted camera that zooms and pans between fixed
framings; it is never free-look and the user never drives it directly. You are
either **at the machine** (RUN / CODE / ART / HELP) or **at the shelf** — that is
the whole map.

### The scene

- One flat pixel plane, drawn _in perspective_ — depth is illustrated, not real
  geometry. Sized for a 1512×982 viewport; the camera is a 2D `translate`/`scale`
  over it. (The original rationale here — "deliberately **not** CSS 3D, because 3D
  transforms would smear the monitor and editor and fight the pixel grid" — was
  **falsified by the spike**: CSS3D text stays pixel-crisp under the constraint set
  in `design/handoff-realism.md`, and the presentation is moving to real 3D.)
- The monitor is fixed-size, not resizable. Smaller viewports clip.

### The tape deck

- Holds the loaded cassette; its cover is visible and is one of the two things in
  the whole UI allowed color (the running game is the other).
- Spins for the boot duration (~2s) on load, and ~1s on save — physical feedback
  for I/O.
- Save / eject / record are controls on the deck (details TBD), making "record"
  literal; eject returns to the shelf.

### Art direction

- Pixelated line art, monochrome. The **only** color anywhere is cassette cover
  art and running games / screenshots.
- Zoomed in on the machine that means exactly two color anchors: the cassette in
  the deck and the game on the monitor. Everything else is line.

### Camera & switches

The IMSAI switches _are_ the navigation model — there is no menu.

- **RUN is the resting wide shot:** the full scene — console center, shelf right,
  the game playing on the monitor. It is the state whenever no editor switch is
  thrown.
- **CODE / ART / HELP are switches that zoom in** on the machine (monitor + IMSAI
  + deck). They are mutually exclusive — throwing one drops the others; the ART
  sub-switch (MAP or SPRITE) remembers its state.
- Throw the active switch **off** → the camera zooms back out to RUN. Switching
  **editor → editor** (e.g. CODE to ART) stays zoomed and just swaps the monitor's
  contents; only turning _all_ editor switches off returns to RUN.
- The game never stops through any of this (see Persistence), so RUN is not a mode
  you "enter" — it's the camera stepping back to the game that is already running.
- **SHELF** is reached by **clicking the shelf from RUN** (it sits in frame at the
  right); the camera zooms to it. From an editor: switch off → RUN → click the
  shelf. That single, consistent path is what "off → RUN" buys.

Every framing keeps the switches in view — they are the only way to change mode.

### RUN

- Monitor shows the game, 64×64. Boot sequence on load (~2s, deck spinning). Tap
  anywhere = button input. Engagement timer starts on first tap.

### CODE (desktop only)

- Zoomed in on the machine; the monitor shows the CodeMirror editor with a live
  game preview and a state pane.
- Preview runs live — 300ms debounce after the last keystroke, then re-eval. State
  pane: JSON view of current game state, updated each tick.
- Numeric scrubbing: click a number token, drag to change value, game freezes,
  `draw()` reruns. Play/pause. Save (on the deck) requires auth.

### ART (desktop only — v2)

- Same framing as CODE; the monitor shows the sprite or map editor (per the ART
  sub-switch), alongside the live game preview. Sprites and the map editor are
  deferred to v2 (§12); the switch and framing are reserved now.

### HELP (desktop only)

- Same framing; the monitor shows the reference — the cassette API and what a user
  needs to know. HELP absorbs what were once a separate manual and intro booklet:
  there is no "manual" place, only the switch.

### SHELF

- The one framing that is not the machine. Frecency feed of cassettes; covers
  carry the only color. Click a cassette → it loads into the deck (spins) and boots
  on the monitor, leaving you in RUN. Internal metrics (play_count, play_seconds)
  are never shown to users.

### Persistence

- A cassette stays loaded and running across **all** machine framings
  (RUN / CODE / ART / HELP) — zooming and switching modes never reloads it (see the
  tape-deck hot-reload rule in §2 / worker). Selecting a different cassette on the
  shelf is what replaces it (deck spins, boots).

### Landing, auth & mobile

- **Landing:** first visit opens in RUN with a demo game already playing; HELP is
  where a newcomer goes to learn.
- **Auth:** login/logout has no home yet, now that the only non-machine place is
  the shelf — candidates are a control on the machine or folding it into the shelf
  ("your shelf" = your account). Deferred to Phase 5; TBD.
- **Mobile:** bypasses the room entirely — fullscreen RUN, tap to play, back
  gesture to exit. CODE, ART, and HELP are desktop-only.

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

Refactor `src/worker/index.ts` into scoped factory modules (`graphics`, `sandbox`, `tapeDeck`, thin `index`) before adding more drawing primitives. Bundles input into `TickMessage`, moves `WIDTH`/`HEIGHT` to `src/shared/types.ts`.

### Phase 2 — Full cassette API

All drawing functions implemented in `src/worker/graphics.ts`. Watchdog implemented. Shell game loop running at 30fps. A real one-button game running end to end.

### Phase 3 — Shell and editor

CodeMirror rendering. Live reload on keystroke (300ms debounce). State pane showing JSON. The desk-room shell (§7): a fixed 1512×982 scene, scripted camera, IMSAI switches driving the RUN / CODE / ART / HELP framings, and the shelf. Router mapping routes to framings.

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
- [x] Write shared message types: BitmapMessage, CrashMessage, LoadMessage, StateMessage, TickMessage
- [x] Implement clear() in worker — fills buffer with color index (now in `graphics.ts`)
- [x] Implement setPixel() in worker — sets value at xy (now in `graphics.ts`)
- [x] Refactor worker to respond to TickMessage (shell owns the loop)
- [x] Implement shell game loop: setTimeout 33ms, send tick, render on response
- [x] Implement watchdog in shell: 500ms timeout, terminates and respawns worker
- [x] Implement crash handler in shell: receives CrashMessage, logs to console
  - types.ts exists but not yet imported — wire up in Phase 2
- [x] Write hardcoded test cassette that draws something recognizable (not just solid color)

### Phase 1.5 — Worker module refactor

- [x] Update `src/shared/types.ts` — add `Input` type and `WIDTH`/`HEIGHT` constants; fold input into `TickMessage`; remove standalone `'input'` message type
- [x] Create `src/worker/graphics.ts` — `createGraphics` factory exposing `clear`, `setPixel`, `pixels()`
- [x] Create `src/worker/sandbox.ts` — `evaluateCassette(source, api)` with `'use strict'`
- [x] Create `src/worker/tapeDeck.ts` — `createTapeDeck` factory exposing `load` and `runFrame`, with the `Lifecycle` registration hooks (`init`/`update`/`draw`)
- [x] Rewrite `src/worker/index.ts` as a thin orchestrator wiring the factories
- [x] Update `src/shell/index.ts` — key listeners that track input state locally; bundle the current `input` snapshot into each tick; import `WIDTH`/`HEIGHT` from shared
  - also added shell-side bitmap validation (length check + `& 3` palette mask), per the security model (§3)
- [x] Verify `npm run build` compiles both tsconfigs cleanly
- [x] Smoke test: starter cassette renders, tick loop runs (dot animates across canvas)
- [x] Verify input path end to end — starter cassette reads `input.a` (button moves the dot vertically), confirms key → worker plumbing

### Phase 2 — Full cassette API

All Phase 2 drawing primitives below land in `src/worker/graphics.ts` (created in Phase 1.5). The lifecycle hooks (`init`, `update`, `draw`) are already wired through `src/worker/cassette.ts`.

- [x] Implement line() — Bresenham's line algorithm
- [x] Implement rectStroke()
- [x] Implement rectFill()
- [ ] Implement circStroke() — Bresenham's circle algorithm
- [ ] Implement circFill()
- [ ] Implement polyStroke() — with optional rotation and pivot point
- [ ] Implement print() — bitmap font, minimal character set, uppercase + numbers + punctuation
- [ ] Implement rnd()
- [ ] Write test cassettes for each API function
- [ ] Write a simple complete one-button game to validate full API

### Phase 3 — Shell and editor

MVP-first sequencing: the CODE view ships against a plain `<textarea>` so the
live-edit loop (edit → debounce → reload → preview + state pane) works end to
end before any infrastructure lands. CodeMirror, the router, and the store are
later swaps/additions onto that working loop, not prerequisites for it.

The presentation design in §7 (the desk room, IMSAI switches, tape deck, scripted
camera) reshapes the remaining pending tasks below — the router becomes camera
framings, the CODE "split pane" becomes a zoom-in on the monitor, and RUN / CODE /
ART / HELP / SHELF become camera framings in the room. These are re-sequenced into
room-building increments as the work is picked up; the completed items above still
stand.

- [ ] Vendor CodeMirror 6 — download, audit, commit to vendor/
- [x] Implement basic router: hashchange listener, map routes to view functions
  - hash router (`#run`/`#code`/`#help`, empty → run) maps each route to a camera framing; two-way synced with the switch state, no loops
- [x] Implement Redux-lite store: getState, dispatch, subscribe, ~50 lines
  - `src/shell/store.ts`; a reducer returning the same ref is a no-op (listeners don't fire) — that's what makes re-throwing the active radio switch free. Store holds only serializable UI state (`{ mode, userPaused }`); worker/loop/input/canvas stay imperative outside it
- [x] Implement CODE view skeleton: split pane layout, `<textarea>` editor left, preview canvas + state pane right
- [ ] Swap CodeMirror into the CODE view editor pane, replacing the `<textarea>`
- [x] Wire editor content to worker: on change, debounce 300ms, send LoadMessage
  - the editor's textarea is the single source of the cassette code — boot and edits both flow through one `loadFromEditor` bridge, while `loadCassette(cassette)` stays generic for later RUN/server loads
- [x] Implement state pane: `JSON.stringify(state)` rendered in the side pane below the preview, updated each tick
  - worker now emits `StateMessage` each tick (it never did before); non-serializable state skips the pane update rather than crashing the frame
- [~] Implement SHELF view skeleton: placeholder cards
  - the room has a gray-box SHELF placeholder in frame (right of the console); no cards and no click-to-zoom yet
- [x] Implement RUN view skeleton — the desk-room wide shot (game on the monitor, console + shelf in frame). Mobile full-screen RUN is still Phase 8
- [x] Implement navigation between views
  - the IMSAI switch bank is the nav model: RUN/CODE/HELP as a radio group (re-throwing the active one is a no-op) + an independent PAUSE toggle. A scripted 2D camera (`frameToRect` over a fixed 1512×982 scene, 450ms ease-out, reduced-motion cut) parks at the RUN wide shot or the machine push-in; CODE↔HELP stays zoomed and only swaps monitor content. The worker/loop/canvas persist across every switch (no reload). Pause is derived (`userPaused || help`) so HELP pauses without moving the switch; a status light (palette index 0) lights on effective pause
- [ ] Implement play/pause button in CODE view
  - superseded — PAUSE is now a switch on the machine, controllable in any mode, not a CODE-only button
- [ ] Scope mobile RUN styles to the RUN view — the `touch-action: none` + `overflow: hidden` body styles were dropped when `index.html` became the CODE view; reintroduce them scoped to the RUN view container (not `body`) when RUN lands, so the editor and feed can still scroll on mobile

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

- [x] Scale canvas to fill mobile viewport preserving aspect ratio
- [x] Implement touch input: pointerdown anywhere on canvas → a = true
- [x] Add touch-action: none to canvas and body
- [x] Add passive: false to touchstart and touchmove listeners
- [x] Add viewport meta tag: user-scalable=no
- [ ] Test on iOS Safari and Chrome Android
- [ ] Implement "edit on desktop" message in CODE view on mobile (blocked — CODE view is Phase 3)

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

_Phase 3 in progress — the desk-room skeleton is up (§7): a fixed 1512×982 scene with a scripted 2D camera, the RUN wide shot and the machine push-in, and the IMSAI switch bank (RUN/CODE/HELP radio + PAUSE) driving both the store (`{ mode, userPaused }`) and a `#run`/`#code`/`#help` hash router. The console (worker/loop/monitor-canvas) persists across every switch; the CODE framing keeps the live-edit `<textarea>` loop. Furniture (console body, tape deck, shelf) is still gray-box; HELP is a placeholder. Next up: CodeMirror swap, real SHELF cards + click-to-zoom, and the tape-deck controls. Still open elsewhere: a few Phase 2 primitives (`circStroke`, `circFill`, `polyStroke`, `print`, `rnd`). See §11 for live task status._

_Presentation direction has since moved: the throwaway 3D spike (`spike/3d/`,
documented in `design/handoff-realism.md`) proved a real-3D room — WebGL housing
with live CSS3D screens — is viable and pixel-crisp, falsifying §1/§7's original
"not CSS 3D" decision. The current gray-box 2D shell is therefore provisional; how
far to push realism is the live open question, and §7 gets a full rewrite once it
settles. The real shell (`index.html`, `src/shell/`) is untouched by the spike._
