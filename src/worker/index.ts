self.onmessage = (e: MessageEvent) => {
  let msg = e.data

  if (msg.type === 'tick') {
    let bitmap = new Uint8Array(64 * 64).fill(1)
    self.postMessage({ type: 'bitmap', buffer: bitmap })
  }
}
