# 3D housing spike

Throwaway prototype for `design/handoff-3d-spike.md`. Not production code, not
in `src/`, no build step, no dependencies added — Three.js comes from a CDN via
an import map. **Delete this directory when the questions are answered.**

## Run

```bash
node dev-server.js          # restart it if it was already running
open http://localhost:3000/spike/3d/
```

Then **set browser zoom to 100%** (⌘0). Any other zoom invalidates question 1.

## Controls

Keys only fire when you are _not_ typing in a textarea; `Esc` leaves the editor.
Every key also has a HUD button, so you never have to blur to navigate.

|                 |                                                                   |
| --------------- | ----------------------------------------------------------------- |
| `M` / `S`       | fly to the machine / to the shelf (or click either one)           |
| `C`             | overlay compare — a plain non-3D textarea on the exact same rect  |
| `V`             | side-by-side compare — plain textarea parked over the game screen |
| `F`             | freeze fallback — hide the DOM screens whenever not at rest       |
| `T`             | font preset — dense (~107×34) vs chunky (~82×25)                  |
| `[` `]`         | flight duration ±150ms                                            |
| `,` `.`         | recess depth ∓10px (how far the glass sits behind the panel)      |
| `O`             | occlusion clip on/off — the fix, and the A/B for it               |
| `B`             | bezel glow — the housing lit by the tube                          |
| `G`             | layer-skew gauge                                                  |
| drag background | orbit diagnostic (machine only)                                   |
| `H`             | hide the HUD                                                      |

## What to look at, question by question

### 1. Is the editor text genuinely crisp at rest?

The HUD's first line is the objective half of this. It reports the editor's
projected `getBoundingClientRect()` and says **PIXEL-EXACT** when the box is
exactly 860×530 at integer coordinates — i.e. the CSS3D transform chain has
collapsed to a pure integer translate with no scale.

Three things had to be right to get there, all of them easy to get wrong and
then wrongly conclude "CSS3D is blurry":

- The camera sits at exactly the distance `CSS3DRenderer` derives its
  `perspective()` from, read back out of the projection matrix rather than
  recomputed — any drift becomes a `translateZ`, which is a scale, which is blur.
- The viewport is forced to **even** pixel dimensions. The renderer centres the
  scene with `translate(width/2, height/2)`; an odd viewport puts a half pixel in
  there and softens every glyph.
- Screen elements are sized in CSS px equal to their size in world units, with
  even dimensions (`translate(-50%,-50%)` has to land on integers too).

PIXEL-EXACT means the _geometry_ is exact. It does not prove the _rasterisation_
is — a browser may still composite a 3D layer with grayscale antialiasing where
plain DOM would get subpixel AA. That is what `C` is for: it flickers a plain
textarea onto the identical rect, which is a far more sensitive test than looking
at two of them side by side. If you see the glyph weight or colour fringing shift
as you toggle, the geometry is fine and the rasteriser is the problem — and the
fallback architecture (`F`) is the answer.

### 2. Does flying to the shelf feel like a real world?

The flight arcs backwards through a pulled-back control point rather than
sliding sideways, and the look-at target lerps so the camera turns its head.
Tune with `[` / `]` — 900ms is the starting guess, deliberately not 1800ms.
The question is whether it reads as moving through a room or as a diagram
rotating.

### 3. Does wireframe-in-motion read as period-correct?

Two brightness tiers: chassis and bezels bright, surface detail (keys, grille,
reels, cassettes) dim. **There are no text labels** — no font is loaded, so the
buttons are unlabelled rectangles. Judge the motion, not the legibility.

### 4. Is the occlusion limitation invisible or maddening?

The chassis is **solid**, not wireframe — near-black panels with white edges, a
flat-shaded vector look rather than a lit render. The front panel has an
aperture punched for each screen, and each screen sits **70px behind it** down a
recess well. Those well walls are the surfaces that should cross in front of the
glass as you rotate, and never will.

Drag the background to orbit until a well wall ought to clip the picture. Then
fly to the shelf and watch the three screens hang in the air over the rack,
3000px away. That is the worst case, and it is the case the product actually
hits.

**With any recess at all, the break is immediately visible** — the screen draws
over the well wall that should be in front of it. Press `O` to see it; that
toggles the fix off.

#### The fix: compute the occlusion instead of compositing it

WebGL geometry can never occlude DOM. That limitation is real and unfixable.
But the only thing that ever passes in front of a screen in this design is its
**own recess well**, and that case is exactly solvable.

The aperture (z=0) and the glass (z=`SCREEN_Z`) are **parallel planes**. Project
the aperture onto the glass plane from the eye and you get a uniform scale about
the eye's axis point — so the shadow is still an axis-aligned rectangle, at any
camera angle. Two things follow:

- It depends only on camera **position**. Rotation doesn't enter into it.
- The visible part of the glass is a rect ∩ rect, which `clip-path: inset()`
  reproduces **exactly**, in the element's own untransformed coordinates.

At rest the shadow fully covers the glass, so the clip is dropped entirely and
the element is byte-for-byte what it was before — this costs nothing where the
crispness matters and is exact where it doesn't.

It does **not** solve some _other_ object passing in front of a screen. This
design says that never happens; if it ever does, that's when you need the
freeze-to-texture fallback, and not before.

`,` / `.` change the recess depth, because how bad the break looks depends
entirely on it — a flush screen has nothing in front of it to begin with, a deep
one always does. Two things move when you turn that dial:

- **The camera comes forward with the glass.** The 1:1 plane has to be the glass
  plane, so the camera parks at `restZ() + SCREEN_Z`. At 70px recess the front
  panel is magnified ~1.09× relative to the screens; at 260px it's ~1.44×, and
  you see correspondingly less of the enclosure in frame. **Recess depth trades
  directly against how much of the machine fits on screen at scale 1.0** — which
  is not a trade the handoff anticipated.
- **All three screens must share one depth.** Only one plane can be the
  pixel-exact one, so the editor cannot be recessed further than the game.

Press `F` to simulate the fallback (DOM hidden whenever not dead-on at rest) and
see whether the problem simply disappears. The HUD's **min fps in last flight**
is the other half of that decision: it resets at the start of every flight, so
you can compare a live-DOM flight against a frozen one directly.

### 5. How far can the realism go? (`G` and `B`)

#### The layer-skew gauge — `G`

DOM and WebGL are two compositor layers. Nothing guarantees the browser lands a
style write and a draw call on the same frame, so during a camera move the
screens can skew relative to the chassis housing them. **This is the ceiling on
realism**, because every effect you add makes the WebGL frame more expensive and
the skew worse — post-processing most of all.

`G` cuts a slot in the chassis and puts a comb in it. Half its teeth are WebGL,
half are DOM, interleaved. It's a **null test**: perfectly in sync, the teeth
merge into one solid white bar. Any slip at all and the comb pattern appears.

**Both halves must sit on the 1:1 plane** — the same plane as the glass — or the
gauge lies. The first version sat 2px proud of the front panel to dodge
z-fighting, which magnified the DOM half by 0.2%; the compositor then resampled
an already-rasterised bitmap, putting its tooth edges off the device-pixel grid
while the WebGL teeth stayed on it. That painted a gray seam at every boundary
**in perfect sync** — indistinguishable from the failure it was built to detect.
Hence the slot: it gives the WebGL half somewhere to live at the glass plane
with no panel to fight. The teeth also skip `polygonOffset` (unlike everything
else in `solid()`) so they land exactly where the geometry says, on whole device
pixels, where MSAA resolves to full coverage and adds no fringe of its own.

The general rule this exposes: **any DOM element off the 1:1 plane is resampled
and will not align pixel-exactly with WebGL geometry.** That is a constraint on
the design, not just on the instrument — DOM can live at exactly one depth.

**The gauge pins the recess to 0** while it's up, and `,` / `.` drop the gauge
rather than fight it. With the glass behind the panel, the slot you look through
and the teeth you look at are on different planes, so the slot's window onto the
glass plane is the slot scaled by `t` about the camera axis. The gauge is a thin
band far off that axis, so its window slides off the teeth entirely and the
panel hides the whole WebGL half. Overlap needs `d·(t−1) < h`; at 70px recess
that is 34 < 24, false. Nothing is lost by pinning: compositor skew has nothing
to do with recess.

#### How to read it

| what you see                                        | what it means                                             |
| --------------------------------------------------- | --------------------------------------------------------- |
| solid white bar                                     | in sync                                                   |
| thin gray seams at the boundaries                   | genuine skew, or a sub-pixel alignment error              |
| **clean 50% comb, black gaps as wide as the teeth** | one half isn't drawing at all — a build problem, not skew |

That last row is the one that fooled us twice. Skew makes _seams_; a missing
half makes _gaps_. Check which before concluding anything.

That's deliberately easier to read than looking for a tear — you're watching for
the _arrival of structure_ in a flat field, not trying to judge a small
displacement. Turn it on, fly to the shelf, and watch whether the bar stays
solid. Then shorten the flight with `[` (faster camera = more skew) and watch
again.

#### The bezel glow — `B`

The one direction the constraint allows light to travel. A DOM screen can't be
lit by the room, but the room _can_ be lit by the screen: the 64² bitmap is
averaged in the loop that already walks every pixel (so it's free), and that
colour drives the game's recess wall plus an additive falloff ring around its
aperture. The HUD shows the running average as **tube avg**.

The editor and state wells get fixed tints on the same principle — neutral for
the editor, green for the phosphor state screen — since you can't average a
textarea without rendering it.

This is worth more than it costs: it's physically right (a CRT is emissive, it
lights its surroundings), and it makes the housing respond to the screen at a
moment when the screen can't respond to the housing. Toggle it off and on with a
game running to judge whether it reads as integration or as a light show.

## What this spike deliberately does not do

- No worker, no real cassette — the game screen is a hand-rolled bouncing ball
  in the real 4-colour palette, at 64² upscaled 6× to 384.
- No syntax highlighting; a `<textarea>` can't have any. The ~8-colour editor
  from the handoff needs a different element, which is its own question.
- No freeze-to-texture. `F` hides the screens rather than rendering them into
  WebGL — enough to feel the performance and occlusion difference, not enough to
  be the fallback.
- No labels, no speaker-cover dragging, no interlocked-button behaviour. The
  bezel controls are drawn on the front panel, not wired or modelled in relief.

## Layout as built

Front face 1556×822, chassis depth 420, one world unit = one CSS pixel.

|       | left (860 wide)           | centre (384)     | right (200)                   |
| ----- | ------------------------- | ---------------- | ----------------------------- |
| tube  | editor 860×530            | game **384×384** | speaker grille                |
| bezel | CODE / ART / MUSIC / HELP | PAUSE            | —                             |
| below | keyboard                  | cassette deck    | state CRT 200×150 + 2 buttons |

The state CRT ended up in a right-hand column of its own rather than at the end
of the bottom row, because the bottom row is already full at that width; the
speaker grille takes the space above it. **1556px wide is wider than a 1512px
viewport** — at scale 1.0 the enclosure clips by ~22px per side. That is a real
constraint the handoff hadn't costed: at 1:1 the enclosure can never be wider
than the narrowest viewport it must support, which caps the editor glass. The
HUD reports the exact overflow for the window you're in.
