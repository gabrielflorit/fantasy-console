# Handoff — 3D housing spike

## Why this exists

The engine parts (editor, game loop, worker, state pane) are known quantities —
SCRIPT-8 already proved them. The genuinely new thing in this project is
**housing that engine inside a real computer**, and nobody knows yet what that
feels like. A long design conversation (summarized below) settled a lot of
*structure* but zero *feel*, because feel can't be settled by reasoning. Hence a
throwaway prototype.

**Everything in this document is untested design reasoning.** None of it has been
built or measured. The spike exists to test the riskiest assumption.

---

## The task: build a throwaway spike

Not production code. Put it in a scratch directory, not in `src/`. It will be
deleted.

Build a Three.js scene containing:

- A **wireframe box** standing in for the enclosure — white lines on near-black,
  no shading, no textures.
- **Three planes** on its front face, in the layout below (large editor screen,
  square game screen, small state screen).
- A **real live `<textarea>`** on the large plane, via **`CSS3DRenderer`** — not
  rendered to a texture. It must be genuinely editable, with a real caret and
  real text selection.
- Something animated on the game plane so there's motion (a moving rectangle is
  enough — it does not need to be the real worker).
- A **gray box off to the right** standing in for the SHELF.
- A **camera that flies between** the machine and the shelf, triggered by a
  keypress or a click. At the machine it must rest **dead-on, unrotated, at
  scale 1.0**.

Three.js is not vendored and the project has zero npm dependencies. For a
throwaway spike a CDN import is fine; do **not** add it to `package.json` or
`vendor/`. (`PLAN.md` §3's `connect-src 'none'` CSP applies to the shipped
worker, not to this scratch prototype.)

### The four questions the spike must answer

1. **Is the editor text genuinely crisp at rest?** Dead-on and unscaled, a
   CSS3D plane should resolve to an identity transform and be pixel-perfect.
   Verify by eye at 100% zoom against a plain non-3D `<textarea>` side by side.
   This is the single most important result — if text is soft at rest, the whole
   approach needs the fallback described below.
2. **Does flying to the shelf produce a "real world" feeling**, or does it just
   look like a rotating diagram?
3. **Does wireframe-in-motion read as period-correct** (Battlezone, Tempest,
   Elite — 1980s vector graphics) **or as a modern tech demo?**
4. **Is the occlusion limitation invisible or maddening?** (See below.)

### Known CSS3DRenderer limitations — do not rediscover these

- **DOM is not in the depth buffer.** `CSS3DRenderer` composites real DOM in a
  separate layer over/under the WebGL canvas. WebGL geometry can *never* occlude
  a DOM element. Rotate far enough that the bezel should pass in front of a
  screen and it won't — the screen draws on top of its own chassis. The bet is
  that this design never needs occlusion (head-on viewing, nothing passes in
  front of the screens). Question 4 tests that bet.
- **No shader effects on the screens.** Scanlines, phosphor bloom, barrel
  distortion, glow — none can touch a DOM element. CSS only. This is a real
  loss, since CRT glow is part of "feels real."
- **Layer cost under motion.** Every CSS3D element is a composited layer.
  A full CodeMirror tree re-composited per frame during a camera move may chug.
  Free at rest.

### Fallback architecture if crispness or performance fails

Swap rather than composite: live DOM at rest (camera dead-on, pixel-perfect,
identical to today's flat DOM); on camera-move start, freeze the screens to
textures and go **pure WebGL** for the flight — full 3D freedom, shaders, no
layer cost — then restore live DOM on arrival. A live editor is never needed
*during* a camera move, so the freeze is free.

---

## Design decisions settled in conversation (all untested)

### The prime directive

**Instant feedback, à la Bret Victor, outranks everything else in the project** —
including mechanical charm. Consequences that follow:

- Cause and effect must be in the same glance, so the game must be visible while
  you type. Non-negotiable.
- The current **1800ms** transitions are a direct violation — latency
  deliberately added to a project whose top value is its absence.
- **Pause + rerun `draw()` is the substrate for all instant feedback**, not just
  Phase 4 numeric scrubbing. Worth building before Phase 4, not as part of it.

### The machine

One all-in-one enclosure, everything integrated. Two rows:

- **Top row:** editor CRT (large, left, ~860×530 glass, ~34 lines) and game CRT
  (right, **a perfect 384×384 square**). Tops aligned.
- **Bottom row:** keyboard (under the editor), cassette deck (under the game),
  and a **third small CRT at the right end** for game state.

Column logic — **a control sits under the display it acts on**:

| | left | right |
| --- | --- | --- |
| tube | editor | game (square) |
| bezel | CODE / ART / MUSIC / HELP | PAUSE |
| below | keyboard | cassette deck |

- **384px is the game size**, forever: 6× at 64², 3× at 128². The console gets
  sharper, never bigger. The game display **never moves and never resizes.**
- **Tool selector = interlocked pushbuttons** (car-radio presets — pressing one
  pops the others out). Exactly one is always down, so the editor screen always
  shows a tool. No null state.
- **RUN is deleted as a mode and as a button.** It only ever existed because one
  screen did two jobs. The game now has its own tube and is always on.
- **State display**: one small CRT, not a nixie strip. Must refresh at ~4–5Hz,
  **not 30Hz** — a value changing 30×/sec is unreadable, and it would steal the
  game's attention anchor. Two bezel buttons select what's watched (mechanism
  undesigned).
- **Speaker grille with a sliding cover**, where **the cover's position is the
  volume control** — fully open is loud, halfway is quieter, closed is off.
  Halfway is a legal resting state. Sound is v2, but the enclosure part has to
  exist now because you cannot retrofit hardware into art.

### The camera

**The camera changes where you *are*; the machine changes what it's *doing*.
Never both in one action.**

- Default and near-permanent view: **at the machine, scale 1.0.**
- The *only* camera move in the product is stepping back to reach the **shelf**.
- No camera move per mode. CODE↔ART↔MUSIC↔HELP move nothing but the tool.
- Scale ≠ 1.0 breaks the pixel grid. The old `FRAMINGS.machine` scaled by
  **1.6615**, rendering the 310px canvas at 515.06px — non-integer, so console
  pixels came out unequal widths. `PLAN.md` §7 rejects CSS 3D for this reason
  but never noticed a 2D `scale()` does the same thing.

### Input / output split

- **The game CRT is the only output organ.** ART and MUSIC get **no local
  preview** — you edit a sprite, the game updates. The work surface is input
  only, one tool at a time.
- This is what buys the right to a quirky one-tool-at-a-time selector: the
  feedback loop that matters never switches away.
- **Two known holes.** (a) *Targeting* — editing a sprite that isn't currently on
  screen produces no feedback; the answer is pause + redraw. (b) *Music* — its
  feedback organ is the speaker, so it will need note/pattern auditioning. This
  is the one place "the game is the preview" is false.
- Architecturally, `Cassette` grows from `{ code }` to
  `{ code, sprites, music, palette }`, and `tapeDeck.load()`'s existing
  hot-reload rule (diff `init`'s source, preserve state otherwise) generalizes
  unchanged. A sprite edit is just another load.

### Art direction

- Monochrome line art survives, but **editors get color** (~8 colors, for syntax
  highlighting), so "the only color is the game" is dead.
- **The game's attention anchor is now that it is the only thing that MOVES.**
  Syntax highlighting can't take that away — which is exactly why the state
  screen must refresh slowly.
- If this goes 3D, target **wireframe vector** (Elite / Battlezone), not
  photorealism. Photoreal contradicts the line-art direction; wireframe is
  period-correct *and* preserves it.

### Numeric scrubbing (Phase 4)

Keep SCRIPT-8's interaction: **click the number, drag it in place.** A panel knob
was considered and rejected — it puts your hand 600px from the number and
violates the proximity principle. If the work surface is a character-cell
display, the widget renders as inverse video plus a blocky text-mode bar, which
is more period-correct than a smooth slider anyway. Needs no new hardware; the
freeze it requires is PAUSE, which already exists.

---

## What is now stale in the repo

Do not trust these — they describe the superseded design:

- **`PLAN.md` §7** (the whole section): RUN as a wide camera shot, a camera move
  per mode, a single screen, IMSAI switches as the nav model, SHELF reached from
  RUN. Also **§1 locked decisions** ("scripted 2D camera, not CSS 3D") is now
  under active reconsideration, and **§11**'s Phase 3 status.
- **`index.html`**: the `#h-tray` / `#inner-tray` two-tray model, 1800ms
  transitions, `#state` pane under the game, and switch coordinates the comments
  themselves label `(est.)`.
- **`src/shell/index.ts`**: the `Horizontal`/`Tool` state model, `FRAMINGS`, and
  the camera-per-mode `render()`.
- **`design/handoff-navigation.md`**: superseded by this document.
- **`design/gemini-2.txt`** and `design/room-art-wide.png`: the PNG-background
  approach, likely abandoned. The generated art never came out usable — garbled
  button labels ("NELP", "PHUSE"), a Gemini watermark in frame, a game screen
  that wouldn't render square, and a third screen the model kept turning into a
  speaker grille. Latest attempt was at `/tmp/drop.png`.

**If the spike succeeds, `PLAN.md` §7 needs a full rewrite** — it is the design
source of truth and it currently contradicts nearly everything above.

---

## Still open

- **SVG vs. straight to 3D** for the enclosure. The case for SVG: exact
  coordinates instead of measuring a raster, trivially hand-authorable (straight
  lines, orthographic, no shading), and it extrudes naturally into wireframe. The
  spike may make it moot.
- Editor glass dimensions and the font-size trade (chunky ~80 columns vs. more
  visible lines).
- How the state screen's two buttons choose what to watch.
- Whether any 1:1 draggable mechanism survives besides the speaker cover. The
  interlocked buttons replaced an earlier lever idea; the "is halfway a legal
  state?" test is still the right test for any mechanism that stays.
- Music auditioning.

## The lesson worth carrying forward

This design went several long rounds of reasoning about *feel* without building
anything, and the reasoning kept producing confident conclusions that only a
prototype can actually settle. When the question is "how will this feel," build
the smallest throwaway thing that answers it.
