# Fantasy Console

A minimal JavaScript fantasy console. 64×64, 4 colors, one button.

See `PLAN.md` for all design decisions and the task list.

---

## Machine setup (do once)

This project runs inside a Lima VM to isolate npm and dev tooling from the host Mac.

### 1. Lima

Install Lima on the Mac:

```bash
brew install lima
limactl start
```

Edit `~/.lima/default/lima.yaml`. Find the mounts section and set it to:

```yaml
mounts: []
```

Restart the VM:

```bash
limactl stop default
limactl start default
```

### 2. SSH config

Get the SSH connection details:

```bash
limactl show-ssh --format config default
```

Paste the output into `~/.ssh/config` on the Mac.

### 3. VS Code extensions

Install these two extensions:

- **Remote - SSH** (Microsoft)
- **Prettier - Code formatter** (Prettier)

Connect to the VM:

- `Cmd+Shift+P` → `Remote-SSH: Connect to Host` → `lima-default`
- Open `/home/gabrielflorit.guest/fantasy-console`

### 4. VS Code settings

- Default formatter: Prettier
- Format on save: enabled

### 5. Global tools (inside the VM)

```bash
npm install -g typescript
npm install -g prettier
```

---

## Dev setup (do every session)

Open two terminals inside the VM (VS Code integrated terminal works).

**Terminal 1 — TypeScript compiler in watch mode:**

```bash
npm run dev
```

**Terminal 2 — dev server:**

```bash
node dev-server.js
```

Open `http://localhost:3000` in the Mac browser.

---

## Project structure

```
fantasy-console/
  index.html              entry point, served from project root
  dev-server.js           local static file server, plain Node, no dependencies
  package.json            scripts only, no dependencies
  tsconfig.json           root TypeScript config, extended by shell and worker
  tsconfig.shell.json     shell config — targets DOM lib
  tsconfig.worker.json    worker config — targets WebWorker lib
  .prettierrc             formatter config
  .gitignore
  PLAN.md                 design decisions, architecture, full task list
  src/
    shared/       message types, API shapes, constants
    shell/        browser shell code
    worker/       web worker code — cassette runtime
    server/       Cloudflare Worker API — auth, storage
  dist/                   compiled output — do not edit
  vendor/                 vendored dependencies (CodeMirror) — committed, never auto-updated
```

---

## Architecture in one paragraph

The shell runs in the browser. It owns the game loop — every 33ms it sends a tick message to a web worker. The worker runs user-submitted cassette code, calls the drawing API, populates a bitmap buffer, and sends it back. The shell renders the bitmap to a canvas. If the worker doesn't respond within 500ms the shell kills and respawns it. User code never touches the DOM, never makes network requests (blocked by CSP), and can't reach the shell's state.

---

## Deployment

**Shell + Worker + Shared** — Cloudflare Pages, auto-deploys on push to main:

```bash
npm run build
git push
```

**Server** — deploy manually from inside the VM:

```bash
wrangler deploy
```

Wrangler is not in the project dependencies. Install it globally inside the VM only:

```bash
npm install -g wrangler
```

---

## Tooling

| Tool       | Where     | How installed                           |
| ---------- | --------- | --------------------------------------- |
| node / npm | Lima VM   | nvm                                     |
| typescript | Lima VM   | `npm install -g typescript`             |
| prettier   | Lima VM   | `npm install -g prettier`               |
| wrangler   | Lima VM   | `npm install -g wrangler` (when needed) |
| CodeMirror | `vendor/` | downloaded once, committed              |

No `node_modules` in this project. No runtime dependencies.
