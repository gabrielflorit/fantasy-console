// Owns the bitmap and the drawing primitives injected into cassette code.
// `pixels` is a live read handle — the caller decides transport (slice,
// transfer, hash, …). A getter rather than a pre-sliced copy keeps that choice
// with the caller: adopting transferables later needs no change here.
//
// The primitives are injected into cassette scope as standalone locals, so
// they must not rely on `this` — cross-calls go through the closure helper
// `set` below, never `this.setPixel`. `set` is the only place bounds-checking
// and the (x,y)→index math live; every primitive funnels through it and works
// in already-rounded integer coordinates.

export function createGraphics(width: number, height: number) {
  let bitmap = new Uint8Array(width * height)

  function set(x: number, y: number, color: number) {
    if (x >= 0 && x < width && y >= 0 && y < height) {
      bitmap[y * width + x] = color
    }
  }

  function clear(color = 3) {
    bitmap.fill(color)
  }

  // Public point ops round to the pixel grid so float coords behave.
  function setPixel(x: number, y: number, color = 0) {
    set(Math.round(x), Math.round(y), color)
  }

  // Bresenham's line algorithm — integer-only, no per-pixel float error.
  function line(x1: number, y1: number, x2: number, y2: number, color = 0) {
    x1 = Math.round(x1)
    y1 = Math.round(y1)
    x2 = Math.round(x2)
    y2 = Math.round(y2)
    let dx = Math.abs(x2 - x1)
    let dy = -Math.abs(y2 - y1)
    let sx = x1 < x2 ? 1 : -1
    let sy = y1 < y2 ? 1 : -1
    let err = dx + dy
    while (true) {
      set(x1, y1, color)
      if (x1 === x2 && y1 === y2) break
      let e2 = 2 * err
      if (e2 >= dy) {
        err += dy
        x1 += sx
      }
      if (e2 <= dx) {
        err += dx
        y1 += sy
      }
    }
  }

  // (x,y) is the top-left corner; w/h are inclusive extents in pixels.
  function rectStroke(x: number, y: number, w: number, h: number, color = 0) {
    x = Math.round(x)
    y = Math.round(y)
    w = Math.round(w)
    h = Math.round(h)
    if (w <= 0 || h <= 0) return
    let x2 = x + w - 1
    let y2 = y + h - 1
    line(x, y, x2, y, color)
    line(x, y2, x2, y2, color)
    line(x, y, x, y2, color)
    line(x2, y, x2, y2, color)
  }

  function rectFill(x: number, y: number, w: number, h: number, color = 0) {
    x = Math.round(x)
    y = Math.round(y)
    w = Math.round(w)
    h = Math.round(h)
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        set(xx, yy, color)
      }
    }
  }

  let api = { clear, setPixel, line, rectStroke, rectFill }

  return { api, pixels: () => bitmap }
}
