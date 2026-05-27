export const starterCassette = `
init(state => {
  state.t = 0
})

update((state, input) => {
  state.t++
})

draw(state => {
  clear(3)
  for (let x = 0; x < 64; x++) setPixel(x, 32, 0)
  setPixel(state.t % 64, 16, 1)
})
`
