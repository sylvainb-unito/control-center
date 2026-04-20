# Worktree Removal — State-Aware Flow

**Date:** 2026-04-20
**Status:** Approved
**Scope:** `panels/worktrees` (UI + API) + `shared/`

## Problem

The current worktree removal flow offers only two outcomes: *remove* (clean worktrees) or *force remove* (dirty worktrees). It does not touch branches. It also returns `500` for several common cases:

- The underlying directory is no longer a registered git worktree (orphaned folder).
- The worktree has uncommitted changes and the user wants the folder gone but the branch kept.
- The user wants both folder and branch removed in one step for merged branches.

The user wants a single UI that reflects the real state of the worktree and lets them pick the right outcome.

## Goals

1. Detect the worktree's state from existing data (`dirty`, `mergedToMain`, `ahead`, `hasUpstream`).
2. Offer three outcomes in one modal: **cancel**, **remove folder**, **delete branch + remove folder**.
3. Pre-select the safest outcome for the detected state.
4. Surface partial success (folder gone, branch delete failed) without rolling back.

## Non-goals

- Remote branch deletion (`git push origin --delete`). A future action, not this spec.
- Orphaned-folder cleanup (directory exists but is not a registered worktree). Out of scope — the user can `rm -rf` manually; introducing filesystem deletion from the dashboard is a separate risk conversation.
- Bulk / multi-select removal.
- Undo / trash-can behaviour. Reflog covers branch recovery; folder removal is permanent by design.

## State classification

A pure function in `shared/worktree-state.ts` maps a `Worktree` to one of four states:

```ts
export type WorktreeState = 'merged' | 'pr-pending' | 'unpushed' | 'dirty';

export function classifyWorktreeState(w: Worktree): WorktreeState {
  if (w.dirty) return 'dirty';
  if (w.mergedToMain) return 'merged';
  if (w.ahead > 0 || !w.hasUpstream) return 'unpushed';
  return 'pr-pending';
}
```

**Precedence:** `dirty` wins over `merged`. Data safety beats merge status — if a user has uncommitted work on a merged branch, we must not auto-recommend branch deletion.

**State definitions** (evaluated top-to-bottom per the function above — each row assumes earlier rows didn't match):

| State | Meaning | Recommended default |
|---|---|---|
| `dirty` | uncommitted changes in the working tree | Remove folder (force), keep branch |
| `merged` | branch merged into main/master | Delete branch + remove folder |
| `unpushed` | local commits not mirrored on any remote (`ahead > 0` or no upstream at all) | Cancel (warn: commits only live in reflog after deletion) |
| `pr-pending` | pushed, up-to-date with remote, PR not merged yet | Remove folder, keep branch |

`ageDays` remains an informational badge only. Age alone never changes which action is safe.

## Architecture

```
┌──────────────┐   GET /api/worktrees    ┌──────────────┐
│   UI (web)   │◄────────────────────────┤  server API  │
│              │   DELETE /api/worktrees ├──────────────┤
│              │◄────────────────────────┤  git.ts      │
└──────────────┘                         └──────────────┘
       │
       ▼
classifyWorktreeState(w)   ← pure, in shared/, used by UI + tests
```

- **`shared/worktree-state.ts`** — `classifyWorktreeState`, `WorktreeState` type.
- **`server/src/lib/git.ts`** — `removeWorktree` extended with `deleteBranch` option; resolves branch name before folder removal; runs `git branch -D` after.
- **`panels/worktrees/api.ts`** — request body gains `deleteBranch?: boolean`; response gains `branchDeleted: string | null` and optional `branchDeleteError`.
- **`panels/worktrees/ui.tsx`** — modal reads classification, pre-selects a default button, surfaces partial-success warning.

## API

`DELETE /api/worktrees`

**Request body:**

```ts
{
  path: string;
  force?: boolean;        // existing — needed for dirty worktrees
  deleteBranch?: boolean; // new — default false for back-compat
}
```

**Success (200):**

```ts
{
  removed: string;                 // worktree path
  branchDeleted: string | null;    // branch name if deleted, else null
  branchDeleteError?: string;      // present iff folder removed but branch -D failed
}
```

**Errors:**

| Status | Code | Meaning |
|---|---|---|
| 400 | `BAD_REQUEST` | `path` missing |
| 409 | `DIRTY_WORKTREE` | dirty and `!force` — unchanged |
| 500 | `REMOVE_FAILED` | `git worktree remove` failed — unchanged |

**Partial success semantics:** if `git worktree remove` succeeds but `git branch -D` fails, the endpoint returns **200** with `branchDeleted: null` and `branchDeleteError: "<truncated stderr>"`. Rolling back a folder removal is not possible; returning 500 would mislead the UI into thinking the whole operation failed.

## Server flow (`removeWorktree`)

```ts
async function removeWorktree(
  worktreePath: string,
  opts: { force: boolean; deleteBranch: boolean; runner?: Runner },
): Promise<{ branchDeleted: string | null; branchDeleteError?: string }>
```

Steps:

1. **Resolve branch name first.** Run `git -C <worktreePath> rev-parse --abbrev-ref HEAD` and remember the branch. Must happen before folder removal because `git` can't read a deleted worktree.
2. **Check dirty gate.** Same as today: if `git status --porcelain` is non-empty and `!force`, throw `GitError('DIRTY_WORKTREE', …)`.
3. **Remove worktree.** `git -C <repo> worktree remove [--force] <path>`. On failure throw `GitError('REMOVE_FAILED', …)`.
4. **Optionally delete branch.** If `opts.deleteBranch && branchName && branchName !== 'HEAD'`:
   - Run `git -C <repo> branch -D <branchName>`.
   - On success return `{ branchDeleted: branchName }`.
   - On failure return `{ branchDeleted: null, branchDeleteError: <truncated message> }` — do **not** throw.
5. **Safety check:** never delete a detached HEAD or a branch name that equals `HEAD` / is empty.

`-D` (force delete) is used rather than `-d` because the branch may be unmerged and the user explicitly asked for deletion.

## UI

**Modal layout (current modal, expanded):**

```
Remove worktree
.worktrees/salesforce-v2

● DIRTY — uncommitted changes       ← state pill (color per state)
Branch: feat/salesforce-v2
Recommendation: remove the folder but keep the branch.
Commit first if you don't want to lose work.

  [cancel]  [remove folder]*  [delete branch + folder]◯

   * = highlighted (neon-pink border, keyboard default)
   ◯ = disabled in DIRTY with tooltip "commit or discard changes first"
```

**Per-state button matrix:**

| State | cancel | remove folder | delete branch + folder |
|---|---|---|---|
| `merged` | ·  | ·  | **★** |
| `pr-pending` | ·  | **★** | ·  |
| `unpushed` | **★** | ·  | ·  (enabled, warns) |
| `dirty` | ·  | **★** (force) | disabled — tooltip |

**Color mapping (existing theme vars, no new tokens):**

| State | Pill color |
|---|---|
| `merged` | `--success` |
| `pr-pending` | `--fg-dim` |
| `unpushed` | `--danger` |
| `dirty` | `--yellow` |

**Action → request mapping:**

| Button | Request body |
|---|---|
| remove folder (clean) | `{ path, force: false, deleteBranch: false }` |
| remove folder (dirty) | `{ path, force: true, deleteBranch: false }` |
| delete branch + folder (clean) | `{ path, force: false, deleteBranch: true }` |
| delete branch + folder (merged + dirty edge case) | Button disabled — unreachable |

**Partial success in UI:** when the response contains `branchDeleteError`, the modal does not auto-close. Instead the body changes to:

```
✓ Folder removed.
⚠ Branch <name> could not be deleted: <message>
                                           [close]
```

The background list refetches so the row disappears (folder is gone) but the branch can be investigated via CLI. No rollback.

## Testing

**New: `shared/worktree-state.test.ts`** — truth table covering:

- Each of the four states hits the correct branch.
- `dirty` overrides `merged` (precedence).
- `behind > 0 && ahead === 0` classifies as `pr-pending`.
- No upstream + clean + ahead 0 → `unpushed` (no remote to compare against; treat as local-only).

**Extended: `server/src/lib/git.test.ts`** — new cases for `removeWorktree`:

- `{ deleteBranch: true }` happy path — asserts the exact `git branch -D` call and return value.
- Branch delete fails after folder removed — returns `{ branchDeleted: null, branchDeleteError }`, does not throw.
- `{ force: true, deleteBranch: true }` for dirty state — correct command order (status → worktree remove --force → branch -D).
- Detached HEAD — skips branch deletion even when `deleteBranch: true`.

**Extended: `panels/worktrees/api.test.ts`:**

- 200 with `branchDeleted: "branch-name"` on success.
- 200 with `branchDeleteError` on partial success.
- 409 `DIRTY_WORKTREE` unchanged.

**No new UI tests.** The modal is thin view-layer glue over the classification function; tested surface area does not justify a React Testing Library harness in this solo-use dashboard.

## Migration

- Back-compat: old request body `{ path, force }` still works; `deleteBranch` defaults to `false`.
- Response gains `branchDeleted`; existing consumer (`ui.tsx`) does not read it today, so no breakage.
- No persisted state, no config, no schema changes.

## Files touched

**New:**
- `shared/worktree-state.ts`
- `shared/worktree-state.test.ts`

**Changed:**
- `server/src/lib/git.ts`
- `server/src/lib/git.test.ts`
- `panels/worktrees/api.ts`
- `panels/worktrees/api.test.ts`
- `panels/worktrees/ui.tsx`
- `panels/worktrees/ui.module.css`

## Open questions

None. Remote-branch deletion and orphaned-folder cleanup are explicitly deferred (see Non-goals).
