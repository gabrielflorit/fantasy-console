# Context

Read @src/shell/index.ts and @src/worker/index.ts. Then read @src/shared/types.ts, which contains types for communication between shell and worker.

# Goal

Suggest three different designs for a shell/worker communication system to support the following:

- shell:
  - on first load, loads a starter cassette
  - sends cassette code to worker (CodeMessage)
- worker:
  - evals code
  - if init has changed, runs init
  - runs update
  - runs draw
  - sends draw output bitmap to shell (BitmapMessage)
  - on error, sends CrashMessage
- shell:
  - on BitmapMessage, draws result, and requests a new frame (TickMessage)
  - on CrashMessage, print error to console, do not request new frame
  - when user modifies code, send CodeMessage

The shell should draw output at a constant 30fps.
