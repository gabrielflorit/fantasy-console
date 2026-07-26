# Handoff — Desk-room navigation (RUN / CODE / HELP)

> **SUPERSEDED.** The tray/slide-viewer navigation model described here has been
> replaced by the 3D-housing direction. Live design: `design/handoff-realism.md`
> (rendering) and `design/handoff-3d-spike.md` (layout, camera, I/O split). Kept
> for history — the tray model still matches the current shell code, which the
> spike has not yet replaced.

## Goal
Replace the old CODE split-pane with a tactile "desk-room" shell where
RUN/CODE/HELP navigation feels like physically moving parts of a machine (a
slide-viewer metaphor), not abstract view toggles. The console (worker, game
loop, canvas) persists across every switch — switching never reloads the
cassette.

## Current model — two independent rigid trays + a camera
- **Horizontal axis** — `horizontal: 'run' | 'work'`. The entire bottom
  `#h-tray` (left pane **+** game canvas **+** state pane) slides as **one rigid
  unit**. `work` = `translateX(0)` (editor left, game+state right); `run` =
  `translateX(-258px)`, which slides the whole tray left so the 310² game lands
  centered in the aperture (a ~262px strip of editor stays visible at the far
  left — this was an accepted tradeoff). This axis **also drives the camera**:
  run = wide room shot, work = machine push-in.
- **Vertical axis** — `tool: 'code' | 'help'`. The `#inner-tray` (inside
  `#left-pane`) slides `translateY` to register a fixed-height 415px pane (CODE
  editor / HELP card; ART later) into the left pane. Independent of the
  horizontal axis.
- **Switch mapping:** RUN → `{horizontal:'run'}` (tool preserved); CODE →
  `{work, code}`; HELP → `{work, help}`. Pause is derived:
  `userPaused || (work && help)`. Hash router: `#run`/`#code`/`#help`.
- **Store:** Redux-lite (`src/shell/store.ts`) — reducer returns the same ref
  for no-op actions, so re-throwing the active switch is free.

## Key geometry (all in scene/aperture px)
- Stage & scene: 1512×857. Aperture `#screen`: left 250, top 85, **875×415**.
- `#h-tray` 875×415 → translateX `0` / `-258`. `#canvas` left 540, top 20, 310².
  `#state` left 540, top 336, 310×74.
- `#left-pane` 0,0 520×415. `#inner-tray` 520×830 → translateY `0` / `-415`.
  Panes 415 tall each (`#pane-code` top 0, `#pane-help` top 415).
- FRAMINGS: `run {70,20,1380,820}`, `machine {235,70,910,510}`. All transitions
  **1800ms** `cubic-bezier(0.22,1,0.36,1)`, cut under reduced-motion.

## Recent fixes (all landed, building clean)
1. Slowed transitions 450 → 900 → **1800ms**.
2. Went from split independent slides to **one rigid h-tray** (left pane no
   longer outruns the game).
3. Game **centers** in RUN via a partial `-258px` slide (editor strip shows —
   okayed).
4. Made the tool frames **fixed-height opaque `.pane` cells**; the editor
   scrolls internally and can't stretch its frame.
5. **`overflow: clip`** (not `hidden`) on `#screen`/`#left-pane`/`.pane` — fixed
   the focus-scroll bug where sliding the *focused* editor out of view made the
   browser chase it and cancel the CODE→HELP transition.

## What works
Both axes slide smoothly and correctly, in both directions; the game centers in
RUN; the editor can't distort the strip. Mechanically, it does exactly what was
specified.

## Open problem (the reason for this handoff)
**It still "doesn't feel right" overall — undiagnosed.** The mechanics are
correct but the *feel* isn't there yet. Candidate leads to probe next (none
confirmed):
- **Too many simultaneous motions.** RUN→CODE fires camera push-in **+** h-tray
  slide at once (and RUN→HELP adds the inner-tray slide). Three
  coordinated-but-independent motions may read as busy/uncoordinated rather than
  one gesture. The user's *original* instinct was to **sequence** motions (lean
  in, *then* reveal) — we never tried true sequencing; everything currently runs
  concurrently.
- **Two metaphors competing.** Camera "depth" (leaning in) + slide-viewer
  "lateral trays" may not fuse into one coherent physical space.
- **The RUN compromise** (game centered but editor strip visible) may itself
  feel off.
- Easing/pacing, or the fact that the game sits idle-centered with a state blob
  under it during RUN.

## Files touched (all uncommitted on `main`)
`index.html` (DOM + all CSS), `src/shell/index.ts` (state model, camera, render,
router, switch wiring), `src/shell/store.ts` (new), `dev-server.js` (serves
`/design/` assets, no-store), `PLAN.md` (§11 status). Art:
`design/room-art-wide.png`.

## Not yet started (Phase 3 remainder, per PLAN §11)
CodeMirror swap for the `<textarea>`; real SHELF cards + click-to-zoom
(currently gray-box); tape-deck controls; a few Phase 2 primitives
(`circStroke`, `circFill`, `polyStroke`, `print`, `rnd`).
