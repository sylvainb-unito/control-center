# Control Center — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold a local dev-dashboard web app with a retrowave theme and ship three panels (worktrees, pull requests, shortcuts) running as a launchd-managed daemon on `http://localhost:7777`.

**Architecture:** pnpm workspace with `web/` (Vite + React SPA), `server/` (Hono API), `shared/` (TS types), and `panels/<id>/` folders co-locating each panel's `ui.tsx` + `api.ts` + `meta.ts`. Panels register via two explicit registries. Data is fetched with TanStack Query (focus-refetch + manual refresh). Prod serves `web/dist` statically from the Hono process on `127.0.0.1:7777`.

**Tech Stack:** Node 22, pnpm 9, TypeScript strict, React 18, Vite, Hono, TanStack Query v5, Vitest, Biome, pino, self-hosted Orbitron / JetBrains Mono / VT323 fonts.

---

## Task 1: Workspace root scaffold

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `biome.json`
- Create: `.nvmrc`
- Create: `README.md`
- Modify: `.gitignore` (append `web/dist`, `server/dist` — already has node_modules/dist/.superpowers)

- [ ] **Step 1: Create `.nvmrc`**

```
22
```

- [ ] **Step 2: Create root `package.json`**

```json
{
  "name": "control-center",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22", "pnpm": ">=9" },
  "packageManager": "pnpm@9.15.0",
  "scripts": {
    "dev": "pnpm --filter server dev & pnpm --filter web dev",
    "build": "pnpm --filter server build && pnpm --filter web build",
    "test": "pnpm -r test",
    "check": "biome check .",
    "fix": "biome check --write ."
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.4",
    "typescript": "^5.6.3"
  }
}
```

- [ ] **Step 3: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "web"
  - "server"
  - "shared"
  - "panels/*"
```

- [ ] **Step 4: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "jsx": "react-jsx"
  }
}
```

- [ ] **Step 5: Create `biome.json`**

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": { "ignore": ["**/dist", "**/node_modules", ".superpowers"] },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "javascript": { "formatter": { "quoteStyle": "single", "semicolons": "always" } }
}
```

- [ ] **Step 6: Append to `.gitignore`**

```
web/dist
server/dist
```

- [ ] **Step 7: Create `README.md`**

```markdown
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
```

- [ ] **Step 8: Install root dev dependencies**

Run: `pnpm install`
Expected: creates `node_modules`, `pnpm-lock.yaml`.

- [ ] **Step 9: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json biome.json .nvmrc README.md .gitignore pnpm-lock.yaml
git commit -m "chore: scaffold pnpm workspace with biome + tsconfig"
```

---

## Task 2: Shared package — panel contract types

**Files:**
- Create: `shared/package.json`
- Create: `shared/tsconfig.json`
- Create: `shared/panel.ts`
- Create: `shared/index.ts`

- [ ] **Step 1: Create `shared/package.json`**

```json
{
  "name": "@cc/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./index.ts" }
}
```

- [ ] **Step 2: Create `shared/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["**/*.ts"]
}
```

- [ ] **Step 3: Create `shared/panel.ts`**

```ts
import type { FC } from 'react';
import type { Hono } from 'hono';

export type PanelSize = 'sm' | 'md' | 'lg';

export type PanelMeta = {
  id: string;
  title: string;
  icon?: string;
  order: number;
  defaultSize: PanelSize;
};

export type PanelUI = FC;
export type PanelAPI = Hono;

export type EnvelopeError = { code: string; message: string };
export type Envelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: EnvelopeError };
```

- [ ] **Step 4: Create `shared/index.ts`**

```ts
export * from './panel';
```

- [ ] **Step 5: Commit**

```bash
git add shared/
git commit -m "feat(shared): add PanelMeta, Envelope, and panel contract types"
```

---

## Task 3: Server scaffold — Hono app with envelope + health endpoint

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/vitest.config.ts`
- Create: `server/src/envelope.ts`
- Create: `server/src/envelope.test.ts`
- Create: `server/src/logger.ts`
- Create: `server/src/routes.ts`
- Create: `server/src/main.ts`

- [ ] **Step 1: Create `server/package.json`**

```json
{
  "name": "@cc/server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/main.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "test": "vitest run"
  },
  "dependencies": {
    "@cc/shared": "workspace:*",
    "@hono/node-server": "^1.13.7",
    "hono": "^4.6.14",
    "pino": "^9.5.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.1",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create `server/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "noEmit": false
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```

- [ ] **Step 3: Create `server/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Write failing envelope tests first**

Create `server/src/envelope.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { ok, fail } from './envelope';

describe('envelope', () => {
  test('ok wraps data', () => {
    expect(ok({ count: 1 })).toEqual({ ok: true, data: { count: 1 } });
  });

  test('fail wraps code and message', () => {
    expect(fail('E_CODE', 'message')).toEqual({
      ok: false,
      error: { code: 'E_CODE', message: 'message' },
    });
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `pnpm --filter @cc/server test`
Expected: FAIL — `envelope` module not found.

- [ ] **Step 6: Create `server/src/envelope.ts`**

```ts
import type { Envelope } from '@cc/shared';

export function ok<T>(data: T): Envelope<T> {
  return { ok: true, data };
}

export function fail(code: string, message: string): Envelope<never> {
  return { ok: false, error: { code, message } };
}
```

- [ ] **Step 7: Run test to verify pass**

Run: `pnpm --filter @cc/server test`
Expected: 2 passing.

- [ ] **Step 8: Create `server/src/logger.ts`**

```ts
import pino from 'pino';

const SENSITIVE_KEYS = /token|authorization|cookie/i;

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: ['*.token', '*.Authorization', '*.authorization', '*.cookie'],
    censor: '[REDACTED]',
  },
  formatters: {
    log(obj) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        out[k] = SENSITIVE_KEYS.test(k) ? '[REDACTED]' : v;
      }
      return out;
    },
  },
});
```

- [ ] **Step 9: Create `server/src/routes.ts`**

```ts
import type { Hono } from 'hono';

export function registerRoutes(_app: Hono): void {
  // panel routes registered in later tasks
}
```

- [ ] **Step 10: Create `server/src/main.ts`**

```ts
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import pkg from '../package.json' with { type: 'json' };
import { ok } from './envelope';
import { logger } from './logger';
import { registerRoutes } from './routes';

const startedAt = new Date().toISOString();
const app = new Hono();

app.get('/api/health', (c) =>
  c.json(
    ok({
      uptime: Math.floor((Date.now() - Date.parse(startedAt)) / 1000),
      version: pkg.version,
      startedAt,
    }),
  ),
);

registerRoutes(app);

app.onError((err, c) => {
  logger.error({ err: err.message, stack: err.stack }, 'unhandled');
  return c.json({ ok: false, error: { code: 'INTERNAL', message: err.message } }, 500);
});

const port = Number(process.env.PORT ?? 7778);
const hostname = process.env.BIND_HOST ?? '127.0.0.1';

serve({ fetch: app.fetch, port, hostname }, (info) => {
  logger.info({ port: info.port, hostname }, 'server ready');
});
```

- [ ] **Step 11: Install server deps**

Run: `pnpm install`

- [ ] **Step 12: Verify dev server boots**

Run: `pnpm --filter @cc/server dev`
Then in another shell: `curl -s http://127.0.0.1:7778/api/health | jq`
Expected: `{ "ok": true, "data": { "uptime": ..., "version": "0.1.0", "startedAt": "..." } }`
Stop the dev server (Ctrl-C).

- [ ] **Step 13: Commit**

```bash
git add server/ package.json pnpm-lock.yaml
git commit -m "feat(server): Hono skeleton with envelope helpers and /api/health"
```

---

## Task 4: Web scaffold — Vite + React + retrowave theme shell

**Files:**
- Create: `web/package.json`
- Create: `web/tsconfig.json`
- Create: `web/vite.config.ts`
- Create: `web/index.html`
- Create: `web/src/main.tsx`
- Create: `web/src/App.tsx`
- Create: `web/src/panels.ts`
- Create: `web/src/theme/tokens.css`
- Create: `web/src/theme/global.css`
- Create: `web/src/theme/panel.css`
- Create: `web/src/theme/fx.css`

- [ ] **Step 1: Create `web/package.json`**

```json
{
  "name": "@cc/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "@cc/shared": "workspace:*",
    "@tanstack/react-query": "^5.62.2",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.4",
    "jsdom": "^25.0.1",
    "typescript": "^5.6.3",
    "vite": "^5.4.11",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create `web/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "types": ["vite/client"]
  },
  "include": ["src", "../panels/**/*"]
}
```

- [ ] **Step 3: Create `web/vite.config.ts`**

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:7778', changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
});
```

- [ ] **Step 4: Create `web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Control Center</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `web/src/main.tsx`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './theme/tokens.css';
import './theme/global.css';
import './theme/panel.css';
import './theme/fx.css';

const root = document.getElementById('root');
if (!root) throw new Error('root missing');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 6: Create `web/src/panels.ts`** (empty registry for now)

```ts
import type { PanelMeta, PanelUI } from '@cc/shared';

export type PanelEntry = { meta: PanelMeta; UI: PanelUI };

export const panels: PanelEntry[] = [];
```

- [ ] **Step 7: Create `web/src/App.tsx`**

```tsx
import { panels } from './panels';

const SPAN: Record<string, string> = { sm: 'span 4', md: 'span 6', lg: 'span 8' };

export function App() {
  const sorted = [...panels].sort((a, b) => a.meta.order - b.meta.order);
  return (
    <main className="app">
      <header className="app-header">
        <h1 className="app-title">CONTROL CENTER</h1>
      </header>
      <section className="panel-grid">
        {sorted.length === 0 ? (
          <div className="empty">No panels registered yet.</div>
        ) : (
          sorted.map(({ meta, UI }) => (
            <div
              key={meta.id}
              className="panel-slot"
              style={{ gridColumn: SPAN[meta.defaultSize] }}
            >
              <UI />
            </div>
          ))
        )}
      </section>
    </main>
  );
}
```

- [ ] **Step 8: Create `web/src/theme/tokens.css`**

```css
:root {
  --bg-deep: #0b0221;
  --bg-mid: #1a0540;
  --bg-hot: #3d0a5c;
  --sun: #ff006e;
  --pink: #ff71ce;
  --cyan: #01cdfe;
  --green: #05ffa1;
  --yellow: #fffb96;
  --fg: #f5e6ff;
  --fg-dim: #b29fc7;
  --danger: #ff2d6f;
  --panel-bg: rgba(11, 2, 33, 0.72);
  --panel-border: var(--pink);
  --glow-pink: 0 0 10px #ff71ce, 0 0 22px rgba(255, 113, 206, 0.5);
  --glow-cyan: 0 0 10px #01cdfe, 0 0 22px rgba(1, 205, 254, 0.5);
  --radius: 4px;
}
```

- [ ] **Step 9: Create `web/src/theme/global.css`**

```css
* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
body {
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;
  color: var(--fg);
  background:
    radial-gradient(ellipse 70% 40% at 50% 82%, rgba(255, 0, 110, 0.65), transparent 60%),
    linear-gradient(180deg, var(--bg-deep) 0%, var(--bg-mid) 50%, var(--bg-hot) 85%, var(--sun) 100%);
  background-attachment: fixed;
  min-height: 100vh;
  position: relative;
  overflow-x: hidden;
}
body::before {
  content: '';
  position: fixed;
  left: 0; right: 0; bottom: 0; height: 55%;
  background-image:
    repeating-linear-gradient(0deg, transparent 0 39px, rgba(255, 113, 206, 0.45) 39px 40px),
    repeating-linear-gradient(90deg, transparent 0 39px, rgba(1, 205, 254, 0.35) 39px 40px);
  mask-image: linear-gradient(180deg, transparent 0%, black 60%);
  transform: perspective(600px) rotateX(55deg);
  transform-origin: top;
  pointer-events: none;
  z-index: 0;
}
.app { position: relative; z-index: 1; max-width: 1600px; margin: 0 auto; padding: 28px; }
.app-header { margin-bottom: 28px; }
.app-title {
  font-family: 'Orbitron', sans-serif;
  font-size: 28px;
  letter-spacing: 6px;
  color: var(--cyan);
  text-shadow: var(--glow-cyan);
  margin: 0;
}
.panel-grid {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: 20px;
}
.panel-slot { min-height: 200px; }
.empty { color: var(--fg-dim); padding: 40px; text-align: center; }
@media (max-width: 900px) {
  .panel-grid { grid-template-columns: 1fr; }
  .panel-slot { grid-column: 1 / -1 !important; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
*:focus-visible { outline: 2px solid var(--cyan); outline-offset: 2px; }
```

- [ ] **Step 10: Create `web/src/theme/panel.css`**

```css
.panel {
  background: var(--panel-bg);
  backdrop-filter: blur(6px);
  border: 2px solid var(--panel-border);
  border-radius: var(--radius);
  box-shadow: var(--glow-pink), inset 0 0 20px rgba(1, 205, 254, 0.08);
  padding: 16px;
  height: 100%;
  display: flex;
  flex-direction: column;
}
.panel-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 12px;
  font-family: 'Orbitron', sans-serif;
  text-transform: uppercase;
  letter-spacing: 2px;
  font-size: 14px;
  color: var(--pink);
  text-shadow: var(--glow-pink);
}
.panel-body { flex: 1; overflow-y: auto; }
.panel-row {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 0;
  border-bottom: 1px dashed rgba(255, 113, 206, 0.22);
  font-size: 13px;
}
.panel-row:hover { color: var(--cyan); }
.panel-row:last-child { border-bottom: none; }
.panel-refresh {
  background: transparent; color: var(--fg-dim); border: 1px solid var(--fg-dim);
  border-radius: var(--radius); padding: 2px 8px;
  font-family: 'JetBrains Mono', monospace; font-size: 11px;
  cursor: pointer;
}
.panel-refresh:hover { color: var(--pink); border-color: var(--pink); }
```

- [ ] **Step 11: Create `web/src/theme/fx.css`**

```css
.neon-text { text-shadow: var(--glow-pink); }
.neon-text--cyan { color: var(--cyan); text-shadow: var(--glow-cyan); }
.glow-border { box-shadow: var(--glow-pink); }
.scanlines { position: relative; }
.scanlines::after {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background: repeating-linear-gradient(0deg, transparent 0 2px, rgba(0,0,0,0.15) 2px 3px);
}
.badge {
  display: inline-block;
  padding: 1px 7px;
  font-family: 'VT323', monospace;
  font-size: 14px;
  letter-spacing: 1px;
  border: 1px solid currentColor;
  border-radius: 3px;
}
.badge--success { color: var(--green); }
.badge--warn { color: var(--yellow); }
.badge--danger { color: var(--danger); }
.badge--info { color: var(--cyan); }
```

- [ ] **Step 12: Create `web/src/test-setup.ts`**

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 13: Install deps and run dev**

Run: `pnpm install`
Run: `pnpm --filter @cc/web dev`
Open http://localhost:5173 — should show "CONTROL CENTER" heading over grid-floor background with "No panels registered yet." message.
Stop Vite (Ctrl-C).

- [ ] **Step 14: Commit**

```bash
git add web/ package.json pnpm-lock.yaml
git commit -m "feat(web): Vite + React scaffold with retrowave theme and empty panel grid"
```

---

## Task 5: Self-host fonts (Orbitron, JetBrains Mono, VT323)

**Files:**
- Create: `web/public/fonts/orbitron.woff2`
- Create: `web/public/fonts/jetbrains-mono.woff2`
- Create: `web/public/fonts/vt323.woff2`
- Modify: `web/src/theme/global.css` (add `@font-face` declarations at top)

- [ ] **Step 1: Download fonts**

From Google Fonts (https://fonts.google.com/), download `.woff2` files (or use Fontsource packages — see alternative below).

Recommended: install Fontsource packages instead of manual download.

```bash
pnpm --filter @cc/web add @fontsource/orbitron @fontsource/jetbrains-mono @fontsource/vt323
```

- [ ] **Step 2: Import Fontsource CSS in `web/src/main.tsx`**

Replace the theme imports with (add BEFORE the theme imports):

```tsx
import '@fontsource/orbitron/400.css';
import '@fontsource/orbitron/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/vt323/400.css';
import './theme/tokens.css';
import './theme/global.css';
import './theme/panel.css';
import './theme/fx.css';
```

(Fontsource ships woff2 assets and CSS; Vite inlines them at build time — no runtime CDN call.)

- [ ] **Step 3: Verify fonts load**

Run: `pnpm --filter @cc/web dev`
Open http://localhost:5173. "CONTROL CENTER" heading should now render in Orbitron. DevTools → Network tab should show woff2 requests to the local dev server (no `fonts.googleapis.com`).
Stop Vite.

- [ ] **Step 4: Commit**

```bash
git add web/package.json pnpm-lock.yaml web/src/main.tsx
git commit -m "feat(web): self-host Orbitron, JetBrains Mono, and VT323 via Fontsource"
```

---

## Task 6: QueryClient, fetchJson wrapper, and ErrorBoundary

**Files:**
- Create: `web/src/lib/fetchJson.ts`
- Create: `web/src/lib/fetchJson.test.ts`
- Create: `web/src/lib/queryClient.ts`
- Create: `web/src/lib/ErrorBoundary.tsx`
- Create: `web/src/lib/ErrorBoundary.test.tsx`
- Modify: `web/src/main.tsx` (wrap App in QueryClientProvider)

- [ ] **Step 1: Write failing `fetchJson` test**

Create `web/src/lib/fetchJson.test.ts`:

```ts
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { fetchJson } from './fetchJson';

describe('fetchJson', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  test('returns data on ok envelope', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, data: { x: 1 } }),
    });
    await expect(fetchJson<{ x: number }>('/api/x')).resolves.toEqual({ x: 1 });
  });

  test('throws envelope error', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: false, error: { code: 'X', message: 'y' } }),
    });
    await expect(fetchJson('/api/x')).rejects.toMatchObject({ code: 'X', message: 'y' });
  });

  test('throws on http error', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    });
    await expect(fetchJson('/api/x')).rejects.toMatchObject({ code: 'HTTP_500' });
  });
});
```

- [ ] **Step 2: Run test — verify fail**

Run: `pnpm --filter @cc/web test`
Expected: module not found.

- [ ] **Step 3: Create `web/src/lib/fetchJson.ts`**

```ts
import type { Envelope, EnvelopeError } from '@cc/shared';

export class FetchError extends Error implements EnvelopeError {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export async function fetchJson<T>(
  input: RequestInfo,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    throw new FetchError(`HTTP_${res.status}`, `Request failed: ${res.status}`);
  }
  const body = (await res.json()) as Envelope<T>;
  if (!body.ok) {
    throw new FetchError(body.error.code, body.error.message);
  }
  return body.data;
}
```

- [ ] **Step 4: Run test — verify pass**

Run: `pnpm --filter @cc/web test`
Expected: 3 passing.

- [ ] **Step 5: Create `web/src/lib/queryClient.ts`**

```ts
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      staleTime: 10_000,
      gcTime: 300_000,
      retry: 1,
    },
  },
});
```

- [ ] **Step 6: Write failing ErrorBoundary test**

Create `web/src/lib/ErrorBoundary.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

function Boom(): never { throw new Error('kaboom'); }

describe('ErrorBoundary', () => {
  test('renders children when no error', () => {
    render(<ErrorBoundary panelId="x"><div>ok</div></ErrorBoundary>);
    expect(screen.getByText('ok')).toBeInTheDocument();
  });

  test('renders error fallback on throw', () => {
    // Silence expected console errors from React.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ErrorBoundary panelId="x"><Boom /></ErrorBoundary>);
    expect(screen.getByText(/kaboom/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    spy.mockRestore();
  });
});
```

Add `import { vi } from 'vitest';` at top.

- [ ] **Step 7: Run test — verify fail**

Run: `pnpm --filter @cc/web test`
Expected: ErrorBoundary module missing.

- [ ] **Step 8: Create `web/src/lib/ErrorBoundary.tsx`**

```tsx
import { Component, type ReactNode } from 'react';

type Props = { panelId: string; children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    console.error(`[panel:${this.props.panelId}]`, error);
  }

  private reset = (): void => this.setState({ error: null });

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="panel panel--error">
          <div className="panel-header">{this.props.panelId} — error</div>
          <div className="panel-body">
            <p style={{ color: 'var(--danger)' }}>{this.state.error.message}</p>
            <button type="button" className="panel-refresh" onClick={this.reset}>
              Retry
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
```

- [ ] **Step 9: Run test — verify pass**

Run: `pnpm --filter @cc/web test`
Expected: all passing (5 tests total).

- [ ] **Step 10: Update `web/src/main.tsx` to wrap in QueryClientProvider**

```tsx
import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/orbitron/400.css';
import '@fontsource/orbitron/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/vt323/400.css';
import './theme/tokens.css';
import './theme/global.css';
import './theme/panel.css';
import './theme/fx.css';
import { App } from './App';
import { queryClient } from './lib/queryClient';

const root = document.getElementById('root');
if (!root) throw new Error('root missing');
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
```

- [ ] **Step 11: Update `web/src/App.tsx` to wrap each panel in ErrorBoundary**

```tsx
import { panels } from './panels';
import { ErrorBoundary } from './lib/ErrorBoundary';

const SPAN: Record<string, string> = { sm: 'span 4', md: 'span 6', lg: 'span 8' };

export function App() {
  const sorted = [...panels].sort((a, b) => a.meta.order - b.meta.order);
  return (
    <main className="app">
      <header className="app-header">
        <h1 className="app-title">CONTROL CENTER</h1>
      </header>
      <section className="panel-grid">
        {sorted.length === 0 ? (
          <div className="empty">No panels registered yet.</div>
        ) : (
          sorted.map(({ meta, UI }) => (
            <div
              key={meta.id}
              className="panel-slot"
              style={{ gridColumn: SPAN[meta.defaultSize] }}
            >
              <ErrorBoundary panelId={meta.id}>
                <UI />
              </ErrorBoundary>
            </div>
          ))
        )}
      </section>
    </main>
  );
}
```

- [ ] **Step 12: Commit**

```bash
git add web/
git commit -m "feat(web): QueryClient, fetchJson envelope wrapper, and per-panel ErrorBoundary"
```

---

## Task 7: `server/lib/git.ts` — list worktrees (TDD)

**Files:**
- Create: `server/src/lib/git.ts`
- Create: `server/src/lib/git.test.ts`

- [ ] **Step 1: Write failing test for `listWorktrees`**

Create `server/src/lib/git.test.ts`:

```ts
import { describe, expect, test, vi } from 'vitest';
import type { ChildProcess, ExecFileException } from 'node:child_process';

type Runner = (
  cmd: string,
  args: string[],
) => Promise<{ stdout: string; stderr: string }>;

describe('listWorktrees', () => {
  test('parses glob result and runs per-worktree git commands', async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const runner: Runner = async (cmd, args) => {
      calls.push({ cmd, args });
      const joined = args.join(' ');
      if (joined.includes('rev-parse --abbrev-ref')) return { stdout: 'feat/x\n', stderr: '' };
      if (joined.includes('rev-parse --short')) return { stdout: 'abc1234\n', stderr: '' };
      if (joined.includes('status --porcelain')) return { stdout: '', stderr: '' };
      if (joined.includes('rev-list --left-right')) return { stdout: '0\t3\n', stderr: '' };
      if (joined.includes("log -1 --format=%cI")) return { stdout: '2026-04-15T10:00:00Z\n', stderr: '' };
      if (joined.includes('branch --merged')) return { stdout: 'feat/x\nmain\n', stderr: '' };
      return { stdout: '', stderr: '' };
    };

    const globber = async () => ['/Users/u/Workspace/proj/.worktrees/feat-x'];

    const { listWorktrees } = await import('./git');
    const result = await listWorktrees({ runner, globber, now: () => new Date('2026-04-20T00:00:00Z').getTime() });

    expect(result).toEqual([
      {
        name: 'proj',
        path: '/Users/u/Workspace/proj',
        worktrees: [
          {
            path: '/Users/u/Workspace/proj/.worktrees/feat-x',
            branch: 'feat/x',
            head: 'abc1234',
            dirty: false,
            ahead: 3,
            behind: 0,
            lastCommitAt: '2026-04-15T10:00:00Z',
            mergedToMain: true,
            ageDays: 5,
          },
        ],
      },
    ]);
    expect(calls.some((c) => c.args[0] === '-C' && c.args.includes('rev-parse'))).toBe(true);
  });

  test('falls back to master when main missing', async () => {
    const runner: Runner = async (_cmd, args) => {
      const joined = args.join(' ');
      if (joined.includes('rev-parse --abbrev-ref')) return { stdout: 'feat/x\n', stderr: '' };
      if (joined.includes('rev-parse --short')) return { stdout: 'aaa\n', stderr: '' };
      if (joined.includes('status --porcelain')) return { stdout: '', stderr: '' };
      if (joined.includes('rev-list --left-right')) return { stdout: '0\t0\n', stderr: '' };
      if (joined.includes('log -1 --format=%cI')) return { stdout: '2026-04-19T10:00:00Z\n', stderr: '' };
      if (joined.includes('branch --merged main')) {
        const err: ExecFileException = new Error('fatal') as ExecFileException;
        err.code = 128;
        throw err;
      }
      if (joined.includes('branch --merged master')) return { stdout: 'feat/x\n', stderr: '' };
      return { stdout: '', stderr: '' };
    };
    const globber = async () => ['/w/proj/.worktrees/feat-x'];
    const { listWorktrees } = await import('./git');
    const result = await listWorktrees({ runner, globber, now: () => Date.parse('2026-04-20T00:00:00Z') });
    expect(result[0]?.worktrees[0]?.mergedToMain).toBe(true);
  });
});
```

- [ ] **Step 2: Run test — verify fail**

Run: `pnpm --filter @cc/server test`
Expected: `git.ts` module missing.

- [ ] **Step 3: Create `server/src/lib/git.ts`**

```ts
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { glob as nativeGlob } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const execFile = promisify(execFileCb);

export type Runner = (
  cmd: string,
  args: string[],
) => Promise<{ stdout: string; stderr: string }>;

export type Globber = (pattern: string) => Promise<string[]>;

export type Worktree = {
  path: string;
  branch: string;
  head: string;
  dirty: boolean;
  ahead: number;
  behind: number;
  lastCommitAt: string;
  mergedToMain: boolean;
  ageDays: number;
};

export type Repo = { name: string; path: string; worktrees: Worktree[] };

const defaultRunner: Runner = async (cmd, args) => {
  const { stdout, stderr } = await execFile(cmd, args, { maxBuffer: 4 * 1024 * 1024 });
  return { stdout, stderr };
};

const defaultGlobber: Globber = async (pattern) => {
  const entries: string[] = [];
  for await (const entry of nativeGlob(pattern)) entries.push(entry as string);
  return entries;
};

type Deps = {
  runner?: Runner;
  globber?: Globber;
  now?: () => number;
  home?: string;
};

async function mergedBranches(runner: Runner, repoPath: string): Promise<Set<string>> {
  for (const base of ['main', 'master']) {
    try {
      const { stdout } = await runner('git', ['-C', repoPath, 'branch', '--merged', base, '--format=%(refname:short)']);
      return new Set(stdout.split('\n').map((l) => l.trim()).filter(Boolean));
    } catch {
      continue;
    }
  }
  return new Set();
}

export async function listWorktrees(deps: Deps = {}): Promise<Repo[]> {
  const runner = deps.runner ?? defaultRunner;
  const globber = deps.globber ?? defaultGlobber;
  const now = deps.now ?? (() => Date.now());
  const home = deps.home ?? os.homedir();

  const pattern = path.join(home, 'Workspace', '*', '.worktrees', '*');
  const paths = await globber(pattern);

  const repos = new Map<string, Repo>();

  for (const wtPath of paths) {
    const repoPath = path.resolve(wtPath, '..', '..');
    const repoName = path.basename(repoPath);

    const [branch, head, status, aheadBehind, lastCommit] = await Promise.all([
      runner('git', ['-C', wtPath, 'rev-parse', '--abbrev-ref', 'HEAD']).then((r) => r.stdout.trim()).catch(() => ''),
      runner('git', ['-C', wtPath, 'rev-parse', '--short', 'HEAD']).then((r) => r.stdout.trim()).catch(() => ''),
      runner('git', ['-C', wtPath, 'status', '--porcelain']).then((r) => r.stdout).catch(() => ''),
      runner('git', ['-C', wtPath, 'rev-list', '--left-right', '--count', '@{upstream}...HEAD'])
        .then((r) => r.stdout.trim())
        .catch(() => '0\t0'),
      runner('git', ['-C', wtPath, 'log', '-1', '--format=%cI']).then((r) => r.stdout.trim()).catch(() => ''),
    ]);

    const [behindStr, aheadStr] = aheadBehind.split(/\s+/);
    const ageDays = lastCommit
      ? Math.floor((now() - Date.parse(lastCommit)) / 86_400_000)
      : 0;

    let repo = repos.get(repoPath);
    if (!repo) {
      const merged = await mergedBranches(runner, repoPath);
      repo = { name: repoName, path: repoPath, worktrees: [] };
      (repo as Repo & { __merged: Set<string> }).__merged = merged;
      repos.set(repoPath, repo);
    }
    const merged = (repo as Repo & { __merged: Set<string> }).__merged;

    repo.worktrees.push({
      path: wtPath,
      branch,
      head,
      dirty: status.trim().length > 0,
      ahead: Number.parseInt(aheadStr ?? '0', 10) || 0,
      behind: Number.parseInt(behindStr ?? '0', 10) || 0,
      lastCommitAt: lastCommit,
      mergedToMain: merged.has(branch),
      ageDays,
    });
  }

  return [...repos.values()].map(({ __merged, ...r }: any) => r);
}
```

- [ ] **Step 4: Run test — verify pass**

Run: `pnpm --filter @cc/server test`
Expected: 4 passing (envelope 2 + git 2).

- [ ] **Step 5: Commit**

```bash
git add server/
git commit -m "feat(server): git.listWorktrees discovers and annotates worktrees"
```

---

## Task 8: `server/lib/git.ts` — remove worktree (TDD)

**Files:**
- Modify: `server/src/lib/git.ts`
- Modify: `server/src/lib/git.test.ts`

- [ ] **Step 1: Append failing test for `removeWorktree`**

Append to `server/src/lib/git.test.ts`:

```ts
describe('removeWorktree', () => {
  test('refuses dirty tree without force', async () => {
    const runner: Runner = async (_cmd, args) => {
      if (args.includes('status')) return { stdout: ' M foo\n', stderr: '' };
      return { stdout: '', stderr: '' };
    };
    const { removeWorktree } = await import('./git');
    await expect(removeWorktree('/w/proj/.worktrees/x', { force: false, runner })).rejects.toMatchObject({
      code: 'DIRTY_WORKTREE',
    });
  });

  test('runs git worktree remove with --force when forced', async () => {
    const calls: string[][] = [];
    const runner: Runner = async (_cmd, args) => {
      calls.push(args);
      if (args.includes('status')) return { stdout: ' M foo\n', stderr: '' };
      return { stdout: '', stderr: '' };
    };
    const { removeWorktree } = await import('./git');
    await removeWorktree('/w/proj/.worktrees/x', { force: true, runner });
    const removeCall = calls.find((a) => a.includes('remove'));
    expect(removeCall).toEqual(['-C', '/w/proj', 'worktree', 'remove', '--force', '/w/proj/.worktrees/x']);
  });

  test('runs remove without --force when clean', async () => {
    const calls: string[][] = [];
    const runner: Runner = async (_cmd, args) => {
      calls.push(args);
      if (args.includes('status')) return { stdout: '', stderr: '' };
      return { stdout: '', stderr: '' };
    };
    const { removeWorktree } = await import('./git');
    await removeWorktree('/w/proj/.worktrees/x', { force: false, runner });
    const removeCall = calls.find((a) => a.includes('remove'));
    expect(removeCall).toEqual(['-C', '/w/proj', 'worktree', 'remove', '/w/proj/.worktrees/x']);
  });
});
```

- [ ] **Step 2: Run test — verify fail**

Run: `pnpm --filter @cc/server test`
Expected: `removeWorktree` export missing.

- [ ] **Step 3: Append `removeWorktree` to `server/src/lib/git.ts`**

```ts
export class GitError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export async function removeWorktree(
  worktreePath: string,
  opts: { force: boolean; runner?: Runner },
): Promise<void> {
  const runner = opts.runner ?? defaultRunner;
  const repoPath = path.resolve(worktreePath, '..', '..');

  const { stdout: status } = await runner('git', ['-C', worktreePath, 'status', '--porcelain']);
  if (status.trim().length > 0 && !opts.force) {
    throw new GitError('DIRTY_WORKTREE', 'worktree has uncommitted changes');
  }

  const args = ['-C', repoPath, 'worktree', 'remove'];
  if (opts.force) args.push('--force');
  args.push(worktreePath);
  try {
    await runner('git', args);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new GitError('REMOVE_FAILED', msg.slice(0, 200));
  }
}
```

- [ ] **Step 4: Run test — verify pass**

Run: `pnpm --filter @cc/server test`
Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add server/
git commit -m "feat(server): git.removeWorktree with dirty guard and --force path"
```

---

## Task 9: Worktrees panel — meta, types, API, UI

**Files:**
- Create: `panels/worktrees/package.json`
- Create: `panels/worktrees/tsconfig.json`
- Create: `panels/worktrees/meta.ts`
- Create: `panels/worktrees/types.ts`
- Create: `panels/worktrees/api.ts`
- Create: `panels/worktrees/api.test.ts`
- Create: `panels/worktrees/ui.tsx`
- Create: `panels/worktrees/ui.module.css`
- Modify: `server/src/routes.ts`
- Modify: `web/src/panels.ts`

- [ ] **Step 1: Create `panels/worktrees/package.json`**

```json
{
  "name": "@cc/panel-worktrees",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    "./ui": "./ui.tsx",
    "./api": "./api.ts",
    "./meta": "./meta.ts",
    "./types": "./types.ts"
  },
  "scripts": { "test": "vitest run" },
  "dependencies": {
    "@cc/server": "workspace:*",
    "@cc/shared": "workspace:*",
    "@tanstack/react-query": "^5.62.2",
    "hono": "^4.6.14",
    "react": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.12",
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create `panels/worktrees/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["**/*.ts", "**/*.tsx"]
}
```

- [ ] **Step 3: Create `panels/worktrees/meta.ts`**

```ts
import type { PanelMeta } from '@cc/shared';

export const meta: PanelMeta = {
  id: 'worktrees',
  title: 'Worktrees',
  order: 10,
  defaultSize: 'lg',
};
```

- [ ] **Step 4: Create `panels/worktrees/types.ts`**

```ts
export type Worktree = {
  path: string;
  branch: string;
  head: string;
  dirty: boolean;
  ahead: number;
  behind: number;
  lastCommitAt: string;
  mergedToMain: boolean;
  ageDays: number;
};

export type Repo = { name: string; path: string; worktrees: Worktree[] };

export type ListResponse = { repos: Repo[] };
```

- [ ] **Step 5: Write failing API test**

Create `panels/worktrees/api.test.ts`:

```ts
import { describe, expect, test, vi } from 'vitest';

vi.mock('@cc/server/lib/git', () => ({
  listWorktrees: vi.fn(async () => [
    { name: 'proj', path: '/p', worktrees: [] },
  ]),
  removeWorktree: vi.fn(async () => {}),
  GitError: class extends Error { code = 'X'; },
}));

describe('worktrees api', () => {
  test('GET / returns envelope of repos', async () => {
    const { api } = await import('./api');
    const res = await api.request('/');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, data: { repos: [{ name: 'proj', path: '/p', worktrees: [] }] } });
  });

  test('DELETE / with dirty returns DIRTY_WORKTREE', async () => {
    const git = await import('@cc/server/lib/git');
    (git.removeWorktree as any).mockRejectedValueOnce(Object.assign(new Error('dirty'), { code: 'DIRTY_WORKTREE' }));
    const { api } = await import('./api');
    const res = await api.request('/', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: '/p/.worktrees/x', force: false }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, error: { code: 'DIRTY_WORKTREE' } });
  });

  test('DELETE / success returns removed path', async () => {
    const { api } = await import('./api');
    const res = await api.request('/', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: '/p/.worktrees/x', force: true }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, data: { removed: '/p/.worktrees/x' } });
  });
});
```

Server needs to expose `@cc/server/lib/git` — update `server/package.json` `exports`:

```json
"exports": {
  "./lib/git": "./src/lib/git.ts",
  "./lib/gh": "./src/lib/gh.ts"
}
```

(Add this field to the existing `server/package.json`.)

- [ ] **Step 6: Run test — verify fail**

Run: `pnpm --filter @cc/panel-worktrees test`
Expected: `api` module missing.

- [ ] **Step 7: Create `panels/worktrees/api.ts`**

```ts
import { Hono } from 'hono';
import { ok, fail } from '@cc/server/envelope';
import { listWorktrees, removeWorktree, GitError } from '@cc/server/lib/git';

export const api = new Hono();

api.get('/', async (c) => {
  const repos = await listWorktrees();
  return c.json(ok({ repos }));
});

api.delete('/', async (c) => {
  const body = await c.req.json<{ path: string; force?: boolean }>();
  if (!body?.path) return c.json(fail('BAD_REQUEST', 'path required'), 400);
  try {
    await removeWorktree(body.path, { force: body.force === true });
    return c.json(ok({ removed: body.path }));
  } catch (err) {
    if (err instanceof GitError) {
      const status = err.code === 'DIRTY_WORKTREE' ? 409 : 500;
      return c.json(fail(err.code, err.message), status);
    }
    throw err;
  }
});
```

Add to `server/package.json` exports as noted above, and add one more for envelope:

```json
"exports": {
  "./envelope": "./src/envelope.ts",
  "./lib/git": "./src/lib/git.ts",
  "./lib/gh": "./src/lib/gh.ts"
}
```

- [ ] **Step 8: Run test — verify pass**

Run: `pnpm install && pnpm --filter @cc/panel-worktrees test`
Expected: 3 passing.

- [ ] **Step 9: Create `panels/worktrees/ui.module.css`**

```css
.repo { margin-bottom: 14px; }
.repoHead { font-family: 'Orbitron', sans-serif; color: var(--cyan); letter-spacing: 1.5px; font-size: 13px; padding: 6px 0; }
.row { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.branch { flex: 1; color: var(--fg); }
.sha { color: var(--fg-dim); font-size: 11px; }
.badges { display: flex; gap: 4px; }
.del { background: transparent; border: 1px solid var(--danger); color: var(--danger); padding: 2px 8px; font-size: 11px; cursor: pointer; border-radius: 3px; }
.del:hover { background: var(--danger); color: var(--bg-deep); }
.modal { position: fixed; inset: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modalBody { background: var(--bg-mid); border: 2px solid var(--pink); box-shadow: var(--glow-pink); padding: 20px; max-width: 500px; }
.actions { display: flex; gap: 8px; margin-top: 16px; justify-content: flex-end; }
.cancel { background: transparent; color: var(--fg); border: 1px solid var(--fg-dim); padding: 4px 12px; cursor: pointer; }
.confirm { background: var(--pink); color: var(--bg-deep); border: 1px solid var(--pink); padding: 4px 12px; cursor: pointer; font-weight: bold; }
.force { background: var(--danger); color: var(--bg-deep); border: 1px solid var(--danger); padding: 4px 12px; cursor: pointer; font-weight: bold; }
```

- [ ] **Step 10: Create `panels/worktrees/ui.tsx`**

```tsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { fetchJson } from '../../web/src/lib/fetchJson';
import s from './ui.module.css';
import type { ListResponse, Worktree } from './types';

const QK = ['worktrees'] as const;

export const UI = () => {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery<ListResponse>({
    queryKey: QK,
    queryFn: () => fetchJson<ListResponse>('/api/worktrees'),
  });
  const [pending, setPending] = useState<Worktree | null>(null);

  const remove = useMutation({
    mutationFn: async (args: { path: string; force: boolean }) =>
      fetchJson<{ removed: string }>('/api/worktrees', {
        method: 'DELETE',
        body: JSON.stringify(args),
      }),
    onSuccess: () => {
      setPending(null);
      qc.invalidateQueries({ queryKey: QK });
    },
  });

  return (
    <div className="panel">
      <div className="panel-header">
        Worktrees
        <button type="button" className="panel-refresh" onClick={() => refetch()}>refresh</button>
      </div>
      <div className="panel-body">
        {isLoading && <p style={{ color: 'var(--fg-dim)' }}>loading…</p>}
        {error && <p style={{ color: 'var(--danger)' }}>{(error as Error).message}</p>}
        {data?.repos.length === 0 && <p style={{ color: 'var(--fg-dim)' }}>No worktrees.</p>}
        {data?.repos.map((r) => (
          <div key={r.path} className={s.repo}>
            <div className={s.repoHead}>{r.name}</div>
            {r.worktrees.map((w) => (
              <div key={w.path} className="panel-row">
                <span className={s.branch}>{w.branch}</span>
                <span className={s.sha}>{w.head}</span>
                <span className={s.badges}>
                  {w.mergedToMain && <span className="badge badge--success">merged</span>}
                  {w.dirty && <span className="badge badge--warn">dirty</span>}
                  {w.ahead > 0 && <span className="badge badge--info">↑{w.ahead}</span>}
                  {w.behind > 0 && <span className="badge badge--info">↓{w.behind}</span>}
                  <span className="badge">{w.ageDays}d</span>
                </span>
                <button type="button" className={s.del} onClick={() => setPending(w)}>delete</button>
              </div>
            ))}
          </div>
        ))}
      </div>
      {pending && (
        <div className={s.modal} onClick={() => setPending(null)} onKeyDown={(e) => e.key === 'Escape' && setPending(null)}>
          <div className={s.modalBody} onClick={(e) => e.stopPropagation()}>
            <p>Remove <code>{pending.path}</code>?</p>
            {pending.dirty && <p style={{ color: 'var(--yellow)' }}>⚠ Uncommitted changes. Use "Force" to remove anyway.</p>}
            <div className={s.actions}>
              <button type="button" className={s.cancel} onClick={() => setPending(null)}>cancel</button>
              {!pending.dirty && (
                <button type="button" className={s.confirm} onClick={() => remove.mutate({ path: pending.path, force: false })} disabled={remove.isPending}>
                  remove
                </button>
              )}
              {pending.dirty && (
                <button type="button" className={s.force} onClick={() => remove.mutate({ path: pending.path, force: true })} disabled={remove.isPending}>
                  force remove
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 11: Register panel in web**

Replace `web/src/panels.ts`:

```ts
import type { PanelMeta, PanelUI } from '@cc/shared';
import { UI as worktreesUI } from '../../panels/worktrees/ui';
import { meta as worktreesMeta } from '../../panels/worktrees/meta';

export type PanelEntry = { meta: PanelMeta; UI: PanelUI };

export const panels: PanelEntry[] = [
  { meta: worktreesMeta, UI: worktreesUI },
];
```

- [ ] **Step 12: Register route in server**

Replace `server/src/routes.ts`:

```ts
import type { Hono } from 'hono';
import { api as worktreesApi } from '../../panels/worktrees/api';

export function registerRoutes(app: Hono): void {
  app.route('/api/worktrees', worktreesApi);
}
```

- [ ] **Step 13: Verify end-to-end**

Run: `pnpm dev`
Open http://localhost:5173. The worktrees panel should render and list real worktrees from `~/Workspace/*/.worktrees/*` (may be empty — that's fine).
Stop dev.

- [ ] **Step 14: Commit**

```bash
git add panels/worktrees/ server/ web/src/panels.ts package.json pnpm-lock.yaml
git commit -m "feat(panels): worktrees panel with list, badges, and delete flow"
```

---

## Task 10: `server/lib/gh.ts` — token retrieval + GraphQL client (TDD)

**Files:**
- Create: `server/src/lib/gh.ts`
- Create: `server/src/lib/gh.test.ts`

- [ ] **Step 1: Write failing tests**

Create `server/src/lib/gh.test.ts`:

```ts
import { describe, expect, test, vi, beforeEach } from 'vitest';

describe('gh token + graphql', () => {
  beforeEach(() => { vi.resetModules(); });

  test('reads token from gh auth token and caches it', async () => {
    let calls = 0;
    const runner = async (_cmd: string, args: string[]) => {
      if (args[0] === 'auth' && args[1] === 'token') {
        calls++;
        return { stdout: 'gho_secret\n', stderr: '' };
      }
      return { stdout: '', stderr: '' };
    };
    const fetcher = vi.fn(async () => ({
      ok: true, status: 200,
      text: async () => JSON.stringify({ data: { viewer: { login: 'me' } } }),
    } as unknown as Response));

    const { graphql, __resetTokenForTests } = await import('./gh');
    __resetTokenForTests();

    await graphql('query{viewer{login}}', {}, { runner, fetcher });
    await graphql('query{viewer{login}}', {}, { runner, fetcher });

    expect(calls).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const [, init] = fetcher.mock.calls[0]!;
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer gho_secret');
  });

  test('refreshes token on 401 and retries once', async () => {
    const runner = async () => ({ stdout: 'gho_secret\n', stderr: '' });
    let count = 0;
    const fetcher = vi.fn(async () => {
      count++;
      if (count === 1) {
        return { ok: false, status: 401, text: async () => 'unauthorized' } as unknown as Response;
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: { x: 1 } }) } as unknown as Response;
    });
    const { graphql, __resetTokenForTests } = await import('./gh');
    __resetTokenForTests();
    const result = await graphql('query', {}, { runner, fetcher });
    expect(result).toEqual({ x: 1 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  test('throws GH_AUTH_MISSING when gh fails', async () => {
    const runner = async () => { throw new Error('not logged in'); };
    const fetcher = vi.fn();
    const { graphql, __resetTokenForTests } = await import('./gh');
    __resetTokenForTests();
    await expect(graphql('q', {}, { runner, fetcher })).rejects.toMatchObject({ code: 'GH_AUTH_MISSING' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test — verify fail**

Run: `pnpm --filter @cc/server test`
Expected: `gh.ts` missing.

- [ ] **Step 3: Create `server/src/lib/gh.ts`**

```ts
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

export class GhError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

type Runner = (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;
type Fetcher = typeof fetch;

const defaultRunner: Runner = async (cmd, args) => {
  const { stdout, stderr } = await execFile(cmd, args);
  return { stdout, stderr };
};

let cachedToken: string | null = null;

export function __resetTokenForTests(): void {
  cachedToken = null;
}

async function getToken(runner: Runner, refresh = false): Promise<string> {
  if (cachedToken && !refresh) return cachedToken;
  try {
    const { stdout } = await runner('gh', ['auth', 'token']);
    const token = stdout.trim();
    if (!token) throw new Error('empty token');
    cachedToken = token;
    return token;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new GhError('GH_AUTH_MISSING', `gh auth token failed: ${msg.slice(0, 200)}`);
  }
}

export async function graphql<T>(
  query: string,
  variables: Record<string, unknown> = {},
  opts: { runner?: Runner; fetcher?: Fetcher } = {},
): Promise<T> {
  const runner = opts.runner ?? defaultRunner;
  const fetcher = opts.fetcher ?? fetch;

  const doFetch = async (token: string): Promise<Response> =>
    fetcher('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'user-agent': 'control-center/0.1',
      },
      body: JSON.stringify({ query, variables }),
    });

  let token = await getToken(runner);
  let res = await doFetch(token);

  if (res.status === 401) {
    token = await getToken(runner, true);
    res = await doFetch(token);
  }

  const text = await res.text();
  if (!res.ok) {
    throw new GhError(`HTTP_${res.status}`, text.slice(0, 200));
  }
  const body = JSON.parse(text) as { data?: T; errors?: Array<{ message: string }> };
  if (body.errors?.length) {
    throw new GhError('GRAPHQL_ERROR', body.errors.map((e) => e.message).join('; ').slice(0, 200));
  }
  return body.data as T;
}
```

- [ ] **Step 4: Run test — verify pass**

Run: `pnpm --filter @cc/server test`
Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add server/
git commit -m "feat(server): gh.graphql with token caching, 401 refresh, and error mapping"
```

---

## Task 11: Pull Requests panel — meta, types, API, UI

**Files:**
- Create: `panels/pull-requests/package.json`
- Create: `panels/pull-requests/tsconfig.json`
- Create: `panels/pull-requests/meta.ts`
- Create: `panels/pull-requests/types.ts`
- Create: `panels/pull-requests/api.ts`
- Create: `panels/pull-requests/api.test.ts`
- Create: `panels/pull-requests/ui.tsx`
- Create: `panels/pull-requests/ui.module.css`
- Modify: `server/src/routes.ts`
- Modify: `web/src/panels.ts`

- [ ] **Step 1: Create `panels/pull-requests/package.json`**

```json
{
  "name": "@cc/panel-pull-requests",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    "./ui": "./ui.tsx",
    "./api": "./api.ts",
    "./meta": "./meta.ts",
    "./types": "./types.ts"
  },
  "scripts": { "test": "vitest run" },
  "dependencies": {
    "@cc/server": "workspace:*",
    "@cc/shared": "workspace:*",
    "@tanstack/react-query": "^5.62.2",
    "hono": "^4.6.14",
    "react": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.12",
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create `panels/pull-requests/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["**/*.ts", "**/*.tsx"]
}
```

- [ ] **Step 3: Create `panels/pull-requests/meta.ts`**

```ts
import type { PanelMeta } from '@cc/shared';

export const meta: PanelMeta = {
  id: 'pull-requests',
  title: 'Pull Requests',
  order: 20,
  defaultSize: 'md',
};
```

- [ ] **Step 4: Create `panels/pull-requests/types.ts`**

```ts
export type PRCheckState = 'SUCCESS' | 'FAILURE' | 'PENDING' | 'NEUTRAL' | null;
export type PRReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;

export type PR = {
  number: number;
  title: string;
  url: string;
  repo: string;
  createdAt: string;
  updatedAt: string;
  isDraft: boolean;
  reviewDecision: PRReviewDecision;
  checks: PRCheckState;
};

export type ListResponse = { authored: PR[]; reviewRequested: PR[] };
```

- [ ] **Step 5: Write failing API test**

Create `panels/pull-requests/api.test.ts`:

```ts
import { describe, expect, test, vi } from 'vitest';

vi.mock('@cc/server/lib/gh', () => ({
  graphql: vi.fn(async () => ({
    viewer: {
      login: 'me',
      pullRequests: {
        nodes: [
          {
            number: 1, title: 'a', url: 'u', isDraft: false,
            createdAt: 'c', updatedAt: 'up', reviewDecision: 'APPROVED',
            repository: { nameWithOwner: 'o/r' },
            commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] },
          },
        ],
      },
    },
    search: {
      nodes: [
        {
          number: 2, title: 'b', url: 'u2', isDraft: true,
          createdAt: 'c2', updatedAt: 'u2', reviewDecision: null,
          repository: { nameWithOwner: 'o/r2' },
          commits: { nodes: [] },
        },
      ],
    },
  })),
  GhError: class extends Error { code = 'X'; },
}));

describe('pull-requests api', () => {
  test('GET / maps graphql payload to envelope', async () => {
    const { api } = await import('./api');
    const res = await api.request('/');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.authored).toHaveLength(1);
    expect(body.data.authored[0]).toMatchObject({ number: 1, repo: 'o/r', checks: 'SUCCESS', reviewDecision: 'APPROVED' });
    expect(body.data.reviewRequested[0]).toMatchObject({ number: 2, repo: 'o/r2', checks: null, isDraft: true });
  });

  test('GH_AUTH_MISSING surfaces as 401-like envelope', async () => {
    const gh = await import('@cc/server/lib/gh');
    (gh.graphql as any).mockRejectedValueOnce(Object.assign(new Error('no auth'), { code: 'GH_AUTH_MISSING' }));
    const { api } = await import('./api');
    const res = await api.request('/');
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ ok: false, error: { code: 'GH_AUTH_MISSING' } });
  });
});
```

- [ ] **Step 6: Run test — verify fail**

Run: `pnpm --filter @cc/panel-pull-requests test`
Expected: `api` missing.

- [ ] **Step 7: Create `panels/pull-requests/api.ts`**

```ts
import { Hono } from 'hono';
import { ok, fail } from '@cc/server/envelope';
import { graphql, GhError } from '@cc/server/lib/gh';
import type { PR, ListResponse } from './types';

const QUERY = `
query DashboardPRs {
  viewer {
    login
    pullRequests(first: 50, states: OPEN, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes {
        number title url isDraft createdAt updatedAt reviewDecision
        repository { nameWithOwner }
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      }
    }
  }
  search(query: "is:pr is:open review-requested:@me", type: ISSUE, first: 50) {
    nodes {
      ... on PullRequest {
        number title url isDraft createdAt updatedAt reviewDecision
        repository { nameWithOwner }
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      }
    }
  }
}`;

type RawNode = {
  number: number; title: string; url: string; isDraft: boolean;
  createdAt: string; updatedAt: string; reviewDecision: PR['reviewDecision'];
  repository: { nameWithOwner: string };
  commits: { nodes: Array<{ commit: { statusCheckRollup: { state: PR['checks'] } | null } }> };
};

type RawResponse = {
  viewer: { pullRequests: { nodes: RawNode[] } };
  search: { nodes: RawNode[] };
};

function mapNode(n: RawNode): PR {
  return {
    number: n.number,
    title: n.title,
    url: n.url,
    repo: n.repository.nameWithOwner,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    isDraft: n.isDraft,
    reviewDecision: n.reviewDecision,
    checks: n.commits.nodes[0]?.commit.statusCheckRollup?.state ?? null,
  };
}

export const api = new Hono();

api.get('/', async (c) => {
  try {
    const data = await graphql<RawResponse>(QUERY);
    const body: ListResponse = {
      authored: data.viewer.pullRequests.nodes.map(mapNode),
      reviewRequested: data.search.nodes.map(mapNode),
    };
    return c.json(ok(body));
  } catch (err) {
    if (err instanceof GhError) {
      const status = err.code === 'GH_AUTH_MISSING' ? 401 : 500;
      return c.json(fail(err.code, err.message), status);
    }
    throw err;
  }
});
```

- [ ] **Step 8: Run test — verify pass**

Run: `pnpm install && pnpm --filter @cc/panel-pull-requests test`
Expected: 2 passing.

- [ ] **Step 9: Create `panels/pull-requests/ui.module.css`**

```css
.section { margin-bottom: 16px; }
.sectionHead { font-family: 'Orbitron', sans-serif; color: var(--cyan); letter-spacing: 1.5px; font-size: 12px; padding: 4px 0; text-transform: uppercase; }
.row { display: flex; gap: 8px; align-items: center; font-size: 12px; }
.repo { color: var(--fg-dim); font-family: 'VT323', monospace; font-size: 14px; min-width: 80px; }
.num { color: var(--pink); font-weight: bold; }
.title { flex: 1; color: var(--fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.title:hover { color: var(--cyan); text-decoration: underline; }
.badges { display: flex; gap: 3px; }
```

- [ ] **Step 10: Create `panels/pull-requests/ui.tsx`**

```tsx
import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '../../web/src/lib/fetchJson';
import s from './ui.module.css';
import type { ListResponse, PR } from './types';

function checkBadge(c: PR['checks']) {
  if (c === 'SUCCESS') return <span className="badge badge--success">✓</span>;
  if (c === 'FAILURE') return <span className="badge badge--danger">✗</span>;
  if (c === 'PENDING') return <span className="badge badge--warn">…</span>;
  return null;
}

function reviewBadge(d: PR['reviewDecision']) {
  if (d === 'APPROVED') return <span className="badge badge--success">approved</span>;
  if (d === 'CHANGES_REQUESTED') return <span className="badge badge--danger">changes</span>;
  if (d === 'REVIEW_REQUIRED') return <span className="badge badge--warn">needs review</span>;
  return null;
}

function Row({ pr }: { pr: PR }) {
  return (
    <div className="panel-row">
      <span className={s.repo}>{pr.repo}</span>
      <span className={s.num}>#{pr.number}</span>
      <a className={s.title} href={pr.url} target="_blank" rel="noopener noreferrer">{pr.title}</a>
      <span className={s.badges}>
        {pr.isDraft && <span className="badge">draft</span>}
        {reviewBadge(pr.reviewDecision)}
        {checkBadge(pr.checks)}
      </span>
    </div>
  );
}

export const UI = () => {
  const { data, isLoading, error, refetch } = useQuery<ListResponse>({
    queryKey: ['pull-requests'],
    queryFn: () => fetchJson<ListResponse>('/api/pull-requests'),
  });

  return (
    <div className="panel">
      <div className="panel-header">
        Pull Requests
        <button type="button" className="panel-refresh" onClick={() => refetch()}>refresh</button>
      </div>
      <div className="panel-body">
        {isLoading && <p style={{ color: 'var(--fg-dim)' }}>loading…</p>}
        {error && <p style={{ color: 'var(--danger)' }}>{(error as Error).message}</p>}
        {data && (
          <>
            <div className={s.section}>
              <div className={s.sectionHead}>Yours ({data.authored.length})</div>
              {data.authored.length === 0 && <p style={{ color: 'var(--fg-dim)' }}>none</p>}
              {data.authored.map((pr) => <Row key={`${pr.repo}-${pr.number}`} pr={pr} />)}
            </div>
            <div className={s.section}>
              <div className={s.sectionHead}>To Review ({data.reviewRequested.length})</div>
              {data.reviewRequested.length === 0 && <p style={{ color: 'var(--fg-dim)' }}>none</p>}
              {data.reviewRequested.map((pr) => <Row key={`${pr.repo}-${pr.number}`} pr={pr} />)}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
```

- [ ] **Step 11: Register panel and route**

Update `server/src/routes.ts`:

```ts
import type { Hono } from 'hono';
import { api as worktreesApi } from '../../panels/worktrees/api';
import { api as prsApi } from '../../panels/pull-requests/api';

export function registerRoutes(app: Hono): void {
  app.route('/api/worktrees', worktreesApi);
  app.route('/api/pull-requests', prsApi);
}
```

Update `web/src/panels.ts`:

```ts
import type { PanelMeta, PanelUI } from '@cc/shared';
import { UI as worktreesUI } from '../../panels/worktrees/ui';
import { meta as worktreesMeta } from '../../panels/worktrees/meta';
import { UI as prsUI } from '../../panels/pull-requests/ui';
import { meta as prsMeta } from '../../panels/pull-requests/meta';

export type PanelEntry = { meta: PanelMeta; UI: PanelUI };

export const panels: PanelEntry[] = [
  { meta: worktreesMeta, UI: worktreesUI },
  { meta: prsMeta, UI: prsUI },
];
```

- [ ] **Step 12: Verify end-to-end**

Run: `pnpm dev`
Open http://localhost:5173. Pull Requests panel should list your open PRs and review-requested PRs (requires `gh auth status` to be logged in).
Stop.

- [ ] **Step 13: Commit**

```bash
git add panels/pull-requests/ server/src/routes.ts web/src/panels.ts package.json pnpm-lock.yaml
git commit -m "feat(panels): pull-requests panel via gh GraphQL with checks and review badges"
```

---

## Task 12: Shortcuts panel — config file + meta + types + API + UI

**Files:**
- Create: `config/shortcuts.json`
- Create: `config/logos/.gitkeep`
- Create: `panels/shortcuts/package.json`
- Create: `panels/shortcuts/tsconfig.json`
- Create: `panels/shortcuts/meta.ts`
- Create: `panels/shortcuts/types.ts`
- Create: `panels/shortcuts/api.ts`
- Create: `panels/shortcuts/api.test.ts`
- Create: `panels/shortcuts/ui.tsx`
- Create: `panels/shortcuts/ui.module.css`
- Modify: `server/src/routes.ts`
- Modify: `web/src/panels.ts`

- [ ] **Step 1: Create `config/shortcuts.json`**

```json
[
  { "id": "asana",     "label": "Asana",     "logo": "asana.svg",
    "links": [
      { "label": "My tasks", "url": "https://app.asana.com/0/me" },
      { "label": "Inbox",    "url": "https://app.asana.com/0/inbox" }
    ] },
  { "id": "stripe",    "label": "Stripe",    "logo": "stripe.svg",
    "links": [{ "label": "Dashboard", "url": "https://dashboard.stripe.com" }] },
  { "id": "snowflake", "label": "Snowflake", "logo": "snowflake.svg",
    "links": [{ "label": "Worksheet", "url": "https://app.snowflake.com" }] },
  { "id": "dbt",       "label": "dbt",       "logo": "dbt.svg",
    "links": [{ "label": "Cloud", "url": "https://cloud.getdbt.com" }] },
  { "id": "segment",   "label": "Segment",   "logo": "segment.svg",
    "links": [{ "label": "App", "url": "https://app.segment.com" }] },
  { "id": "amplitude", "label": "Amplitude", "logo": "amplitude.svg",
    "links": [{ "label": "App", "url": "https://app.amplitude.com" }] }
]
```

- [ ] **Step 2: Create `config/logos/.gitkeep`** (empty placeholder — user drops SVGs here later)

- [ ] **Step 3: Create `panels/shortcuts/package.json`**

```json
{
  "name": "@cc/panel-shortcuts",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    "./ui": "./ui.tsx",
    "./api": "./api.ts",
    "./meta": "./meta.ts",
    "./types": "./types.ts"
  },
  "scripts": { "test": "vitest run" },
  "dependencies": {
    "@cc/server": "workspace:*",
    "@cc/shared": "workspace:*",
    "@tanstack/react-query": "^5.62.2",
    "hono": "^4.6.14",
    "react": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.12",
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 4: Create `panels/shortcuts/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["**/*.ts", "**/*.tsx"]
}
```

- [ ] **Step 5: Create `panels/shortcuts/meta.ts`**

```ts
import type { PanelMeta } from '@cc/shared';

export const meta: PanelMeta = {
  id: 'shortcuts',
  title: 'Shortcuts',
  order: 30,
  defaultSize: 'md',
};
```

- [ ] **Step 6: Create `panels/shortcuts/types.ts`**

```ts
export type ShortcutLink = { label: string; url: string };
export type Shortcut = {
  id: string;
  label: string;
  logo?: string;
  links: ShortcutLink[];
};
```

- [ ] **Step 7: Write failing API test**

Create `panels/shortcuts/api.test.ts`:

```ts
import { describe, expect, test, vi } from 'vitest';

vi.mock('node:fs/promises', async (orig) => {
  const actual = await (orig() as Promise<typeof import('node:fs/promises')>);
  return {
    ...actual,
    readFile: vi.fn(async () => JSON.stringify([
      { id: 'asana', label: 'Asana', links: [{ label: 'Home', url: 'https://app.asana.com' }] },
    ])),
  };
});

describe('shortcuts api', () => {
  test('GET / returns envelope of shortcuts', async () => {
    const { api } = await import('./api');
    const res = await api.request('/');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data).toEqual([{ id: 'asana', label: 'Asana', links: [{ label: 'Home', url: 'https://app.asana.com' }] }]);
  });
});
```

- [ ] **Step 8: Run test — verify fail**

Run: `pnpm --filter @cc/panel-shortcuts test`
Expected: `api` missing.

- [ ] **Step 9: Create `panels/shortcuts/api.ts`**

```ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { ok, fail } from '@cc/server/envelope';
import type { Shortcut } from './types';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = path.resolve(HERE, '..', '..', 'config', 'shortcuts.json');

export const api = new Hono();

api.get('/', async (c) => {
  try {
    const raw = await readFile(CONFIG, 'utf8');
    const data = JSON.parse(raw) as Shortcut[];
    return c.json(ok(data));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json(fail('SHORTCUTS_READ_FAILED', msg.slice(0, 200)), 500);
  }
});
```

- [ ] **Step 10: Run test — verify pass**

Run: `pnpm install && pnpm --filter @cc/panel-shortcuts test`
Expected: passing.

- [ ] **Step 11: Create `panels/shortcuts/ui.module.css`**

```css
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(80px, 1fr)); gap: 12px; }
.tile {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 10px;
  background: rgba(255, 113, 206, 0.08);
  border: 1px solid rgba(255, 113, 206, 0.35);
  border-radius: 4px;
  cursor: pointer;
  color: var(--fg);
  text-decoration: none;
}
.tile:hover { background: rgba(1, 205, 254, 0.15); border-color: var(--cyan); box-shadow: var(--glow-cyan); }
.logo { width: 40px; height: 40px; object-fit: contain; }
.placeholder {
  width: 40px; height: 40px;
  border: 1px solid var(--pink);
  display: flex; align-items: center; justify-content: center;
  font-family: 'Orbitron', sans-serif; font-size: 14px; color: var(--pink);
  text-shadow: var(--glow-pink);
}
.label { font-size: 11px; color: var(--fg-dim); text-align: center; }
.popover {
  position: absolute; background: var(--bg-mid); border: 1px solid var(--pink);
  box-shadow: var(--glow-pink); padding: 6px; z-index: 50; min-width: 140px;
}
.popoverItem {
  display: block; padding: 4px 8px; color: var(--fg); text-decoration: none; font-size: 12px;
}
.popoverItem:hover { background: rgba(1, 205, 254, 0.15); color: var(--cyan); }
```

- [ ] **Step 12: Create `panels/shortcuts/ui.tsx`**

```tsx
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { fetchJson } from '../../web/src/lib/fetchJson';
import s from './ui.module.css';
import type { Shortcut } from './types';

function Logo({ shortcut }: { shortcut: Shortcut }) {
  const [broken, setBroken] = useState(false);
  if (!shortcut.logo || broken) {
    return <div className={s.placeholder}>{shortcut.label.slice(0, 2).toUpperCase()}</div>;
  }
  return (
    <img
      className={s.logo}
      src={`/logos/${shortcut.logo}`}
      alt={shortcut.label}
      onError={() => setBroken(true)}
    />
  );
}

function Tile({ shortcut }: { shortcut: Shortcut }) {
  const [openPopover, setOpenPopover] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openPopover) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpenPopover(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenPopover(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [openPopover]);

  if (shortcut.links.length === 1) {
    const link = shortcut.links[0]!;
    return (
      <a className={s.tile} href={link.url} target="_blank" rel="noopener noreferrer">
        <Logo shortcut={shortcut} />
        <span className={s.label}>{shortcut.label}</span>
      </a>
    );
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        className={s.tile}
        onClick={() => setOpenPopover((o) => !o)}
      >
        <Logo shortcut={shortcut} />
        <span className={s.label}>{shortcut.label}</span>
      </button>
      {openPopover && (
        <div className={s.popover}>
          {shortcut.links.map((l) => (
            <a key={l.url} className={s.popoverItem} href={l.url} target="_blank" rel="noopener noreferrer">
              {l.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export const UI = () => {
  const { data, isLoading, error, refetch } = useQuery<Shortcut[]>({
    queryKey: ['shortcuts'],
    queryFn: () => fetchJson<Shortcut[]>('/api/shortcuts'),
  });

  return (
    <div className="panel">
      <div className="panel-header">
        Shortcuts
        <button type="button" className="panel-refresh" onClick={() => refetch()}>refresh</button>
      </div>
      <div className="panel-body">
        {isLoading && <p style={{ color: 'var(--fg-dim)' }}>loading…</p>}
        {error && <p style={{ color: 'var(--danger)' }}>{(error as Error).message}</p>}
        {data && (
          <div className={s.grid}>
            {data.map((sh) => <Tile key={sh.id} shortcut={sh} />)}
          </div>
        )}
      </div>
    </div>
  );
};
```

- [ ] **Step 13: Register panel + route + logo static serving**

Update `server/src/routes.ts`:

```ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Hono } from 'hono';
import { api as worktreesApi } from '../../panels/worktrees/api';
import { api as prsApi } from '../../panels/pull-requests/api';
import { api as shortcutsApi } from '../../panels/shortcuts/api';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOGOS = path.resolve(HERE, '..', '..', 'config', 'logos');

export function registerRoutes(app: Hono): void {
  app.route('/api/worktrees', worktreesApi);
  app.route('/api/pull-requests', prsApi);
  app.route('/api/shortcuts', shortcutsApi);
  app.use('/logos/*', serveStatic({ root: LOGOS, rewriteRequestPath: (p) => p.replace(/^\/logos/, '') }));
}
```

Update `web/vite.config.ts` to also proxy `/logos`:

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:7778', changeOrigin: true },
      '/logos': { target: 'http://127.0.0.1:7778', changeOrigin: true },
    },
  },
  test: { environment: 'jsdom', setupFiles: ['./src/test-setup.ts'] },
});
```

Update `web/src/panels.ts`:

```ts
import type { PanelMeta, PanelUI } from '@cc/shared';
import { UI as worktreesUI } from '../../panels/worktrees/ui';
import { meta as worktreesMeta } from '../../panels/worktrees/meta';
import { UI as prsUI } from '../../panels/pull-requests/ui';
import { meta as prsMeta } from '../../panels/pull-requests/meta';
import { UI as shortcutsUI } from '../../panels/shortcuts/ui';
import { meta as shortcutsMeta } from '../../panels/shortcuts/meta';

export type PanelEntry = { meta: PanelMeta; UI: PanelUI };

export const panels: PanelEntry[] = [
  { meta: worktreesMeta, UI: worktreesUI },
  { meta: prsMeta, UI: prsUI },
  { meta: shortcutsMeta, UI: shortcutsUI },
];
```

- [ ] **Step 14: Verify end-to-end**

Run: `pnpm dev`
Open http://localhost:5173. All three panels render; shortcuts shows 6 tiles, each with a 2-letter placeholder (no SVGs yet). Click a multi-link tile (Asana) → popover appears.
Stop.

- [ ] **Step 15: Commit**

```bash
git add panels/shortcuts/ config/ server/ web/ package.json pnpm-lock.yaml
git commit -m "feat(panels): shortcuts panel with config-driven tiles and logo static serving"
```

---

## Task 13: Prod build — Hono serves `web/dist` from port 7777

**Files:**
- Modify: `server/src/main.ts`
- Modify: `server/package.json` (add `@hono/node-server` serve-static, ensure already a dep)

- [ ] **Step 1: Modify `server/src/main.ts`** to serve static assets in prod

```ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import pkg from '../package.json' with { type: 'json' };
import { ok } from './envelope';
import { logger } from './logger';
import { registerRoutes } from './routes';

const startedAt = new Date().toISOString();
const app = new Hono();

app.get('/api/health', (c) =>
  c.json(
    ok({
      uptime: Math.floor((Date.now() - Date.parse(startedAt)) / 1000),
      version: pkg.version,
      startedAt,
    }),
  ),
);

registerRoutes(app);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.resolve(HERE, '..', '..', 'web', 'dist');

if (process.env.SERVE_STATIC !== 'false') {
  app.use('/*', serveStatic({ root: WEB_DIST }));
  app.get('*', serveStatic({ path: path.join(WEB_DIST, 'index.html') }));
}

app.onError((err, c) => {
  logger.error({ err: err.message, stack: err.stack }, 'unhandled');
  return c.json({ ok: false, error: { code: 'INTERNAL', message: err.message } }, 500);
});

const port = Number(process.env.PORT ?? 7777);
const hostname = process.env.BIND_HOST ?? '127.0.0.1';

serve({ fetch: app.fetch, port, hostname }, (info) => {
  logger.info({ port: info.port, hostname }, 'server ready');
});
```

Note: in dev, we set `SERVE_STATIC=false PORT=7778` so Vite serves the UI; in prod it stays on 7777 and serves `web/dist`.

- [ ] **Step 2: Update `server/package.json` dev script**

```json
"scripts": {
  "dev": "SERVE_STATIC=false PORT=7778 tsx watch src/main.ts",
  "build": "tsc -p tsconfig.json",
  "start": "node dist/main.js",
  "test": "vitest run"
}
```

- [ ] **Step 3: Build and verify prod mode**

Run:
```bash
pnpm build
node server/dist/main.js
```

In another terminal: `curl -s http://127.0.0.1:7777/api/health | jq`
Expected: healthy response.
Then: `open http://localhost:7777` — dashboard renders with all three panels.
Stop the server (Ctrl-C).

- [ ] **Step 4: Commit**

```bash
git add server/
git commit -m "feat(server): prod mode serves web/dist on :7777 with SPA fallback"
```

---

## Task 14: launchd integration — install/uninstall scripts

**Files:**
- Create: `scripts/install-launchd.sh`
- Create: `scripts/uninstall-launchd.sh`
- Create: `scripts/redeploy.sh`

- [ ] **Step 1: Create `scripts/install-launchd.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_BIN="$(command -v node)"
PLIST_LABEL="io.unito.control-center"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_LABEL.plist"
LOG_DIR="$HOME/Library/Logs"
LOG_FILE="$LOG_DIR/control-center.log"

if [[ -z "$NODE_BIN" ]]; then
  echo "error: node not found in PATH" >&2
  exit 1
fi

mkdir -p "$LOG_DIR"
mkdir -p "$(dirname "$PLIST_PATH")"

cat >"$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$PLIST_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$REPO_DIR/server/dist/main.js</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO_DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    <key>PORT</key><string>7777</string>
    <key>BIND_HOST</key><string>127.0.0.1</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG_FILE</string>
  <key>StandardErrorPath</key><string>$LOG_FILE</string>
</dict>
</plist>
PLIST

launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load "$PLIST_PATH"

echo "installed $PLIST_LABEL"
echo "logs: $LOG_FILE"
echo "open http://localhost:7777"
```

- [ ] **Step 2: Create `scripts/uninstall-launchd.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

PLIST_LABEL="io.unito.control-center"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_LABEL.plist"

launchctl unload "$PLIST_PATH" 2>/dev/null || true
rm -f "$PLIST_PATH"
echo "uninstalled $PLIST_LABEL (logs preserved)"
```

- [ ] **Step 3: Create `scripts/redeploy.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

pnpm install
pnpm build
launchctl kickstart -k "gui/$(id -u)/io.unito.control-center"
echo "redeployed — http://localhost:7777"
```

- [ ] **Step 4: Make scripts executable**

Run: `chmod +x scripts/install-launchd.sh scripts/uninstall-launchd.sh scripts/redeploy.sh`

- [ ] **Step 5: Install and verify daemon**

Run: `scripts/install-launchd.sh`
Then: `curl -s http://localhost:7777/api/health | jq`
Expected: healthy response.
Then: `launchctl list | grep control-center`
Expected: one line showing the label.
Open http://localhost:7777 — dashboard renders.

- [ ] **Step 6: Commit**

```bash
git add scripts/
git commit -m "feat(scripts): launchd install/uninstall + redeploy"
```

---

## Task 15: Verify acceptance criteria + final README polish

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Run test suite**

Run: `pnpm test`
Expected: all tests pass across all workspaces.

- [ ] **Step 2: Run lint**

Run: `pnpm check`
Expected: no issues (if there are formatting issues, run `pnpm fix` and commit separately).

- [ ] **Step 3: Manual acceptance walk-through**

Open http://localhost:7777. Verify:
- Three panels render in retrowave style.
- Worktrees panel lists actual worktrees with badges and delete flow.
- Pull Requests panel lists authored + review-requested PRs.
- Shortcuts panel shows 6 tiles with placeholders (or logos if dropped in `config/logos/`).
- Tab focus triggers refetch after being away >10s.
- `kill $(pgrep -f server/dist/main.js)` → launchd restarts it within ~10s.

- [ ] **Step 4: Flesh out `README.md`**

```markdown
# Control Center

Local dev dashboard — worktrees, PRs, tool shortcuts. Retrowave themed. Solo local use only.

## Requirements

- macOS (launchd)
- Node 22 LTS (`nvm use`)
- pnpm 9
- `gh` CLI authenticated (`gh auth login`)

## Dev

```bash
pnpm install
pnpm dev
```

Open http://localhost:5173. API proxies to http://localhost:7778.

## Prod (daemon)

```bash
pnpm build
scripts/install-launchd.sh
```

Open http://localhost:7777. Logs at `~/Library/Logs/control-center.log`.

To update:

```bash
git pull
scripts/redeploy.sh
```

To uninstall the daemon:

```bash
scripts/uninstall-launchd.sh
```

## Add a panel

1. Create `panels/<id>/{ui.tsx,api.ts,meta.ts,types.ts,package.json,tsconfig.json}`.
2. Add a line to `web/src/panels.ts` and `server/src/routes.ts`.
3. `pnpm install && pnpm test`.

See existing panels under `panels/` for reference.

## Customizing shortcuts

Edit `config/shortcuts.json`. Drop SVG logos in `config/logos/` matching the `logo` field. Refresh the browser.

## Testing

```bash
pnpm test      # all workspaces
pnpm check     # biome lint
pnpm fix       # biome autofix
```
```

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: flesh out README with dev, prod, panel-extension, and shortcuts guidance"
```

---

## Self-Review

**Spec coverage (§15 acceptance criteria):**
- ✅ Install flow → Tasks 1, 13, 14
- ✅ Dashboard renders three panels → Task 15 manual check
- ✅ Worktree list + badges + delete (+ force) → Tasks 7, 8, 9
- ✅ PR panel authored + review-requested → Tasks 10, 11
- ✅ Shortcuts + config editing → Task 12
- ✅ Focus refetch → Task 6 (staleTime 10s + refetchOnWindowFocus)
- ✅ launchd restart on kill → Task 14
- ✅ `pnpm test` green → Task 15

**Placeholder scan:** no TBD/TODO/"fill in later" — each step has concrete code or concrete command.

**Type consistency:** `Worktree`, `Repo`, `PR`, `Shortcut`, `Envelope`, `PanelMeta` are defined once in shared or panel `types.ts` and reused consistently. The `Worktree` definition in `server/src/lib/git.ts` matches the panel's `types.ts` shape (both derived from the same spec Section 6.1 table).

**Known risks for the executor:**
- Workspace package exports need `pnpm install` to re-resolve after adding `exports` fields to `server/package.json` in Task 9 — the step says to run `pnpm install`, worth emphasizing.
- `@fontsource/*` packages must resolve to woff2 assets Vite can inline — verify in Step 3 of Task 5.
- The `node:fs/promises` `glob` API requires Node 22 — already pinned via `.nvmrc` and `engines`.
