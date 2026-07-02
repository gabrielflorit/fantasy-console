// Console dimensions — single source of truth, shared by shell and worker.
export const WIDTH = 64
export const HEIGHT = 64

// Input snapshot, bundled into each tick.
export interface Input {
  a: boolean
}

// A cassette: the game bundle. For now just code; later this grows room
// for palette, music, sfx, title, cover art, ….
export interface Cassette {
  code: string
}

// Shell → Worker
export interface TickMessage {
  type: 'tick'
  input: Input
}

export interface LoadMessage {
  type: 'load'
  cassette: Cassette
}

// Worker → Shell
export interface BitmapMessage {
  type: 'bitmap'
  buffer: Uint8Array
}

export interface CrashMessage {
  type: 'crash'
  message: string
  stack: string
}

export interface StateMessage {
  type: 'state'
  data: Record<string, unknown>
}

// Unions
export type ShellToWorker = TickMessage | LoadMessage
export type WorkerToShell = BitmapMessage | CrashMessage | StateMessage
