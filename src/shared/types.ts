// Console dimensions — single source of truth, shared by shell and worker.
export const WIDTH = 64
export const HEIGHT = 64

// Input snapshot, bundled into each tick.
export interface Input {
  a: boolean
}

// Shell → Worker
export interface TickMessage {
  type: 'tick'
  input: Input
}

export interface CodeMessage {
  type: 'code'
  source: string
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
export type ShellToWorker = TickMessage | CodeMessage
export type WorkerToShell = BitmapMessage | CrashMessage | StateMessage
