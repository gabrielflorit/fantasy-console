# CLAUDE.md

Operating manual for Claude Code in this repo — conventions, commands, and
gotchas. The design source of truth is `PLAN.md`; human/machine setup is in
`README.md`. This file points to those rather than restating them.

## What this is

A minimal JavaScript fantasy console in the browser: 64×64 pixels, 4 colors
(indexed 0–3, 0 = brightest, 3 = darkest), one button. Games ("cassettes") are
JavaScript written against a small drawing API. Current work: the drawing API
(Phase 2) — see `PLAN.md` §11 for live task status.

## Dev commands

```bash
npm run dev         # tsc watch for both shell + worker tsconfigs (Terminal 1)
node dev-server.js  # static file server at localhost:3000, auto-reload (Terminal 2)
npm run build       # compile both tsconfigs + copy index.html to dist/
wrangler deploy     # deploy the Cloudflare Worker (from the Lima VM only)
```

No `npm install` — zero runtime dependencies. Global tools: `tsc`, `prettier`,
`wrangler`. Dev runs in a Lima VM on a Mac; `localhost:3000` is opened from the
Mac browser. Full setup: `README.md`.

## Architecture (orientation — full detail in `PLAN.md` §2–§3)

The **shell** (`src/shell/`) runs in the browser and owns the game loop; it
never runs cassette code. The **worker** (`src/worker/`) runs untrusted cassette
code in a Web Worker, draws into a `Uint8Array` bitmap, and posts it back for
the shell to render. They communicate only via `postMessage`; message types
live in `src/shared/types.ts`.

Worker modules: `graphics` (bitmap + drawing primitives), `sandbox` (evaluates
cassette code with the API injected), `tapeDeck` (lifecycle + hot reload),
`index` (message dispatch). Cassettes register three functions — `init(state)`,
`update(state, input)`, `draw(state)`.

## TypeScript config

Three tsconfigs, split by lib (shell needs DOM, worker needs WebWorker):
`tsconfig.json` (root — target/module/strict), `tsconfig.shell.json`
(`lib: [ES2022, DOM]`), `tsconfig.worker.json` (`lib: [ES2022, WebWorker]`).
Both emit to `dist/` (not committed); `src/shared/` compiles under both.

## Code style

Prettier: no semicolons, single quotes, 80-char width, 2-space indent. Format
on save.

## Commits

Never add a Claude/Claude Code mention, attribution, or `Co-Authored-By` trailer.

## Deployment

Shell + worker → Cloudflare Pages (auto-deploys on push to `main`). Server →
Cloudflare Worker via `wrangler deploy` from the Lima VM.
