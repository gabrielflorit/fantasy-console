// Shell → Worker
export interface CodeMessage {
  type: 'code'
  source: string
}

export interface InputMessage {
  type: 'input'
  a: boolean
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
export type ShellToWorker = CodeMessage | InputMessage
export type WorkerToShell = BitmapMessage | CrashMessage | StateMessage