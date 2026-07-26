// Throwaway spike — see ./README.md and design/handoff-3d-spike.md.
// Not production code. Nothing here is meant to survive.

import * as THREE from 'three'
import {
  CSS3DRenderer,
  CSS3DObject,
} from 'three/addons/renderers/CSS3DRenderer.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js'

// ---------------------------------------------------------------------------
// Layout
//
// One world unit == one CSS pixel. Every coordinate below is in "face coords":
// x right, y DOWN, origin at the top-left of the enclosure's front face. That
// matches how you'd measure a drawing; toWorld() flips y and recentres.
// ---------------------------------------------------------------------------

let FACE = { w: 1556, h: 822 }
let DEPTH = 420

// How far the glass sits behind the front panel. This is the whole point of the
// occlusion test: with a recess there is chassis IN FRONT OF the screen, which
// is the thing CSS3D can never draw over the DOM.
//
// Consequence: the 1:1 plane is now the GLASS plane, not the front panel. The
// camera has to sit `restZ() + SCREEN_Z` away, so it is the recessed screens
// that land at scale 1.0 — which is also why all three screens must share one
// recess depth. Only one plane can be the pixel-exact one.
let SCREEN_Z = -70

let L = {
  editor: { x: 28, y: 28, w: 860, h: 530 },
  // four interlocked pushbuttons: CODE / ART / MUSIC / HELP, under the editor
  toolButtons: { x: 28, y: 572, w: 84, h: 30, gap: 28, n: 4 },
  keyboard: { x: 28, y: 614, w: 860, h: 180 },

  game: { x: 916, y: 28, w: 384, h: 384 },
  // PAUSE sits under the tube it acts on, same as the tool buttons
  pause: { x: 916, y: 426, w: 84, h: 30 },
  deck: { x: 916, y: 490, w: 384, h: 304 },

  speaker: { x: 1328, y: 28, w: 200, h: 384 },
  state: { x: 1328, y: 490, w: 200, h: 150 },
  stateButtons: { x: 1328, y: 664, w: 84, h: 30, gap: 32, n: 2 },
}

// The three pieces of glass, in one place: they share a recess depth, an
// aperture rule, and the 1:1 plane. Each is also a real area light, since a
// tube emits — that is the only direction light can travel here.
let SCREENS = [
  { name: 'editor', rect: L.editor, lightColor: 0xdfe4ea, lightIntensity: 1.4 },
  { name: 'game', rect: L.game, lightColor: 0xffffff, lightIntensity: 2.0 },
  { name: 'state', rect: L.state, lightColor: 0x9fca9f, lightIntensity: 0.8 },
]

// face coords -> world. z is negative going back into the screen.
function toWorld(x, y, z = 0) {
  return [x - FACE.w / 2, FACE.h / 2 - y, z]
}

// centre of a face-coords rect, in world
function centerOf(r, z = 0) {
  return toWorld(r.x + r.w / 2, r.y + r.h / 2, z)
}

// ---------------------------------------------------------------------------
// Renderers
//
// The viewport is forced to EVEN dimensions. CSS3DRenderer centres the scene
// with a translate of (width/2, height/2); an odd viewport puts a half pixel
// into that translate and every glyph in the editor goes soft. This one line is
// the difference between "CSS3D is blurry" and "CSS3D is pixel-exact".
// ---------------------------------------------------------------------------

let vw = 0
let vh = 0

let scene = new THREE.Scene()
let cssScene = new THREE.Scene()
let camera = new THREE.PerspectiveCamera(50, 1, 1, 20000)

let webgl = new THREE.WebGLRenderer({ antialias: true })
webgl.setPixelRatio(window.devicePixelRatio)
webgl.setClearColor(0x050505, 1)
// ACES lifts and desaturates the shadows, which is most of what stops a dark
// PBR scene reading as flat black. It does shift WebGL blacks relative to the
// DOM's, so the aperture edge is a real boundary now — which it should be.
webgl.toneMapping = THREE.ACESFilmicToneMapping
webgl.toneMappingExposure = 1.15
webgl.shadowMap.enabled = true
webgl.shadowMap.type = THREE.PCFSoftShadowMap
document.getElementById('webgl').appendChild(webgl.domElement)

let css3d = new CSS3DRenderer()
css3d.domElement.style.pointerEvents = 'none'
// CSS3DRenderer sets overflow:hidden on its root, which makes it a scroll
// container — so focusing the textarea lets the browser scroll it to "reveal"
// the caret, nudging the whole scene off the pixel grid. clip can't be
// scrolled at all. (index.html already learned this the hard way.)
css3d.domElement.style.overflow = 'clip'
document.getElementById('css3d').appendChild(css3d.domElement)

// The camera distance at which one world unit is exactly one CSS pixel at z=0.
// Read straight back out of the projection matrix rather than recomputing the
// trig, because CSS3DRenderer derives its `perspective` from that same number —
// any float drift between the two shows up as a translateZ, i.e. as a scale,
// i.e. as blur.
function restZ() {
  return camera.projectionMatrix.elements[5] * (vh / 2)
}

// Where the camera parks: far enough back that the GLASS plane, not the front
// panel, is the one at scale 1.0.
function machineZ() {
  return restZ() + SCREEN_Z
}

function resize() {
  vw = Math.floor(window.innerWidth / 2) * 2
  vh = Math.floor(window.innerHeight / 2) * 2
  camera.aspect = vw / vh
  camera.updateProjectionMatrix()
  webgl.setSize(vw, vh)
  css3d.setSize(vw, vh)
  if (mode === 'machine' && !flight) parkAtMachine()
}

// ---------------------------------------------------------------------------
// Enclosure
//
// Shaded solids, not wireframe. What makes an object read as physical is not
// polygon count — the geometry of a computer is rectangles — it is chamfered
// edges catching a highlight, roughness variation, and occlusion in the
// recesses. So: one extruded shape with a real bevel on every aperture, PBR
// materials over a procedural grain map, and a low-key light rig.
//
// The ceiling on all of it: the screens are live DOM, unlit and flat, and can
// never receive a photon from this scene. So the room is dim and the machine
// sits mostly in shadow with the screens as the brightest things in frame —
// the one lighting design in which an unlit self-luminous screen is physically
// CORRECT rather than a compromise. Push toward daylight and the screens
// immediately read as stickers.
// ---------------------------------------------------------------------------

let bright = []
let dim = []
let linesOn = false

// everything that depends on SCREEN_Z lives in one group so changing the recess
// depth is a rebuild rather than a reload
let enclosure = new THREE.Group()
scene.add(enclosure)

let gameAvg = [0, 0, 0]
let glowOn = true

let GAUGE = { x: 378, y: 2, w: 800, h: 24 }
let TOOTH = 8
let gaugeOn = false
let gaugeGroup = new THREE.Group()
let gaugeEl = null
let gaugeObj = null
let recessBeforeGauge = null
scene.add(gaugeGroup)

// how far the keyboard / deck / speaker trays sit below the front panel
let TRAY_Z = -26

// world-space bounds of a face-coords rect
function bounds(r) {
  let [x0, y1] = toWorld(r.x, r.y)
  let [x1, y0] = toWorld(r.x + r.w, r.y + r.h)
  return { x0, y0, x1, y1 }
}

function quad(into, a, b, c, d) {
  into.push(...a, ...b, ...c, ...a, ...c, ...d)
}

function mesh(positions, material) {
  let g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.computeVertexNormals()
  return new THREE.Mesh(g, material)
}

function seg(into, a, b) {
  into.push(a[0], a[1], a[2], b[0], b[1], b[2])
}

function rect(into, r, z = 0, inset = 0) {
  let x0 = r.x - inset
  let y0 = r.y - inset
  let x1 = r.x + r.w + inset
  let y1 = r.y + r.h + inset
  let a = toWorld(x0, y0, z)
  let b = toWorld(x1, y0, z)
  let c = toWorld(x1, y1, z)
  let d = toWorld(x0, y1, z)
  seg(into, a, b)
  seg(into, b, c)
  seg(into, c, d)
  seg(into, d, a)
}

function pathOf(r) {
  let b = bounds(r)
  let p = new THREE.Path()
  p.moveTo(b.x0, b.y0)
  p.lineTo(b.x1, b.y0)
  p.lineTo(b.x1, b.y1)
  p.lineTo(b.x0, b.y1)
  p.closePath()
  return p
}

function buttonRects(spec) {
  let out = []
  for (let i = 0; i < spec.n; i++) {
    out.push({
      x: spec.x + i * (spec.w + spec.gap),
      y: spec.y,
      w: spec.w,
      h: spec.h,
    })
  }
  return out
}

// ---- Materials -------------------------------------------------------------
//
// A flat-coloured PBR surface still reads as CG, because nothing in the real
// world has uniform roughness. This grain map fixes that for free and with no
// external asset — which also keeps the shipped CSP story intact.

function grainTexture(size = 256) {
  let c = document.createElement('canvas')
  c.width = c.height = size
  let ctx = c.getContext('2d')
  let img = ctx.createImageData(size, size)
  for (let i = 0; i < size * size; i++) {
    let v = 118 + (Math.random() * 44 - 22)
    img.data[i * 4] = v
    img.data[i * 4 + 1] = v
    img.data[i * 4 + 2] = v
    img.data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  let t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(28, 14)
  return t
}

let grain = grainTexture()

let MAT = {
  chassis: new THREE.MeshStandardMaterial({
    color: 0x2b2825,
    roughness: 0.78,
    metalness: 0.0,
    roughnessMap: grain,
    bumpMap: grain,
    bumpScale: 0.4,
  }),
  // no maps: this one is applied to bare quads from mesh(), which carry no uv
  // attribute, so any texture would sample one texel forever
  tray: new THREE.MeshStandardMaterial({
    color: 0x191817,
    roughness: 0.92,
    metalness: 0.0,
  }),
  key: new THREE.MeshStandardMaterial({
    color: 0x353230,
    roughness: 0.62,
    metalness: 0.0,
    bumpMap: grain,
    bumpScale: 0.2,
  }),
  metal: new THREE.MeshStandardMaterial({
    color: 0x6d6961,
    roughness: 0.4,
    metalness: 0.85,
  }),
  black: new THREE.MeshStandardMaterial({
    color: 0x050505,
    roughness: 0.95,
    metalness: 0.0,
  }),
}

// ---- Lights ----------------------------------------------------------------
//
// The screens are RectAreaLights sitting exactly where the glass is. That is
// the physically honest version of the bezel-glow hack: the tube really does
// light its own chamfer and well, and now there is a chamfer for it to catch.

let screenLights = []

function buildLights() {
  scene.add(new THREE.AmbientLight(0xffffff, 0.05))

  let key = new THREE.DirectionalLight(0xffe6c8, 0.85)
  key.position.set(-900, 1100, 1400)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  let c = key.shadow.camera
  c.left = -1100
  c.right = 1100
  c.top = 700
  c.bottom = -700
  c.near = 100
  c.far = 4000
  c.updateProjectionMatrix()
  scene.add(key)

  let rim = new THREE.DirectionalLight(0x7f93c8, 0.3)
  rim.position.set(1300, -400, -500)
  scene.add(rim)

  RectAreaLightUniformsLib.init()
  for (let s of SCREENS) {
    let l = new THREE.RectAreaLight(
      s.lightColor,
      s.lightIntensity,
      s.rect.w,
      s.rect.h,
    )
    scene.add(l)
    screenLights.push({ light: l, screen: s })
  }
  positionScreenLights()
}

// the glass moves with the recess, so the lights move with it
function positionScreenLights() {
  for (let { light, screen } of screenLights) {
    let [x, y, z] = centerOf(screen.rect, SCREEN_Z)
    light.position.set(x, y, z)
    light.lookAt(x, y, z + 1000)
  }
}

// ---- Chassis ---------------------------------------------------------------

// One extruded shape: outer contour plus a hole for every aperture, chamfered
// at both ends. The hole walls ARE the recess wells, and the bevel puts a real
// lit edge around each screen — the single biggest step away from wireframe.
function buildChassis() {
  let b = bounds({ x: 0, y: 0, w: FACE.w, h: FACE.h })
  let shape = new THREE.Shape()
  shape.moveTo(b.x0, b.y0)
  shape.lineTo(b.x1, b.y0)
  shape.lineTo(b.x1, b.y1)
  shape.lineTo(b.x0, b.y1)
  shape.closePath()

  let holes = [...SCREENS.map((s) => s.rect), L.keyboard, L.deck, L.speaker]
  if (gaugeOn) holes.push(GAUGE)
  for (let r of holes) shape.holes.push(pathOf(r))

  let geo = new THREE.ExtrudeGeometry(shape, {
    depth: DEPTH,
    bevelEnabled: true,
    bevelThickness: 3,
    bevelSize: 3,
    bevelSegments: 2,
    curveSegments: 1,
  })
  // extrude runs 0..DEPTH along +z; slide it back so the chamfered front face
  // lands exactly on z=0, which is what every other coordinate assumes
  geo.translate(0, 0, -DEPTH)
  enclosure.add(new THREE.Mesh(geo, MAT.chassis))

  // tray floors + opaque backs behind the glass
  let floors = []
  for (let r of [L.keyboard, L.deck, L.speaker]) {
    let f = bounds(r)
    quad(
      floors,
      [f.x0, f.y0, TRAY_Z],
      [f.x1, f.y0, TRAY_Z],
      [f.x1, f.y1, TRAY_Z],
      [f.x0, f.y1, TRAY_Z],
    )
  }
  enclosure.add(mesh(floors, MAT.tray))

  let backs = []
  for (let s of SCREENS) {
    let f = bounds(s.rect)
    quad(
      backs,
      [f.x0, f.y0, SCREEN_Z - 4],
      [f.x1, f.y0, SCREEN_Z - 4],
      [f.x1, f.y1, SCREEN_Z - 4],
      [f.x0, f.y1, SCREEN_Z - 4],
    )
  }
  enclosure.add(mesh(backs, MAT.black))
}

// 75 keycaps as one InstancedMesh — rounded, so every one of them catches the
// key light along its top edge. This is most of what says "keyboard".
function buildKeys() {
  let cols = 15
  let rows = 5
  let kw = (L.keyboard.w - 24) / cols
  let kh = (L.keyboard.h - 24) / rows
  let geo = new RoundedBoxGeometry(kw - 8, kh - 8, 16, 2, 2.5)
  let inst = new THREE.InstancedMesh(geo, MAT.key, cols * rows)
  let m = new THREE.Matrix4()
  let i = 0
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let fx = L.keyboard.x + 12 + c * kw + kw / 2 + (r % 2) * 3
      let fy = L.keyboard.y + 12 + r * kh + kh / 2
      let [x, y] = toWorld(fx, fy)
      m.makeTranslation(x, y, TRAY_Z + 8)
      inst.setMatrixAt(i++, m)
    }
  }
  inst.instanceMatrix.needsUpdate = true
  enclosure.add(inst)
}

function roundedAt(r, z, depth, material, radius = 3) {
  let g = new RoundedBoxGeometry(r.w, r.h, depth, 2, radius)
  let mm = new THREE.Mesh(g, material)
  let [x, y] = toWorld(r.x + r.w / 2, r.y + r.h / 2)
  mm.position.set(x, y, z)
  enclosure.add(mm)
  return mm
}

function buildDeck() {
  // cassette window, sunk into the tray
  let slot = { x: L.deck.x + 40, y: L.deck.y + 36, w: L.deck.w - 80, h: 150 }
  let b = bounds(slot)
  let win = []
  quad(
    win,
    [b.x0, b.y0, TRAY_Z - 10],
    [b.x1, b.y0, TRAY_Z - 10],
    [b.x1, b.y1, TRAY_Z - 10],
    [b.x0, b.y1, TRAY_Z - 10],
  )
  enclosure.add(mesh(win, MAT.black))

  for (let f of [0.3, 0.7]) {
    let hub = new THREE.Mesh(
      new THREE.CylinderGeometry(42, 42, 8, 28),
      MAT.metal,
    )
    hub.geometry.rotateX(Math.PI / 2)
    let [x, y] = toWorld(slot.x + slot.w * f, slot.y + slot.h / 2)
    hub.position.set(x, y, TRAY_Z - 4)
    enclosure.add(hub)
  }

  for (let i = 0; i < 4; i++) {
    roundedAt(
      { x: L.deck.x + 40 + i * 76, y: L.deck.y + 220, w: 56, h: 44 },
      TRAY_Z + 9,
      18,
      MAT.key,
    )
  }
}

function buildSpeaker() {
  let n = 16
  let geo = new THREE.BoxGeometry(L.speaker.w - 40, 7, 10)
  let inst = new THREE.InstancedMesh(geo, MAT.black, n)
  let m = new THREE.Matrix4()
  for (let i = 0; i < n; i++) {
    let [x, y] = toWorld(
      L.speaker.x + L.speaker.w / 2,
      L.speaker.y + 20 + i * 21,
    )
    m.makeTranslation(x, y, TRAY_Z + 5)
    inst.setMatrixAt(i, m)
  }
  inst.instanceMatrix.needsUpdate = true
  enclosure.add(inst)

  // the sliding cover, parked half open — halfway has to be a legal state,
  // because the cover's position IS the volume
  let coverH = L.speaker.h * 0.45
  roundedAt(
    {
      x: L.speaker.x + 4,
      y: L.speaker.y + L.speaker.h - coverH,
      w: L.speaker.w - 8,
      h: coverH,
    },
    TRAY_Z + 16,
    16,
    MAT.chassis,
    4,
  )
}

function buildButtons() {
  for (let r of buttonRects(L.toolButtons)) roundedAt(r, 7, 18, MAT.key)
  for (let r of buttonRects(L.stateButtons)) roundedAt(r, 7, 18, MAT.key)
  roundedAt(L.pause, 7, 18, MAT.key)
}

// The wireframe layer, kept as a toggle — shaded solids WITH edge lines is a
// real stylistic middle ground, not just a debug view. `L` walks that axis.
function buildEdgeLines() {
  rect(bright, { x: 0, y: 0, w: FACE.w, h: FACE.h }, 0)
  for (let s of SCREENS) rect(bright, s.rect, 0)
  for (let r of [L.keyboard, L.deck, L.speaker]) rect(dim, r, 0)
  for (let r of buttonRects(L.toolButtons)) rect(dim, r, 0)
  for (let r of buttonRects(L.stateButtons)) rect(dim, r, 0)
  rect(dim, L.pause, 0)

  let a = lines(bright, 0xffffff)
  let b = lines(dim, 0x707070)
  a.visible = linesOn
  b.visible = linesOn
  enclosure.add(a)
  enclosure.add(b)
}

// RectAreaLight cannot cast a shadow in three, so all contact darkening comes
// from the key light. Everything casts and receives: the keys need to shadow
// their own tray, and the chassis needs to shadow into its recesses.
function shadeAll() {
  enclosure.traverse((o) => {
    if (o.isMesh || o.isInstancedMesh) {
      o.castShadow = true
      o.receiveShadow = true
    }
  })
}

function buildEnclosure() {
  buildChassis()
  buildKeys()
  buildDeck()
  buildSpeaker()
  buildButtons()
  buildEdgeLines()
  buildGaugeTeeth()
  shadeAll()
  positionScreenLights()
  applyBezelGlow()
}

function lines(arr, color) {
  let g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3))
  let m = new THREE.LineBasicMaterial({ color, toneMapped: false })
  return new THREE.LineSegments(g, m)
}

function rebuildEnclosure() {
  // gaugeGroup too, or its teeth accumulate a new mesh on every rebuild
  // geometry only — the MAT.* materials are shared module-level singletons and
  // disposing them would break every rebuild after the first
  for (let group of [enclosure, gaugeGroup]) {
    for (let child of group.children) child.geometry.dispose()
    group.clear()
  }
  bright.length = 0
  dim.length = 0
  buildEnclosure()
  for (let s of screenObjs) s.obj.position.set(...centerOf(s.rect, SCREEN_Z))
  if (gaugeObj) gaugeObj.position.set(...centerOf(GAUGE, SCREEN_Z))
  positionScreenLights()
  if (mode === 'machine' && !flight) {
    orbit.on ? applyOrbit() : parkAtMachine()
  }
}

buildLights()
buildEnclosure()

// ---------------------------------------------------------------------------
// The shelf — a gray box off to the right, with a few cassettes on it.
// ---------------------------------------------------------------------------

let SHELF = new THREE.Vector3(2900, -60, -700)

function buildShelf() {
  let w = 900
  let h = 1100
  let d = 300
  let box = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshBasicMaterial({ color: 0x2a2a2a }),
  )
  box.position.copy(SHELF)
  scene.add(box)

  let edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)),
    new THREE.LineBasicMaterial({ color: 0xffffff }),
  )
  edges.position.copy(SHELF)
  scene.add(edges)

  // three shelves and a scatter of cassette spines
  for (let s = 0; s < 3; s++) {
    let y = SHELF.y + h / 2 - (s + 1) * (h / 4)
    let plank = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(w, 8, d)),
      new THREE.LineBasicMaterial({ color: 0xbbbbbb }),
    )
    plank.position.set(SHELF.x, y, SHELF.z)
    scene.add(plank)

    for (let i = 0; i < 9; i++) {
      let cassette = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(70, 160, 200)),
        new THREE.LineBasicMaterial({ color: 0x9a9a9a }),
      )
      cassette.position.set(SHELF.x - w / 2 + 70 + i * 86, y + 88, SHELF.z + 20)
      cassette.rotation.z = (i % 3 === 2 ? 1 : 0) * 0.14
      scene.add(cassette)
    }
  }
}

buildShelf()

// ---------------------------------------------------------------------------
// The three screens — real DOM, via CSS3DRenderer
// ---------------------------------------------------------------------------

let SAMPLE = `// bounce.js — a cassette

let SIZE = 64
let GRAVITY = 0.25
let DAMPING = 0.82

init(state => {
  state.x = 20
  state.y = 8
  state.vx = 1.4
  state.vy = 0
  state.hits = 0
  state.trail = []
})

update((state, input) => {
  state.vy += GRAVITY
  state.x += state.vx
  state.y += state.vy

  if (state.y > SIZE - 6) {
    state.y = SIZE - 6
    state.vy *= -DAMPING
    state.hits += 1
  }
  if (state.x < 2 || state.x > SIZE - 6) {
    state.vx *= -1
  }
  if (input.pressed) {
    state.vy = -6
  }

  state.trail.push([state.x, state.y])
  if (state.trail.length > 12) state.trail.shift()
})

draw((state) => {
  clear(3)
  rectFill(0, SIZE - 4, SIZE, 4, 2)
  for (let i = 0; i < state.trail.length; i++) {
    let [tx, ty] = state.trail[i]
    rectFill(tx, ty, 4, 4, i > 8 ? 1 : 2)
  }
  rectFill(state.x, state.y, 4, 4, 0)
  line(0, 6, SIZE, 6, 2)
})
`

let editorEl = document.createElement('textarea')
editorEl.id = 'editor'
editorEl.spellcheck = false
editorEl.value = SAMPLE
editorEl.style.width = L.editor.w + 'px'
editorEl.style.height = L.editor.h + 'px'

let gameEl = document.createElement('canvas')
gameEl.id = 'game'
gameEl.width = 64
gameEl.height = 64

let stateEl = document.createElement('pre')
stateEl.id = 'state'

let screenObjs = []

function place(el, r) {
  let o = new CSS3DObject(el)
  // CSS3DObject's constructor sets user-select:none on the element, which would
  // silently kill text selection in the editor — one of the things this spike
  // is explicitly meant to prove works. Put it back.
  el.style.userSelect = 'text'
  el.style.webkitUserSelect = 'text'
  o.position.set(...centerOf(r, SCREEN_Z))
  cssScene.add(o)
  screenObjs.push({ obj: o, rect: r })
  return o
}

let editorObj = place(editorEl, L.editor)
place(gameEl, L.game)
place(stateEl, L.state)

// keep the comparison textareas in sync with the real one
let plainEl = document.getElementById('plain-editor')
let sideEl = document.getElementById('side-editor')
plainEl.value = SAMPLE
sideEl.value = SAMPLE
editorEl.addEventListener('input', () => {
  plainEl.value = editorEl.value
  sideEl.value = editorEl.value
})

// ---------------------------------------------------------------------------
// Layer-skew gauge
//
// DOM and WebGL are two compositor layers. Nothing guarantees the browser lands
// a style write and a draw call on the same frame, so during a camera move the
// screens can skew relative to the chassis that houses them.
//
// This is a null test. A comb of teeth is drawn HALF in WebGL and HALF in DOM,
// interleaved, both exactly coplanar at z=0 so they project identically at any
// camera angle. Perfectly in sync they merge into one solid white bar. Any slip
// at all and the comb pattern appears — far easier to see than a tear, because
// you are looking for the arrival of structure in a flat field, not for a small
// displacement.
// ---------------------------------------------------------------------------

// Both halves live on the GLASS plane — the 1:1 plane — and the front panel
// gets a slot cut in it so the WebGL teeth have nothing to z-fight against.
//
// Putting the gauge anywhere else invalidates it. Off the 1:1 plane the DOM
// half is magnified, so the compositor resamples an already-rasterised bitmap
// and its tooth edges land off the device-pixel grid while the WebGL teeth land
// on it. That paints a gray seam at every boundary in PERFECT SYNC — the exact
// pattern the test is supposed to mean "skew". A 2px offset to dodge z-fighting
// is enough to do it.

// WebGL owns the even teeth. Rebuilt with the enclosure, since the plane it
// sits on moves with the recess.
//
// No polygonOffset and no PBR here: these must land exactly where the
// geometry says, and at the 1:1 plane with integer coordinates every tooth edge
// falls on a whole device pixel, so MSAA resolves to full coverage and leaves
// no gray fringe of its own.
function buildGaugeTeeth() {
  if (!gaugeOn) return
  let pos = []
  for (let x = GAUGE.x; x < GAUGE.x + GAUGE.w; x += TOOTH * 2) {
    let b = bounds({ x, y: GAUGE.y, w: TOOTH, h: GAUGE.h })
    quad(
      pos,
      [b.x0, b.y0, SCREEN_Z],
      [b.x1, b.y0, SCREEN_Z],
      [b.x1, b.y1, SCREEN_Z],
      [b.x0, b.y1, SCREEN_Z],
    )
  }
  let g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  gaugeGroup.add(
    new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        side: THREE.DoubleSide,
        // must stay pure white to match the DOM half; ACES would grey it
        toneMapped: false,
      }),
    ),
  )

  // dark backing, so the slot reads as a slot rather than a hole through
  let back = []
  let b = bounds(GAUGE)
  quad(
    back,
    [b.x0, b.y0, SCREEN_Z - 4],
    [b.x1, b.y0, SCREEN_Z - 4],
    [b.x1, b.y1, SCREEN_Z - 4],
    [b.x0, b.y1, SCREEN_Z - 4],
  )
  gaugeGroup.add(mesh(back, MAT.black))
}

// The DOM owns the odd teeth, and is transparent over the even ones so the
// WebGL teeth show through the gaps. Created once; only its plane moves.
function buildGaugeElement() {
  gaugeEl = document.createElement('div')
  gaugeEl.style.width = GAUGE.w + 'px'
  gaugeEl.style.height = GAUGE.h + 'px'
  gaugeEl.style.background =
    `repeating-linear-gradient(to right, transparent 0 ${TOOTH}px, ` +
    `#fff ${TOOTH}px ${TOOTH * 2}px)`
  gaugeObj = new CSS3DObject(gaugeEl)
  gaugeEl.style.pointerEvents = 'none'
  gaugeObj.position.set(...centerOf(GAUGE, SCREEN_Z))
  gaugeEl.style.display = 'none'
  cssScene.add(gaugeObj)
}

// The slot is cut by the panel build, so toggling means rebuilding — cheap
// enough (a handful of small geometries) and it keeps the chassis unmarked
// while the gauge is down.
//
// The gauge FORCES ZERO RECESS, and that isn't a convenience — with the glass
// behind the panel, the slot you look through and the teeth you look at are on
// different planes, so the slot's window onto the glass plane is the slot
// scaled by t about the camera axis. The gauge is a thin band far off that
// axis, so its window slides off the teeth completely and the panel hides the
// whole WebGL half. Overlap needs d·(t−1) < h; at 70px recess that's 34 < 24,
// false. Zero recess makes every plane the same plane. Nothing is lost:
// compositor skew doesn't depend on recess.
function setGauge(on) {
  if (on === gaugeOn) return
  gaugeOn = on
  gaugeEl.style.display = on ? 'block' : 'none'
  if (on) {
    recessBeforeGauge = SCREEN_Z
    SCREEN_Z = 0
  } else if (recessBeforeGauge !== null) {
    SCREEN_Z = recessBeforeGauge
    recessBeforeGauge = null
  }
  rebuildEnclosure()
}

// ---------------------------------------------------------------------------
// Occlusion, computed rather than composited
//
// WebGL geometry can never occlude a DOM element — that limitation is real and
// unfixable. But the only thing that ever passes in front of a screen in this
// design is its OWN recess well, and that case is exactly solvable:
//
// The aperture (z=0) and the glass (z=SCREEN_Z) are parallel planes, so the
// aperture's shadow on the glass is a uniform scale about the eye's axis point
// — still an axis-aligned rectangle, at any camera angle. It depends only on
// camera POSITION; rotation doesn't enter into it. So the visible part of the
// glass is a rect intersection, which `clip-path: inset()` reproduces exactly,
// in the element's own untransformed coordinates.
//
// At rest the shadow fully covers the glass, so the clip is dropped entirely
// and the element is byte-for-byte what it was before. This costs nothing where
// it matters and is exact where it doesn't.
//
// What it does NOT solve: some OTHER object passing in front of a screen. This
// design says that never happens.
// ---------------------------------------------------------------------------

let clipOn = true

function applyOcclusionClip() {
  let e = camera.position
  for (let s of screenObjs) {
    let el = s.obj.element
    let clip = ''

    // e.z <= 0 means the camera is behind the front panel; the shadow model
    // doesn't apply and there's nothing sensible to show
    if (clipOn && SCREEN_Z < 0 && e.z > 0) {
      let b = bounds(s.rect)
      let t = (e.z - SCREEN_Z) / e.z
      let sx0 = e.x + t * (b.x0 - e.x)
      let sx1 = e.x + t * (b.x1 - e.x)
      let sy0 = e.y + t * (b.y0 - e.y)
      let sy1 = e.y + t * (b.y1 - e.y)

      let vx0 = Math.max(b.x0, sx0)
      let vx1 = Math.min(b.x1, sx1)
      let vy0 = Math.max(b.y0, sy0)
      let vy1 = Math.min(b.y1, sy1)

      if (vx1 <= vx0 || vy1 <= vy0) {
        clip = 'inset(50%)'
      } else {
        let top = b.y1 - vy1
        let right = b.x1 - vx1
        let bottom = vy0 - b.y0
        let left = vx0 - b.x0
        // sub-pixel insets are just the perspective being honest; rounding them
        // away is what keeps the at-rest case a true no-op
        if (top > 0.5 || right > 0.5 || bottom > 0.5 || left > 0.5) {
          clip = `inset(${top.toFixed(2)}px ${right.toFixed(2)}px ${bottom.toFixed(2)}px ${left.toFixed(2)}px)`
        }
      }
    }

    // only touch the style when it actually changes
    if (el.dataset.clip !== clip) {
      el.style.clipPath = clip
      el.dataset.clip = clip
    }
  }
}

// ---------------------------------------------------------------------------
// Game screen — something that moves. Not the real worker; just enough motion
// to judge whether the game reads as the scene's attention anchor.
// ---------------------------------------------------------------------------

let PALETTE = ['#f0f0f0', '#a8a8a8', '#4a4a4a', '#0d0d0d'].map((h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
])

let gctx = gameEl.getContext('2d')
let bitmap = new Uint8Array(64 * 64)
let img = gctx.createImageData(64, 64)
let ball = { x: 20, y: 8, vx: 1.1, vy: 0, hits: 0 }
let trail = []

function px(x, y, c) {
  x = x | 0
  y = y | 0
  if (x < 0 || y < 0 || x > 63 || y > 63) return
  bitmap[y * 64 + x] = c
}

function fill(x, y, w, h, c) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) px(x + i, y + j, c)
}

function stepGame() {
  ball.vy += 0.25
  ball.x += ball.vx
  ball.y += ball.vy
  if (ball.y > 58) {
    ball.y = 58
    ball.vy *= -0.82
    ball.hits += 1
    if (Math.abs(ball.vy) < 1.5) ball.vy = -6.5
  }
  if (ball.x < 2 || ball.x > 58) ball.vx *= -1
  trail.push([ball.x, ball.y])
  if (trail.length > 12) trail.shift()

  bitmap.fill(3)
  fill(0, 60, 64, 4, 2)
  for (let i = 0; i < trail.length; i++) {
    fill(trail[i][0], trail[i][1], 4, 4, i > 8 ? 1 : 2)
  }
  fill(ball.x, ball.y, 4, 4, 0)
  for (let x = 0; x < 64; x++) px(x, 6, 2)

  // Average the tube while we're already walking every pixel — free. This is
  // the one direction the CSS3D constraint allows light to travel: the screen
  // can't be lit by the room, but the room CAN be lit by the screen.
  let sr = 0
  let sg = 0
  let sb = 0
  for (let i = 0; i < bitmap.length; i++) {
    let [r, g, b] = PALETTE[bitmap[i] & 3]
    img.data[i * 4] = r
    img.data[i * 4 + 1] = g
    img.data[i * 4 + 2] = b
    img.data[i * 4 + 3] = 255
    sr += r
    sg += g
    sb += b
  }
  let n = bitmap.length * 255
  gameAvg[0] = sr / n
  gameAvg[1] = sg / n
  gameAvg[2] = sb / n
  gctx.putImageData(img, 0, 0)
}

// ---------------------------------------------------------------------------
// Bezel glow — the housing responding to the screen
// ---------------------------------------------------------------------------

function applyBezelGlow() {
  for (let { light, screen } of screenLights) {
    if (screen.name !== 'game') {
      light.intensity = screen.lightIntensity
      continue
    }
    // The tube drives its own light. Physically this is the honest version of
    // the old additive-ring hack, and unlike that hack it now has a chamfer and
    // a well to fall on. Luminance sets intensity so a dark frame dims the
    // bezel rather than just tinting it.
    let lum = 0.2126 * gameAvg[0] + 0.7152 * gameAvg[1] + 0.0722 * gameAvg[2]
    if (glowOn) {
      light.color.setRGB(
        Math.max(gameAvg[0], 0.05),
        Math.max(gameAvg[1], 0.05),
        Math.max(gameAvg[2], 0.05),
        THREE.SRGBColorSpace,
      )
      light.intensity = screen.lightIntensity * (0.35 + lum * 2.2)
    } else {
      light.color.setHex(screen.lightColor)
      light.intensity = screen.lightIntensity
    }
  }
}

// State screen refreshes at ~4.5Hz, not 30Hz. A value changing 30x/sec is
// unreadable and steals the game's claim to being the only thing that moves.
let lastState = 0
function stepState(now) {
  if (now - lastState < 220) return
  lastState = now
  stateEl.textContent =
    'x     ' +
    ball.x.toFixed(1).padStart(6) +
    '\ny     ' +
    ball.y.toFixed(1).padStart(6) +
    '\nvy    ' +
    ball.vy.toFixed(2).padStart(6) +
    '\nhits  ' +
    String(ball.hits).padStart(6) +
    '\ntrail ' +
    String(trail.length).padStart(6)
}

// ---------------------------------------------------------------------------
// Camera
//
// The camera changes where you ARE; the machine changes what it's DOING. There
// are exactly two places: at the machine, and at the shelf.
// ---------------------------------------------------------------------------

let mode = 'machine'
let flight = null
let flightMs = 900
let orbit = { yaw: 0, pitch: 0, on: false }

// At the machine the camera must land dead-on, unrotated, at scale 1.0 —
// snapped, not eased into, so nothing lands on a fractional pixel.
function parkAtMachine() {
  camera.position.set(0, 0, machineZ())
  camera.quaternion.identity()
  camera.updateMatrixWorld(true)
  orbit.yaw = 0
  orbit.pitch = 0
  orbit.on = false
}

function shelfCamera() {
  // stand off the shelf far enough to see the whole rack
  return new THREE.Vector3(SHELF.x - 120, SHELF.y + 120, SHELF.z + 1250)
}

function flyTo(target) {
  if (target === mode && !orbit.on && !flight) return
  let from = camera.position.clone()
  let to =
    target === 'machine' ? new THREE.Vector3(0, 0, machineZ()) : shelfCamera()
  let lookFrom = mode === 'machine' ? new THREE.Vector3(0, 0, 0) : SHELF.clone()
  let lookTo = target === 'machine' ? new THREE.Vector3(0, 0, 0) : SHELF.clone()

  // arc backwards on the way over rather than sliding sideways — the whole
  // question is whether this reads as moving through a room or as a diagram
  // rotating.
  let mid = from
    .clone()
    .lerp(to, 0.5)
    .add(new THREE.Vector3(0, 180, 900))

  flight = { from, to, mid, lookFrom, lookTo, start: performance.now() }
  mode = target
  minFps = Infinity
}

function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

function stepCamera(now) {
  if (!flight) return
  let t = Math.min(1, (now - flight.start) / flightMs)
  let e = easeInOut(t)

  // quadratic bezier through the pulled-back control point
  let a = flight.from.clone().lerp(flight.mid, e)
  let b = flight.mid.clone().lerp(flight.to, e)
  camera.position.copy(a.lerp(b, e))
  camera.lookAt(flight.lookFrom.clone().lerp(flight.lookTo, e))

  if (t >= 1) {
    flight = null
    if (mode === 'machine') parkAtMachine()
  }
}

// Orbit is a DIAGNOSTIC, not a product feature. It exists to push the angle far
// enough to answer question 4: at what rotation does the chassis visibly fail
// to occlude the screens, and does that ever happen in normal use?
let dragging = false
let last = { x: 0, y: 0 }
let downAt = { x: 0, y: 0 }

webgl.domElement.addEventListener('pointerdown', (e) => {
  last = { x: e.clientX, y: e.clientY }
  downAt = { x: e.clientX, y: e.clientY }
  if (mode !== 'machine' || flight) return
  dragging = true
  webgl.domElement.setPointerCapture(e.pointerId)
})
webgl.domElement.addEventListener('pointermove', (e) => {
  if (!dragging || flight) return
  orbit.on = true
  orbit.yaw += (e.clientX - last.x) * 0.004
  orbit.pitch += (e.clientY - last.y) * 0.004
  orbit.pitch = Math.max(-1.2, Math.min(1.2, orbit.pitch))
  last = { x: e.clientX, y: e.clientY }
  applyOrbit()
})
webgl.domElement.addEventListener('pointerup', () => {
  dragging = false
})

function applyOrbit() {
  let r = machineZ()
  camera.position.set(
    Math.sin(orbit.yaw) * Math.cos(orbit.pitch) * r,
    Math.sin(orbit.pitch) * r,
    Math.cos(orbit.yaw) * Math.cos(orbit.pitch) * r,
  )
  camera.lookAt(0, 0, 0)
  mode = 'machine'
}

// click the shelf to go there, click the machine to come back
let raycaster = new THREE.Raycaster()
webgl.domElement.addEventListener('click', (e) => {
  // ignore the click that ends an orbit drag
  if (
    Math.abs(e.clientX - downAt.x) > 3 ||
    Math.abs(e.clientY - downAt.y) > 3
  ) {
    return
  }
  raycaster.setFromCamera(
    new THREE.Vector2((e.clientX / vw) * 2 - 1, -(e.clientY / vh) * 2 + 1),
    camera,
  )
  let hit = raycaster.intersectObjects(scene.children, false)[0]
  let onShelf = hit && hit.point.x > FACE.w / 2 + 200
  flyTo(onShelf ? 'shelf' : 'machine')
})

// ---------------------------------------------------------------------------
// Comparison + fallback toggles
// ---------------------------------------------------------------------------

let compare = { overlay: false, side: false }
let compareDirty = true
let freezeFallback = false

// Position a plain (non-3D) textarea over exactly the screen rect the CSS3D
// editor occupies at rest, so toggling flickers between the two. A flicker test
// is far more sensitive than looking at them side by side.
function syncCompare() {
  let r = editorEl.getBoundingClientRect()
  plainEl.style.display = compare.overlay ? 'block' : 'none'
  plainEl.style.left = Math.round(r.left) + 'px'
  plainEl.style.top = Math.round(r.top) + 'px'
  plainEl.style.width = L.editor.w + 'px'
  plainEl.style.height = L.editor.h + 'px'

  // side-by-side: park the control over the game screen, immediately beside the
  // editor, at identical font settings
  let g = gameEl.getBoundingClientRect()
  sideEl.style.display = compare.side ? 'block' : 'none'
  sideEl.style.left = Math.round(g.left) + 'px'
  sideEl.style.top = Math.round(g.top) + 'px'
  sideEl.style.width = L.game.w + 'px'
  sideEl.style.height = L.game.h + 'px'
  sideEl.style.fontSize = editorEl.style.fontSize || ''
  sideEl.style.lineHeight = editorEl.style.lineHeight || ''
}

// Simulates the fallback architecture: live DOM at rest, nothing during the
// flight. (The real fallback would freeze to a texture and render the screens
// in WebGL; hiding them is enough to feel the cost difference and to see
// whether the occlusion break disappears.)
function cssVisible() {
  if (!freezeFallback) return true
  return !flight && mode === 'machine' && !orbit.on
}

// Editor font presets — the open "chunky ~80 columns vs. more visible lines"
// trade, made switchable instead of argued about.
let FONTS = [
  { name: 'dense', size: 13, line: 15 },
  { name: 'chunky', size: 17, line: 20 },
]
let fontIdx = 0

function applyFont() {
  let f = FONTS[fontIdx]
  for (let el of [editorEl, plainEl, sideEl]) {
    el.style.fontSize = f.size + 'px'
    el.style.lineHeight = f.line + 'px'
  }
  editorMetrics()
}

let measureCtx = document.createElement('canvas').getContext('2d')
let metrics = null

function editorMetrics() {
  let f = FONTS[fontIdx]
  measureCtx.font = `${f.size}px ui-monospace, SFMono-Regular, Menlo, monospace`
  let adv = measureCtx.measureText('0000000000').width / 10
  metrics = {
    name: f.name,
    cols: Math.floor((L.editor.w - 18) / adv),
    lines: Math.floor((L.editor.h - 16) / f.line),
  }
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------

let hud = document.getElementById('hud')
let elRest = document.getElementById('rest')
let elMetrics = document.getElementById('metrics')
let elPerf = document.getElementById('perf')
let elModes = document.getElementById('modes')

let fps = 0
let minFps = Infinity
let frames = 0
let fpsMark = performance.now()

// Question 1, made objective. If the editor's projected box is exactly its
// natural size and lands on integer pixels, the transform is an identity and
// any softness you see is the browser's layer rasterisation (grayscale vs
// subpixel antialiasing), not geometry.
function restReadout() {
  let r = editorEl.getBoundingClientRect()
  let exactSize =
    Math.abs(r.width - L.editor.w) < 0.01 &&
    Math.abs(r.height - L.editor.h) < 0.01
  let onGrid =
    Math.abs(r.left - Math.round(r.left)) < 0.01 &&
    Math.abs(r.top - Math.round(r.top)) < 0.01
  let ok = exactSize && onGrid
  return (
    `<b>editor rect</b> ${r.width.toFixed(3)}×${r.height.toFixed(3)} @ ` +
    `${r.left.toFixed(3)}, ${r.top.toFixed(3)} ` +
    (ok
      ? '<span class="ok">PIXEL-EXACT</span>'
      : '<span class="bad">NOT EXACT</span>')
  )
}

// Everything below reads layout (getBoundingClientRect), which forces a reflow.
// Doing that every frame would show up in the very fps number the HUD reports,
// so it runs at 4Hz — same reasoning as the state screen.
function updateHud(now) {
  frames++
  if (now - fpsMark < 250) return
  fps = Math.round((frames * 1000) / (now - fpsMark))
  frames = 0
  fpsMark = now
  if (flight) minFps = Math.min(minFps, fps)
  if (hud.classList.contains('min')) return

  let m = metrics
  elRest.innerHTML = restReadout()
  elMetrics.innerHTML =
    `<b>font</b> ${m.name} — ${m.cols} cols × ${m.lines} lines · ` +
    `<b>viewport</b> ${vw}×${vh} · <b>enclosure</b> ${FACE.w}×${FACE.h} ` +
    (vw < FACE.w || vh < FACE.h
      ? `<span class="bad">(clipped ${Math.max(0, FACE.w - vw)}×${Math.max(
          0,
          FACE.h - vh,
        )})</span>`
      : '<span class="ok">(fits)</span>')
  elPerf.innerHTML =
    `<b>fps</b> ${fps} · <b>min fps in last flight</b> ` +
    (minFps === Infinity ? '—' : minFps) +
    ` · <b>flight</b> ${flightMs}ms · <b>recess</b> ${-SCREEN_Z}px · ` +
    `<b>dpr</b> ${window.devicePixelRatio}`
  elModes.innerHTML =
    `<b>where</b> ${mode}${flight ? ' (flying)' : ''}${
      orbit.on ? ' + orbit' : ''
    } · <b>overlay</b> ${compare.overlay ? 'on' : 'off'} · <b>side</b> ${
      compare.side ? 'on' : 'off'
    } · <b>occlusion clip</b> ${
      clipOn ? '<span class="ok">on</span>' : '<span class="bad">off</span>'
    } · <b>freeze fallback</b> ${freezeFallback ? 'on' : 'off'}<br />` +
    `<b>bezel glow</b> ${glowOn ? 'on' : 'off'} · <b>skew gauge</b> ${
      gaugeOn ? 'on (recess pinned to 0)' : 'off'
    } · <b>edge lines</b> ${linesOn ? 'on' : 'off'} · <b>tube avg</b> ${gameAvg
      .map((v) => v.toFixed(2))
      .join(' ')}`
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function typing() {
  return document.activeElement && document.activeElement.tagName === 'TEXTAREA'
}

let actions = {
  machine: () => flyTo('machine'),
  shelf: () => flyTo('shelf'),
  overlay: () => {
    compare.overlay = !compare.overlay
    compareDirty = true
  },
  side: () => {
    compare.side = !compare.side
    compareDirty = true
  },
  freeze: () => {
    freezeFallback = !freezeFallback
  },
  font: () => {
    fontIdx = (fontIdx + 1) % FONTS.length
    applyFont()
  },
  deeper: () => setRecess(SCREEN_Z - 10),
  shallower: () => setRecess(SCREEN_Z + 10),
  clip: () => {
    clipOn = !clipOn
  },
  glow: () => {
    glowOn = !glowOn
    applyBezelGlow()
  },
  gauge: () => setGauge(!gaugeOn),
  lines: () => {
    linesOn = !linesOn
    rebuildEnclosure()
  },
}

function setRecess(z) {
  // the gauge pins the recess at 0, so asking for a recess drops the gauge
  // rather than silently doing nothing
  if (gaugeOn) {
    setGauge(false)
    return
  }
  SCREEN_Z = Math.max(-260, Math.min(0, z))
  rebuildEnclosure()
}

hud.addEventListener('click', (e) => {
  let act = e.target.dataset && e.target.dataset.act
  if (act) actions[act]()
})

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && typing()) {
    document.activeElement.blur()
    return
  }
  if (typing() || e.metaKey || e.ctrlKey) return
  let k = e.key.toLowerCase()
  if (k === 'm') actions.machine()
  else if (k === 's') actions.shelf()
  else if (k === 'c') actions.overlay()
  else if (k === 'v') actions.side()
  else if (k === 'f') actions.freeze()
  else if (k === 't') actions.font()
  else if (k === 'h') hud.classList.toggle('min')
  else if (k === '[') flightMs = Math.max(150, flightMs - 150)
  else if (k === ']') flightMs = Math.min(3000, flightMs + 150)
  else if (k === ',') actions.shallower()
  else if (k === '.') actions.deeper()
  else if (k === 'o') actions.clip()
  else if (k === 'b') actions.glow()
  else if (k === 'g') actions.gauge()
  else if (k === 'l') actions.lines()
})

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------

function frame(now) {
  requestAnimationFrame(frame)
  stepGame()
  stepState(now)
  stepCamera(now)

  applyBezelGlow()
  webgl.render(scene, camera)
  applyOcclusionClip()
  let show = cssVisible()
  css3d.domElement.style.visibility = show ? 'visible' : 'hidden'
  if (show) css3d.render(cssScene, camera)

  if (compare.overlay || compare.side || compareDirty) {
    syncCompare()
    compareDirty = false
  }
  updateHud(now)
}

window.addEventListener('resize', resize)
buildGaugeElement()
applyFont()
resize()
parkAtMachine()
requestAnimationFrame(frame)
