# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A minimal JavaScript fantasy console running in the browser. 64×64 pixels, 4 colors (indexed 0–3, 0 = brightest, 3 = darkest), one button. Games ("cassettes") are written in JavaScript against a small constrained drawing API. The project is currently in **Phase 2** — the worker factory refactor (Phase 1.5) is complete; now adding the full cassette drawing API.

See `PLAN.md` for design decisions, the full cassette API spec, and the granular task list with phase checkboxes. See `FACTORY-PLAN.md` for the in-flight worker-module refactor (graphics / sandbox / cassette / index split).

## Dev commands

```bash
npm run dev      # tsc watch mode for both shell and worker tsconfigs (run in Terminal 1)
node dev-server.js  # static file server at localhost:3000 with auto-reload (Terminal 2)
npm run build    # compile both tsconfigs + copy index.html to dist/
wrangler deploy  # deploy Cloudflare Worker (global install, run from Lima VM only)
```

No `npm install` needed — zero runtime npm dependencies. Global tools: `tsc`, `prettier`, `wrangler`.

## Architecture

### Shell ↔ Worker protocol

The shell (`src/shell/index.ts`) owns the game loop. Every 33ms it sends a `TickMessage` to a Web Worker (`src/worker/index.ts`). The worker runs cassette code, populates a `Uint8Array` bitmap (64×64 = 4096 bytes, 1 byte per pixel = color index), and posts it back as a `BitmapMessage`. The shell renders it to canvas via `putImageData`. Message types are defined in `src/shared/types.ts`.

If the worker doesn't respond within 500ms, the shell's watchdog terminates and respawns it.

### Worker sandbox

User cassette code is `eval`'d inside the worker via `new Function(...)` with only the cassette API functions injected into scope. No DOM access, no network (blocked by CSP `connect-src 'none'`), no access to shell state.

### Cassette lifecycle

The worker expects cassette code to call three registration functions:
- `init(fn)` — called once on load/reset; mutate `state`
- `update(fn)` — called each tick before draw; receives `(state, input)` 
- `draw(fn)` — called each tick after update; receives `(state)`

### TypeScript config

Three tsconfigs with a split-lib strategy — shell code needs DOM types, worker code needs WebWorker types:
- `tsconfig.json` — root; shared `target`, `module`, `strict`, `sourceMap`
- `tsconfig.shell.json` — extends root; `lib: [ES2022, DOM]`
- `tsconfig.worker.json` — extends root; `lib: [ES2022, WebWorker]`

Both compile to `dist/`, preserving `src/` directory structure. The `src/shared/` module is compiled twice (once per tsconfig). The `dist/` directory is not committed.

## Code style

Prettier config: no semicolons, single quotes, 80 char print width, 2-space indent. Format on save expected.

## Commits

Never add a Claude/Claude Code mention, attribution, or `Co-Authored-By` trailer to commit messages.

## Deployment

Shell + worker → Cloudflare Pages (auto-deploys on push to `main`).  
Server → Cloudflare Worker (`wrangler deploy` from Lima VM).

The dev environment runs inside a Lima VM on Mac. `localhost:3000` is accessed from the Mac browser.
