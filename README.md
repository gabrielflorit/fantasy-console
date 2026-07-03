# Fantasy Console

A minimal JavaScript fantasy console. 64×64, 4 colors, one button.

See `PLAN.md` for all design decisions, architecture, and the task list.

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

## Testing on a real phone

The dev server runs inside the VM and `localhost:3000` is only forwarded to the Mac's loopback, so a phone can't reach it directly. A Cloudflare quick tunnel sidesteps this: it dials **out** from the VM to Cloudflare's edge and hands back a public HTTPS URL — no inbound port, no router config, no Lima port-forwarding.

This is _not_ a deploy. It's an ephemeral tunnel to the local dev server that disappears when you stop it. Different thing from `wrangler deploy`.

Install the binary once (inside the VM):

```bash
mkdir -p ~/.local/bin
curl -fL -o ~/.local/bin/cloudflared \
  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64
chmod +x ~/.local/bin/cloudflared
```

With `npm run dev` and `node dev-server.js` already running, start the tunnel in a third terminal:

```bash
cloudflared tunnel --url http://localhost:3000
```

It prints a `https://<random>.trycloudflare.com` URL — open that on the phone. SSE auto-reload works over the tunnel, so rebuilds refresh the phone too. `Ctrl+C` to stop.

Notes:

- Each run gets a **new** random URL — quick tunnels are ephemeral, no account or login.
- The URL is unguessable but unauthenticated. Fine for a throwaway dev session; don't post it publicly.
- It's HTTPS, so secure-context APIs (WebAuthn, Phase 5) work over it — LAN HTTP would not.

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
| cloudflared| Lima VM   | binary in `~/.local/bin` (phone testing)|
| CodeMirror | `vendor/` | downloaded once, committed              |

No `node_modules` in this project. No runtime dependencies.
