# Handoff — from wireframe to a real machine

Supersedes the open questions in `design/handoff-3d-spike.md`. That document's
_design_ decisions (the machine's layout, the prime directive, the camera rule,
input/output split) still stand and are not repeated here. What changed is
everything it guessed about rendering.

The spike lives at `spike/3d/` — throwaway, no build step, Three.js r160 from a
CDN, served by `dev-server.js` at `/spike/3d/`. Read `spike/3d/README.md` for
the controls; this document is why.

---

## What the spike settled

Each of these was observed, not reasoned.

- **CSS3D text is genuinely crisp** — dead-on at rest, and it stays sharp under
  rotation too (it just renders at an angle). This is stronger than the handoff
  hoped for, and it **kills the freeze-to-texture fallback** as a crispness
  measure. `PLAN.md` §1's locked decision — "deliberately not CSS 3D: 3D
  transforms would smear both and fight the pixel grid" — is falsified.
- **The occlusion limitation is real and immediately visible** at any recess
  greater than zero: the screen draws over the well wall that should be in front
  of it. **The fix works** (see below).
- **The flight to the shelf feels like a room**, not a rotating diagram.
- **Motion reads fine.** Flying back and forth showed no visible skew between
  the DOM and WebGL layers.
- **Wireframe/Tron is rejected.** Not the direction.
- **A fake additive "bezel glow" adds nothing.** Diagnosis: the shell palette is
  `#f0f0f0 / #a8a8a8 / #4a4a4a / #0d0d0d`, pure grayscale, and a gray glow on a
  near-black monochrome chassis has nothing to say. Worth revisiting only if
  `PLAN.md` §8's palettes (`noir`, `dusk`, `moss`, `gameboy`) land with actual
  hue. The _physical_ version — screens as real area lights — is a different
  thing and is now in the spike untested.

## The constraint set — do not rediscover any of this

These are load-bearing. Each was found by breaking it.

**Pixel-exactness requires all of:**

1. Camera z must equal `camera.projectionMatrix.elements[5] * (vh / 2)` — read
   back out of the projection matrix, never recomputed from trig.
   `CSS3DRenderer` derives its `perspective()` from that exact number, and any
   float drift becomes a `translateZ`, which is a scale, which is blur.
2. **The viewport must have even pixel dimensions.** The renderer centres with
   `translate(width/2, height/2)`; an odd viewport puts a half pixel in there and
   softens every glyph. This one line is the difference between "CSS3D is
   blurry" and "CSS3D is pixel-exact".
3. Screen elements sized in CSS px equal to their world size, with **even**
   dimensions, since `translate(-50%,-50%)` has to land on integers too.

**DOM lives at exactly one depth.** Anything off the 1:1 plane is magnified,
resampled by the compositor, and lands off the device-pixel grid — soft _and_
misaligned. Consequences: all screens share one recess depth; the camera parks
at `restZ() + SCREEN_Z` so the _glass_ plane is the 1:1 plane, not the front
panel; and **recess depth trades directly against how much of the enclosure fits
on screen at scale 1.0** (~1.09× magnification of the panel at 70px recess,
~1.44× at 260px).

**Two `CSS3DRenderer` booby traps.** `CSS3DObject`'s constructor sets
`user-select: none` on your element — it silently kills text selection in the
editor. And `CSS3DRenderer` sets `overflow: hidden` on its root, which makes it
a scroll container, so focusing the textarea lets the browser scroll the scene
off the pixel grid; set `clip`. (`index.html` already learned the second one.)

**Occlusion has a closed form.** WebGL can never occlude DOM — unfixable. But
the only thing that ever passes in front of a screen here is its _own_ recess
well, and the aperture and glass are **parallel planes**, so the aperture's
shadow on the glass is a uniform scale about the eye's axis point: still an
axis-aligned rectangle, at any camera angle, depending only on camera _position_
(rotation never enters). Visible glass is a rect ∩ rect, reproduced exactly by
`clip-path: inset()` in the element's own untransformed coordinates. Dead-on it
computes to zero, so the property is dropped entirely at rest and the element is
byte-for-byte unchanged. Implemented and confirmed working. It does **not**
solve some _other_ object crossing in front — that would still need the
fallback.

**Size.** The enclosure is 1556×822 against a 1512-wide viewport and clips ~22px
per side. At scale 1.0 the enclosure can never exceed the narrowest viewport you
support, which caps the editor glass width. Not a trade the previous handoff
costed.

**The realism ceiling is architectural, not artistic.** The screens are live DOM:
unlit, flat sRGB, unable to receive a photon from the scene. The more photoreal
and _lit_ the housing gets, the more they read as stickers on a render. Full
photorealism is not available at any level of modelling skill. This picks the art
direction: **dim room, machine mostly in shadow, screens as the brightest thing
in frame** — the one lighting design where an unlit self-luminous screen is
physically _correct_. Push toward daylight and it collapses.

Smaller ones: ACES tone mapping shifts WebGL blacks relative to the DOM's, so
anything that must match DOM white (the skew gauge, edge lines) needs
`toneMapped: false`. `RectAreaLight` cannot cast shadows in three. Bare
`BufferGeometry` quads carry no `uv`, so materials used on them can carry no
maps.

## Where the code is now

The last thing done was a re-shade, **rendered once and judged "going to need
work"** — no specifics gathered. It is unevaluated, not endorsed:

- Chassis is one `ExtrudeGeometry` (outer contour + a hole per aperture) with a
  3px bevel on every edge, replacing the flat panels, wells, and shell.
- `MeshStandardMaterial` over a procedurally generated grain texture (no
  external assets, so the CSP story survives).
- Lights: dim ambient, warm key with shadow maps, cool rim, and the three
  screens as `RectAreaLight`s on the glass with the game's colour and intensity
  driven by the tube's running average.
- 75 rounded keycaps as an `InstancedMesh`, deck reels, speaker slats and a
  half-open cover, raised buttons.
- ACES tone mapping, PCF soft shadows.
- `L` toggles the old white edge lines back on **over** the shaded model —
  shaded solids with edge lines is a real stylistic middle ground, and that key
  exists to walk the axis rather than to debug.

First knobs if it's close but wrong: `toneMappingExposure` (1.15) and the key
light intensity (0.85). Lower both to push into the dark, which is the direction
the DOM screens want.

`spike/3d/README.md` was not updated for this last change; everything before it
is documented there.

## Workflow — the conclusion reached, untested

- **Geometry stays in code.** The aperture rects and the glass plane are design
  data, not art: 860×530, a perfect 384×384, one shared recess depth, everything
  landing on whole device pixels. That constraint set is what makes the text
  crisp; it belongs in source where it can be asserted, not measured off a mesh.
- **Image generation is for mood, not geometry.** You cannot recover exact
  coordinates from a perspective render, and it has already failed at this once
  in this project — garbled button labels, a watermark in frame, a game screen
  that wouldn't render square, a third screen that kept becoming a speaker
  grille.
- **Blender earns its place for look-dev and baking, not modelling.** Iterating
  materials by editing JS numbers is miserable; Eevee gives a real-time PBR
  viewport and parameters port to `MeshStandardMaterial` nearly 1:1. Lighting
  here is effectively static, so **baking AO/lighting to textures** is the
  biggest remaining realism win and costs nothing at runtime.
- **Image-to-3D generators are fine for props** — shelf, desk, anything where
  precision doesn't matter. Don't point them at the machine.
- **Probably don't build a room or a landscape yet.** At rest the enclosure
  over-fills the viewport; the only moment anything else is visible is the
  ~900ms flight to the shelf. A dark void with a few suggestive elements will
  read fine.

## Still open

- **How far toward realism.** The live question. The re-shade is a first
  attempt, not an answer.
- Whether edge lines belong on the shaded model at all, and at what weight.
- Whether layer skew exists during flights. The gauge produced two false
  positives (below) and its corrected form is **untested**; the only real datum
  is that flights look fine by eye.
- Editor glass dimensions and the font-size trade — the spike has `T` to switch
  between dense (~107×34) and chunky (~82×25), still unjudged.
- Everything `design/handoff-3d-spike.md` lists as open: state-screen buttons,
  music auditioning, whether any 1:1 draggable mechanism survives besides the
  speaker cover.

## What is stale

- `PLAN.md` §7 (whole section) and §1's "scripted 2D camera, not CSS 3D" —
  the latter is now demonstrably wrong. §7 needs a full rewrite once the look
  settles.
- `design/handoff-navigation.md` — superseded, as the previous handoff says.
- `design/gemini-2.txt`, `room-art*.png` — the PNG-background approach.
- `index.html` / `src/shell/index.ts` — the tray model, `FRAMINGS`, 1800ms
  transitions, `Horizontal`/`Tool`. Untouched by the spike and still live in the
  real shell.
- `spike/3d/README.md` §6 — never written for the re-shade.

## The lesson worth carrying forward

The previous handoff's lesson was that reasoning about feel produces confident
conclusions only a prototype can settle. This session managed the same failure
_with_ a prototype.

The layer-skew gauge — a comb, half WebGL and half DOM, meant to merge into a
solid bar when in sync — produced a convincing "skew" pattern twice, and both
times it was the instrument. First it sat 2px off the 1:1 plane, so the DOM half
was resampled and every boundary grew a gray seam in perfect sync. Then, at 70px
recess, the panel hid the entire WebGL half, because a thin band far off the
camera axis viewed through a slot on a different plane slides off itself
(`d·(t−1) < h` fails: 34 < 24). Each artifact was read as a finding and acted on
— one of them resurrected the freeze-to-texture fallback that had already been
correctly killed.

**If you build an instrument, calibrate it against a known-good case before you
believe it.** And prefer the direct observation when you have one: "flying back
and forth reads fine" was worth more than either gauge reading, and was
available the whole time.

The gauge's reading guide, now in the spike README, is the compressed version:
**skew makes thin seams; a missing half makes gaps as wide as the teeth.**
