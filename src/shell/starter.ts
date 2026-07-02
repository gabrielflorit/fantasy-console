import type { Cassette } from '../shared/types.js'

export const starterCassette: Cassette = {
  code: `
init(state => {
  state.x = 0
  state.y = 0
})

update((state, input) => {
  state.x++
  if (input.a) {
    state.y = (state.y + 1) % 64
  }
})

draw(state => {
  clear(3)
  for (let x = 0; x < 64; x++) {
    setPixel(x, 16, 0)
    setPixel(x, 48, 0)
  }
  setPixel(state.x % 64, state.y, 1)
})
`,
}
