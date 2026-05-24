let worker = new Worker('./worker/index.js', { type: 'module' })
let canvas = document.getElementById('canvas') as HTMLCanvasElement
let ctx = canvas.getContext('2d')!

let palette = ['#f0f0f0', '#a8a8a8', '#4a4a4a', '#0d0d0d']

function hexToRgb(hex: string): [number, number, number] {
  let r = parseInt(hex.slice(1, 3), 16)
  let g = parseInt(hex.slice(3, 5), 16)
  let b = parseInt(hex.slice(5, 7), 16)
  return [r, g, b]
}

worker.onmessage = (e: MessageEvent) => {
  let { buffer } = e.data
  let imageData = ctx.createImageData(64, 64)
  for (let i = 0; i < buffer.length; i++) {
    let [r, g, b] = hexToRgb(palette[buffer[i]])
    imageData.data[i * 4] = r
    imageData.data[i * 4 + 1] = g
    imageData.data[i * 4 + 2] = b
    imageData.data[i * 4 + 3] = 255
  }
  ctx.putImageData(imageData, 0, 0)
}

worker.postMessage({ type: 'ping' })
