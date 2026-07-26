// Redux-lite store: getState / dispatch / subscribe. Holds only the shell's
// shared, serializable UI state. The worker, game loop, input, and monitor
// canvas stay imperative and live OUTSIDE the store (see index.ts).
//
// A reducer that returns the *same* state reference is treated as a no-op:
// listeners don't fire. This is what makes clicking an already-thrown radio
// switch cost nothing.
export type Listener = () => void

export interface Store<S, A> {
  getState(): S
  dispatch(action: A): void
  subscribe(listener: Listener): () => void
}

export function createStore<S, A>(
  reducer: (state: S, action: A) => S,
  initial: S,
): Store<S, A> {
  let state = initial
  let listeners = new Set<Listener>()
  return {
    getState: () => state,
    dispatch(action) {
      let next = reducer(state, action)
      if (next === state) return
      state = next
      listeners.forEach((l) => l())
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
