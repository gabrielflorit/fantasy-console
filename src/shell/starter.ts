export const starterCassette = `
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
  for (let x = 0; x < 64; x++) setPixel(x, 32, 0)
  setPixel(state.x % 64, state.y, 1)
})
`
