self.onmessage = (e: MessageEvent) => {
  let msg = e.data
  if (msg.type === 'tick') {
    let bitmap = new Uint8Array(64 * 64).fill(3)

    // draw a white border
    for (let x = 0; x < 64; x++) {
      bitmap[0 * 64 + x] = 0 // top
      bitmap[63 * 64 + x] = 0 // bottom
    }
    for (let y = 0; y < 64; y++) {
      bitmap[y * 64 + 0] = 0 // left
      bitmap[y * 64 + 63] = 0 // right
    }

    // draw a cross in the center
    for (let x = 0; x < 64; x++) bitmap[32 * 64 + x] = 1
    for (let y = 0; y < 64; y++) bitmap[y * 64 + 32] = 1

    self.postMessage({ type: 'bitmap', buffer: bitmap })
  }
}
