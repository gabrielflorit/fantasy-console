// Owns the bitmap and the drawing primitives injected into cassette code.
// `pixels` is a live read handle — the caller decides transport (slice,
// transfer, hash, …). See FACTORY-PLAN.md for why a getter over a sealed copy.

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
