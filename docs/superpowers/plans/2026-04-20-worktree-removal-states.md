# Worktree Removal — State-Aware Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Classify each worktree as `merged | pr-pending | unpushed | dirty` and let the user remove the folder alone, or remove the folder + delete the local branch, in a single modal with a sensible pre-selected default per state.

**Architecture:** Pure classification function in `@cc/shared` consumed by the panel UI. Server-side `removeWorktree` extended with a `deleteBranch` option that resolves the branch name *before* folder removal and returns a `{ branchDeleted, branchDeleteError? }` shape supporting partial success. API stays a single `DELETE /api/worktrees` endpoint for atomic UX.

**Tech Stack:** TypeScript (strict), Hono, React 18 + TanStack Query, Vitest, Biome, pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-04-20-worktree-removal-states-design.md`

---

## File Structure

**New:**
- `shared/worktree-state.ts` — `WorktreeState` type + `classifyWorktreeState` pure function
- `panels/worktrees/state.test.ts` — unit tests for the classifier (colocated here because `@cc/shared` has no vitest setup; this panel already runs vitest and is the only consumer)

**Changed:**
- `shared/index.ts` — re-export from `./worktree-state`
- `server/src/lib/git.ts` — extend `removeWorktree` signature + return value
- `server/src/lib/git.test.ts` — new cases for `deleteBranch`
- `panels/worktrees/api.ts` — pass-through `deleteBranch`, return new fields
- `panels/worktrees/api.test.ts` — new cases covering new shape
- `panels/worktrees/ui.tsx` — state pill, three buttons, partial-success surface
- `panels/worktrees/ui.module.css` — state-pill styles, disabled-button style, warning style

---

## Task 1: Add `classifyWorktreeState` classifier

**Files:**
- Create: `shared/worktree-state.ts`
- Modify: `shared/index.ts`
- Test: `panels/worktrees/state.test.ts`

Classifier takes a structural input (not the full `Worktree` type) so `shared/` doesn't depend on panel-specific types.

- [ ] **Step 1: Write the failing tests**

Create `panels/worktrees/state.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { classifyWorktreeState } from '@cc/shared';

const base = {
  dirty: false,
  mergedToMain: false,
  ahead: 0,
  hasUpstream: true,
};

describe('classifyWorktreeState', () => {
  test('dirty wins over merged (data safety)', () => {
    expect(
      classifyWorktreeState({ ...base, dirty: true, mergedToMain: true }),
    ).toBe('dirty');
  });

  test('dirty wins when ahead > 0', () => {
    expect(
      classifyWorktreeState({ ...base, dirty: true, ahead: 3 }),
    ).toBe('dirty');
  });

  test('merged when clean and mergedToMain', () => {
    expect(
      classifyWorktreeState({ ...base, mergedToMain: true }),
    ).toBe('merged');
  });

  test('unpushed when ahead > 0 and not merged', () => {
    expect(classifyWorktreeState({ ...base, ahead: 2 })).toBe('unpushed');
  });

  test('unpushed when no upstream and clean', () => {
    expect(
      classifyWorktreeState({ ...base, hasUpstream: false }),
    ).toBe('unpushed');
  });

  test('pr-pending when clean, has upstream, ahead 0, not merged', () => {
    expect(classifyWorktreeState(base)).toBe('pr-pending');
  });

  test('pr-pending when only behind (ahead 0, behind > 0 is irrelevant)', () => {
    // behind is not part of the classifier input — this just documents the
    // contract: classification does not depend on behind.
    expect(classifyWorktreeState(base)).toBe('pr-pending');
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
pnpm --filter @cc/panel-worktrees test state.test
```
Expected: all tests fail with `Cannot find module '@cc/shared'` export for `classifyWorktreeState` (export doesn't exist yet).

- [ ] **Step 3: Implement the classifier**

Create `shared/worktree-state.ts`:

```ts
export type WorktreeState = 'merged' | 'pr-pending' | 'unpushed' | 'dirty';

export type WorktreeClassifiable = Readonly<{
  dirty: boolean;
  mergedToMain: boolean;
  ahead: number;
  hasUpstream: boolean;
}>;

export function classifyWorktreeState(w: WorktreeClassifiable): WorktreeState {
  if (w.dirty) return 'dirty';
  if (w.mergedToMain) return 'merged';
  if (w.ahead > 0 || !w.hasUpstream) return 'unpushed';
  return 'pr-pending';
}
```

- [ ] **Step 4: Export from shared barrel**

Edit `shared/index.ts`:

```ts
export * from './panel';
export * from './worktree-state';
```

- [ ] **Step 5: Run tests — confirm they pass**

```bash
pnpm --filter @cc/panel-worktrees test state.test
```
Expected: all 7 tests pass.

- [ ] **Step 6: Commit**

```bash
git add shared/worktree-state.ts shared/index.ts panels/worktrees/state.test.ts
git commit -m "feat(shared): add classifyWorktreeState pure function"
```

---

## Task 2: Extend `removeWorktree` with `deleteBranch` option

**Files:**
- Modify: `server/src/lib/git.ts` (the `removeWorktree` function, currently lines 193-215)
- Test: `server/src/lib/git.test.ts` (extend the `describe('removeWorktree', …)` block)

Must resolve branch name *before* folder removal (git cannot read a deleted worktree). Partial success — folder removed but `branch -D` failed — returns `branchDeleted: null` + `branchDeleteError`, does **not** throw.

- [ ] **Step 1: Write the failing tests**

Append these tests inside the existing `describe('removeWorktree', …)` in `server/src/lib/git.test.ts`:

```ts
test('deleteBranch: resolves branch name then runs branch -D after remove', async () => {
  const calls: string[][] = [];
  const runner: Runner = async (_cmd, args) => {
    calls.push(args);
    if (args.includes('status')) return { stdout: '', stderr: '' };
    if (args.join(' ').includes('rev-parse --abbrev-ref'))
      return { stdout: 'feat/x\n', stderr: '' };
    return { stdout: '', stderr: '' };
  };
  const { removeWorktree } = await import('./git');
  const result = await removeWorktree('/w/proj/.worktrees/x', {
    force: false,
    deleteBranch: true,
    runner,
  });
  expect(result).toEqual({ branchDeleted: 'feat/x' });

  // Order matters: rev-parse → status → worktree remove → branch -D
  const cmdNames = calls.map((a) => a.filter((s) => !s.startsWith('/')).join(' '));
  const revParseIdx = cmdNames.findIndex((s) => s.includes('rev-parse --abbrev-ref'));
  const removeIdx = cmdNames.findIndex((s) => s.includes('worktree remove'));
  const branchDelIdx = cmdNames.findIndex((s) => s.includes('branch -D'));
  expect(revParseIdx).toBeGreaterThanOrEqual(0);
  expect(removeIdx).toBeGreaterThan(revParseIdx);
  expect(branchDelIdx).toBeGreaterThan(removeIdx);

  const branchCall = calls.find((a) => a.includes('-D'));
  expect(branchCall).toEqual(['-C', '/w/proj', 'branch', '-D', 'feat/x']);
});

test('deleteBranch: returns branchDeleteError when branch -D fails (no throw)', async () => {
  const runner: Runner = async (_cmd, args) => {
    if (args.includes('status')) return { stdout: '', stderr: '' };
    if (args.join(' ').includes('rev-parse --abbrev-ref'))
      return { stdout: 'feat/x\n', stderr: '' };
    if (args.includes('-D')) throw new Error('branch not found');
    return { stdout: '', stderr: '' };
  };
  const { removeWorktree } = await import('./git');
  const result = await removeWorktree('/w/proj/.worktrees/x', {
    force: false,
    deleteBranch: true,
    runner,
  });
  expect(result.branchDeleted).toBeNull();
  expect(result.branchDeleteError).toMatch(/branch not found/);
});

test('deleteBranch: skips branch -D when HEAD is detached', async () => {
  const calls: string[][] = [];
  const runner: Runner = async (_cmd, args) => {
    calls.push(args);
    if (args.includes('status')) return { stdout: '', stderr: '' };
    if (args.join(' ').includes('rev-parse --abbrev-ref'))
      return { stdout: 'HEAD\n', stderr: '' };
    return { stdout: '', stderr: '' };
  };
  const { removeWorktree } = await import('./git');
  const result = await removeWorktree('/w/proj/.worktrees/x', {
    force: false,
    deleteBranch: true,
    runner,
  });
  expect(result).toEqual({ branchDeleted: null });
  expect(calls.some((a) => a.includes('-D'))).toBe(false);
});

test('deleteBranch: force + deleteBranch runs all three git calls', async () => {
  const calls: string[][] = [];
  const runner: Runner = async (_cmd, args) => {
    calls.push(args);
    if (args.includes('status')) return { stdout: ' M f\n', stderr: '' };
    if (args.join(' ').includes('rev-parse --abbrev-ref'))
      return { stdout: 'feat/x\n', stderr: '' };
    return { stdout: '', stderr: '' };
  };
  const { removeWorktree } = await import('./git');
  const result = await removeWorktree('/w/proj/.worktrees/x', {
    force: true,
    deleteBranch: true,
    runner,
  });
  expect(result).toEqual({ branchDeleted: 'feat/x' });
  expect(calls.find((a) => a.includes('remove'))).toEqual([
    '-C',
    '/w/proj',
    'worktree',
    'remove',
    '--force',
    '/w/proj/.worktrees/x',
  ]);
  expect(calls.find((a) => a.includes('-D'))).toEqual([
    '-C',
    '/w/proj',
    'branch',
    '-D',
    'feat/x',
  ]);
});

test('deleteBranch: default false preserves legacy return shape', async () => {
  const runner: Runner = async (_cmd, args) => {
    if (args.includes('status')) return { stdout: '', stderr: '' };
    return { stdout: '', stderr: '' };
  };
  const { removeWorktree } = await import('./git');
  const result = await removeWorktree('/w/proj/.worktrees/x', {
    force: false,
    deleteBranch: false,
    runner,
  });
  expect(result).toEqual({ branchDeleted: null });
});
```

- [ ] **Step 2: Run tests — confirm new tests fail**

```bash
pnpm --filter @cc/server test git.test
```
Expected: the five new tests fail (current signature does not accept `deleteBranch` and returns `void`).

- [ ] **Step 3: Implement the extension**

Replace the current `removeWorktree` in `server/src/lib/git.ts` (currently lines 193-215) with:

```ts
export type RemoveWorktreeResult = {
  branchDeleted: string | null;
  branchDeleteError?: string;
};

export async function removeWorktree(
  worktreePath: string,
  opts: { force: boolean; deleteBranch?: boolean; runner?: Runner },
): Promise<RemoveWorktreeResult> {
  const runner = opts.runner ?? defaultRunner;
  const repoPath = path.resolve(worktreePath, '..', '..');

  // Resolve branch name BEFORE removing the folder — git can't read a gone worktree.
  let branch: string | null = null;
  if (opts.deleteBranch) {
    try {
      const { stdout } = await runner('git', [
        '-C',
        worktreePath,
        'rev-parse',
        '--abbrev-ref',
        'HEAD',
      ]);
      const name = stdout.trim();
      branch = name && name !== 'HEAD' ? name : null;
    } catch (err) {
      logger.warn(
        { worktreePath, err: (err as Error)?.message },
        'branch resolve failed; will skip branch delete',
      );
      branch = null;
    }
  }

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
    logger.warn({ worktreePath, repoPath, err: msg }, 'git worktree remove failed');
    throw new GitError('REMOVE_FAILED', msg.slice(0, 200));
  }

  if (!branch) return { branchDeleted: null };

  try {
    await runner('git', ['-C', repoPath, 'branch', '-D', branch]);
    return { branchDeleted: branch };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ branch, repoPath, err: msg }, 'git branch -D failed after worktree remove');
    return { branchDeleted: null, branchDeleteError: msg.slice(0, 200) };
  }
}
```

- [ ] **Step 4: Run tests — confirm all pass**

```bash
pnpm --filter @cc/server test git.test
```
Expected: all existing tests + five new tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/git.ts server/src/lib/git.test.ts
git commit -m "feat(server): removeWorktree supports deleteBranch with partial success"
```

---

## Task 3: Update `DELETE /api/worktrees` handler

**Files:**
- Modify: `panels/worktrees/api.ts`
- Test: `panels/worktrees/api.test.ts`

Request body gains optional `deleteBranch`. Response gains `branchDeleted: string | null` and, on partial success, `branchDeleteError`. Handler still returns 200 on partial success — see spec "Partial success semantics".

- [ ] **Step 1: Write the failing tests**

Update the mock in `panels/worktrees/api.test.ts` to return a richer default (replace the existing `vi.mock` call at lines 3-13):

```ts
vi.mock('@cc/server/lib/git', () => ({
  listWorktrees: vi.fn(async () => [{ name: 'proj', path: '/p', worktrees: [] }]),
  removeWorktree: vi.fn(async () => ({ branchDeleted: null })),
  GitError: class GitError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));
```

Then update the existing `'DELETE / success returns removed path'` test to match the new response shape:

```ts
test('DELETE / success returns removed path and null branchDeleted', async () => {
  const { api } = await import('./api');
  const res = await api.request('/', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: '/p/.worktrees/x', force: true }),
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    ok: true,
    data: { removed: '/p/.worktrees/x', branchDeleted: null },
  });
});
```

Append these new tests to the `describe('worktrees api', …)` block:

```ts
test('DELETE / forwards deleteBranch and returns branchDeleted on success', async () => {
  const git = await import('@cc/server/lib/git');
  (git.removeWorktree as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    branchDeleted: 'feat/x',
  });
  const { api } = await import('./api');
  const res = await api.request('/', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: '/p/.worktrees/x', force: false, deleteBranch: true }),
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    ok: true,
    data: { removed: '/p/.worktrees/x', branchDeleted: 'feat/x' },
  });
  expect(git.removeWorktree).toHaveBeenLastCalledWith('/p/.worktrees/x', {
    force: false,
    deleteBranch: true,
  });
});

test('DELETE / returns 200 with branchDeleteError on partial success', async () => {
  const git = await import('@cc/server/lib/git');
  (git.removeWorktree as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    branchDeleted: null,
    branchDeleteError: 'branch not found',
  });
  const { api } = await import('./api');
  const res = await api.request('/', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: '/p/.worktrees/x', deleteBranch: true }),
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    ok: true,
    data: {
      removed: '/p/.worktrees/x',
      branchDeleted: null,
      branchDeleteError: 'branch not found',
    },
  });
});
```

- [ ] **Step 2: Run tests — confirm new tests fail**

```bash
pnpm --filter @cc/panel-worktrees test api.test
```
Expected: updated test and two new tests fail because the handler still returns the old `{ removed }` shape and does not forward `deleteBranch`.

- [ ] **Step 3: Update the handler**

Replace the `api.delete('/', …)` block in `panels/worktrees/api.ts` with:

```ts
api.delete('/', async (c) => {
  const body = await c.req.json<{ path: string; force?: boolean; deleteBranch?: boolean }>();
  if (!body?.path) return c.json(fail('BAD_REQUEST', 'path required'), 400);
  try {
    const result = await removeWorktree(body.path, {
      force: body.force === true,
      deleteBranch: body.deleteBranch === true,
    });
    const data: {
      removed: string;
      branchDeleted: string | null;
      branchDeleteError?: string;
    } = {
      removed: body.path,
      branchDeleted: result.branchDeleted,
    };
    if (result.branchDeleteError) data.branchDeleteError = result.branchDeleteError;
    return c.json(ok(data));
  } catch (err) {
    if (err instanceof GitError) {
      const status = err.code === 'DIRTY_WORKTREE' ? 409 : 500;
      return c.json(fail(err.code, err.message), status);
    }
    throw err;
  }
});
```

- [ ] **Step 4: Run tests — confirm all pass**

```bash
pnpm --filter @cc/panel-worktrees test api.test
```
Expected: all 4 tests (GET, 409, updated success, two new) pass.

- [ ] **Step 5: Commit**

```bash
git add panels/worktrees/api.ts panels/worktrees/api.test.ts
git commit -m "feat(panels/worktrees): API forwards deleteBranch, returns branchDeleted"
```

---

## Task 4: UI — state-aware modal

**Files:**
- Modify: `panels/worktrees/ui.tsx`
- Modify: `panels/worktrees/ui.module.css`

Replace the current two-button modal (cancel + remove OR cancel + force-remove) with a three-button modal that always renders cancel / remove folder / delete branch + folder, one of them highlighted per classifier output. "delete branch + folder" is disabled when state is `dirty`.

- [ ] **Step 1: Update CSS — add state-pill + recommended-button + disabled styles**

Append to `panels/worktrees/ui.module.css`:

```css
.statePill {
  display: inline-block;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: bold;
  letter-spacing: 1px;
  text-transform: uppercase;
  border-radius: 3px;
  margin-bottom: 6px;
}
.statePillMerged {
  background: transparent;
  color: var(--success);
  border: 1px solid var(--success);
}
.statePillPrPending {
  background: transparent;
  color: var(--fg-dim);
  border: 1px solid var(--fg-dim);
}
.statePillUnpushed {
  background: transparent;
  color: var(--danger);
  border: 1px solid var(--danger);
}
.statePillDirty {
  background: transparent;
  color: var(--yellow);
  border: 1px solid var(--yellow);
}
.recommend {
  color: var(--fg-dim);
  font-size: 12px;
  margin: 4px 0 8px;
}
.branchLine {
  color: var(--fg-dim);
  font-size: 12px;
  margin-bottom: 4px;
}
.actionBtn {
  background: transparent;
  color: var(--fg);
  border: 1px solid var(--fg-dim);
  padding: 4px 12px;
  cursor: pointer;
  font-size: 12px;
}
.actionBtnRecommended {
  background: var(--pink);
  color: var(--bg-deep);
  border-color: var(--pink);
  font-weight: bold;
  box-shadow: var(--glow-pink);
}
.actionBtn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  border-color: var(--fg-dim);
  color: var(--fg-dim);
}
.actionBtn:disabled:hover {
  background: transparent;
}
```

(The existing `.cancel`, `.confirm`, `.force` rules stay for now; Task 4 stops using them but they may still be referenced elsewhere. Leave cleanup to a follow-up — YAGNI.)

- [ ] **Step 2: Rewrite the modal in `ui.tsx`**

At the top of `panels/worktrees/ui.tsx`, add the import:

```ts
import { classifyWorktreeState, type WorktreeState } from '@cc/shared';
```

Update the mutation's response type from `{ removed: string }` to:

```ts
type DeleteResponse = {
  removed: string;
  branchDeleted: string | null;
  branchDeleteError?: string;
};
```

Replace the existing `remove` mutation definition:

```tsx
const remove = useMutation({
  mutationFn: async (args: { path: string; force: boolean; deleteBranch: boolean }) =>
    fetchJson<DeleteResponse>('/api/worktrees', {
      method: 'DELETE',
      body: JSON.stringify(args),
    }),
  onSuccess: () => {
    closePending();
    qc.invalidateQueries({ queryKey: QK });
  },
  onError: (err) => {
    setRemoveError((err as Error).message);
  },
});
```

(Task 5 will replace `onSuccess` to handle partial success. For Task 4 we keep the existing close-on-success behaviour.)

Replace the entire modal body (from the first `<p>Remove <code>…` through the closing `</div>` of `.actions`) with:

```tsx
{(() => {
  const state: WorktreeState = classifyWorktreeState(pending);
  const pillClass = {
    merged: s.statePillMerged,
    'pr-pending': s.statePillPrPending,
    unpushed: s.statePillUnpushed,
    dirty: s.statePillDirty,
  }[state];
  const pillLabel = {
    merged: 'MERGED',
    'pr-pending': 'PR PENDING',
    unpushed: 'UNPUSHED',
    dirty: 'DIRTY — uncommitted changes',
  }[state];
  const recommendation = {
    merged: 'Safe to remove. Default: delete branch + remove folder.',
    'pr-pending':
      'Branch is pushed and up to date. Default: remove folder, keep branch.',
    unpushed:
      'Local commits not on any remote. Default: cancel — commits would only survive in the reflog.',
    dirty:
      'Uncommitted changes. Default: remove folder (force), keep branch. Commit or discard to enable branch deletion.',
  }[state];

  // Which button is recommended (highlighted) for this state
  const recommended: 'cancel' | 'removeFolder' | 'deleteBranch' = {
    merged: 'deleteBranch' as const,
    'pr-pending': 'removeFolder' as const,
    unpushed: 'cancel' as const,
    dirty: 'removeFolder' as const,
  }[state];

  const forceNeeded = state === 'dirty';
  const deleteBranchDisabled = state === 'dirty';

  return (
    <>
      <span className={`${s.statePill} ${pillClass}`}>{pillLabel}</span>
      <p>
        Remove <code>{pending.path}</code>?
      </p>
      <p className={s.branchLine}>Branch: <code>{pending.branch}</code></p>
      <p className={s.recommend}>{recommendation}</p>
      {removeError && (
        <p style={{ color: 'var(--danger)', fontSize: '12px', marginTop: '8px' }}>
          {removeError}
        </p>
      )}
      <div className={s.actions}>
        <button
          type="button"
          className={`${s.actionBtn} ${recommended === 'cancel' ? s.actionBtnRecommended : ''}`}
          onClick={closePending}
        >
          cancel
        </button>
        <button
          type="button"
          className={`${s.actionBtn} ${recommended === 'removeFolder' ? s.actionBtnRecommended : ''}`}
          onClick={() =>
            remove.mutate({ path: pending.path, force: forceNeeded, deleteBranch: false })
          }
          disabled={remove.isPending}
        >
          {forceNeeded ? 'force remove folder' : 'remove folder'}
        </button>
        <button
          type="button"
          className={`${s.actionBtn} ${recommended === 'deleteBranch' ? s.actionBtnRecommended : ''}`}
          onClick={() =>
            remove.mutate({ path: pending.path, force: forceNeeded, deleteBranch: true })
          }
          disabled={remove.isPending || deleteBranchDisabled}
          title={deleteBranchDisabled ? 'commit or discard changes first' : undefined}
        >
          delete branch + folder
        </button>
      </div>
    </>
  );
})()}
```

- [ ] **Step 3: Run the full test suite to confirm nothing regressed**

```bash
pnpm -r test
```
Expected: all existing tests still pass. (No new UI tests added — see spec "Testing" section.)

- [ ] **Step 4: Manual smoke test**

Run `pnpm dev`. In a browser:
1. Open `http://localhost:5173` (Vite proxies to Hono on 7778).
2. Click "delete" on a known clean + merged worktree — modal shows green MERGED pill, "delete branch + folder" highlighted.
3. Click "delete" on a known dirty worktree — modal shows yellow DIRTY pill, "force remove folder" highlighted, "delete branch + folder" disabled with tooltip.
4. Click "delete" on a worktree with no upstream — modal shows red UNPUSHED pill, "cancel" highlighted.
5. Close the modal each time with cancel — no mutations performed.

Do not perform an actual remove yet (Task 5 handles the partial-success response).

- [ ] **Step 5: Commit**

```bash
git add panels/worktrees/ui.tsx panels/worktrees/ui.module.css
git commit -m "feat(panels/worktrees): state-aware removal modal with three actions"
```

---

## Task 5: UI — partial-success surface

**Files:**
- Modify: `panels/worktrees/ui.tsx`
- Modify: `panels/worktrees/ui.module.css`

When the response carries `branchDeleteError`, the modal must stay open and show an amber warning with a `[close]` button. The panel list still refetches in the background so the removed row disappears.

- [ ] **Step 1: Add warning style in CSS**

Append to `panels/worktrees/ui.module.css`:

```css
.partialWarn {
  color: var(--yellow);
  font-size: 12px;
  margin-top: 8px;
  padding: 6px 8px;
  border: 1px solid var(--yellow);
  border-radius: 3px;
  background: transparent;
}
.partialOk {
  color: var(--success);
  font-size: 12px;
  margin-top: 8px;
}
```

- [ ] **Step 2: Track partial-success state in the component**

Inside the `UI` component, alongside the existing `useState` calls, add:

```ts
const [partial, setPartial] = useState<DeleteResponse | null>(null);
```

Update `closePending` to clear it:

```ts
const closePending = () => {
  setPending(null);
  setRemoveError(null);
  setPartial(null);
};
```

- [ ] **Step 3: Rewrite the mutation's `onSuccess`**

Replace the mutation's `onSuccess` with:

```ts
onSuccess: (data) => {
  qc.invalidateQueries({ queryKey: QK });
  if (data.branchDeleteError) {
    setPartial(data);
  } else {
    closePending();
  }
},
```

- [ ] **Step 4: Render partial-success view inside the modal body**

At the top of the modal's inner `<div className={s.modalBody} …>`, before the IIFE from Task 4, add:

```tsx
{partial ? (
  <>
    <p className={s.partialOk}>✓ Folder removed: <code>{partial.removed}</code></p>
    <p className={s.partialWarn}>
      ⚠ Branch could not be deleted: {partial.branchDeleteError}
    </p>
    <div className={s.actions}>
      <button type="button" className={s.actionBtn} onClick={closePending}>
        close
      </button>
    </div>
  </>
) : (
  // existing IIFE from Task 4
  (() => { /* …Task 4 contents… */ })()
)}
```

Note for the implementer: keep Task 4's IIFE intact; just wrap it in the `partial ?` ternary. Do not duplicate the IIFE code — reuse by placement.

- [ ] **Step 5: Run the full test suite**

```bash
pnpm -r test
```
Expected: all tests pass unchanged.

- [ ] **Step 6: Manual smoke test for partial success**

The easiest way to reproduce is to delete the same branch twice:
1. Create a throwaway worktree: `cd ~/Workspace/<repo> && git worktree add .worktrees/tmp -b tmp-branch`.
2. In the dashboard, click "delete branch + folder" on that worktree — succeeds, row disappears.
3. Recreate the folder without the branch: `git worktree add .worktrees/tmp2 tmp-branch` (reuses branch).
4. Manually delete the branch with `git branch -D tmp-branch`.
5. Click "delete branch + folder" on `tmp2` in the dashboard. The server removes the folder but `branch -D` fails (branch already gone). The modal should show the `✓ Folder removed` + `⚠ Branch could not be deleted` lines with a close button. The row disappears from the list behind the modal.

- [ ] **Step 7: Commit**

```bash
git add panels/worktrees/ui.tsx panels/worktrees/ui.module.css
git commit -m "feat(panels/worktrees): surface partial success when branch delete fails"
```

---

## Task 6: Final verification

- [ ] **Step 1: Run biome autofix**

```bash
pnpm fix
```
Expected: exit 0. Any auto-fixed formatting gets staged separately if needed.

- [ ] **Step 2: Run lint check**

```bash
pnpm check
```
Expected: exit 0, no diagnostics.

- [ ] **Step 3: Run the full test suite**

```bash
pnpm -r test
```
Expected: all tests pass across `server`, `web`, and `panels/*`.

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @cc/server build
```
(`build` is a `tsc --noEmit` in this repo — it's the typecheck.)
Expected: exit 0.

- [ ] **Step 5: Manual end-to-end sweep**

`pnpm dev`, then exercise one worktree of each classification in the UI. Confirm:
- Correct pill color + recommendation per state.
- Correct highlighted button per state.
- `delete branch + folder` is disabled under DIRTY with the tooltip.
- A successful remove closes the modal and refetches the list.
- A partial-success remove (reproduce via Task 5 smoke test) shows the warning and stays open until `[close]`.

- [ ] **Step 6: Commit any autofix output (if the linter changed anything)**

```bash
git status
# only if the linter touched files that weren't already staged in earlier commits:
git add -A
git commit -m "chore: biome autofix"
```

---

## Self-review notes

- **Spec coverage check:** Each spec section has a task:
  - Classification → Task 1.
  - Server flow (`removeWorktree`) → Task 2.
  - API shape → Task 3.
  - UI (modal + state pill + button matrix + disabled state) → Task 4.
  - Partial-success surface → Task 5.
  - Testing strategy → tests live inside Tasks 1-3; Task 6 runs the full sweep.
  - Migration / back-compat → covered by Task 3 (`deleteBranch` defaults to false, `branchDeleted` is an additive response field).
- **No remote-branch deletion, no orphaned-folder cleanup, no bulk ops** — explicitly deferred by spec Non-goals.
- **Colors** use existing theme vars only (`--success`, `--fg-dim`, `--danger`, `--yellow`, `--pink`, `--glow-pink`, `--bg-deep`) — no new tokens introduced.
