# Control Center

Local dev dashboard — worktrees, PRs, tool shortcuts. Retrowave themed.

## Dev

```bash
nvm use
pnpm install
pnpm dev
```

Open http://localhost:5173 (Vite) — API proxies to http://localhost:7778.

## Prod (daemon)

```bash
pnpm build
scripts/install-launchd.sh
```

Open http://localhost:7777.
