import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { fetchJson } from '../../web/src/lib/fetchJson';
import { classifyWorktreeState, type WorktreeState } from '@cc/shared';
import type { ListResponse, Worktree } from './types';
import s from './ui.module.css';

type DeleteResponse = {
  removed: string;
  branchDeleted: string | null;
  branchDeleteError?: string;
};

const QK = ['worktrees'] as const;

export const UI = () => {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery<ListResponse>({
    queryKey: QK,
    queryFn: () => fetchJson<ListResponse>('/api/worktrees'),
  });
  const [pending, setPending] = useState<Worktree | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const closePending = () => {
    setPending(null);
    setRemoveError(null);
  };

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

  return (
    <div className="panel">
      <div className="panel-header">
        Worktrees
        <button type="button" className="panel-refresh" onClick={() => refetch()}>
          refresh
        </button>
      </div>
      <div className="panel-body">
        {isLoading && <p style={{ color: 'var(--fg-dim)' }}>loading…</p>}
        {error && <p style={{ color: 'var(--danger)' }}>{(error as Error).message}</p>}
        {data?.repos.length === 0 && <p style={{ color: 'var(--fg-dim)' }}>No worktrees.</p>}
        {data?.repos.map((r) => (
          <div key={r.path} className={s.repo}>
            <div className={s.repoHead}>{r.name}</div>
            {r.worktrees.map((w) => {
              const folder = w.path.split('/').pop() ?? w.path;
              const branchDiffers = folder !== w.branch && folder !== w.branch.replace(/\//g, '-');
              return (
                <div key={w.path} className="panel-row">
                  <span className={s.name} title={w.path}>
                    {folder}
                    {branchDiffers && <span className={s.branchSub}> ({w.branch})</span>}
                  </span>
                  <span className={s.sha}>{w.head}</span>
                  <span className={s.badges}>
                    {w.mergedToMain && <span className="badge badge--success">merged</span>}
                    {w.dirty && <span className="badge badge--warn">dirty</span>}
                    {!w.hasUpstream && <span className="badge">no upstream</span>}
                    {w.ahead > 0 && <span className="badge badge--info">↑{w.ahead}</span>}
                    {w.behind > 0 && <span className="badge badge--info">↓{w.behind}</span>}
                    <span className="badge">{w.ageDays}d</span>
                  </span>
                  <button type="button" className={s.del} onClick={() => setPending(w)}>
                    delete
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {pending && (
        <div
          className={s.modal}
          onClick={closePending}
          onKeyDown={(e) => {
            if (e.key === 'Escape') closePending();
          }}
          // biome-ignore lint/a11y/useSemanticElements: native <dialog> manages its own open state; div overlay keeps click-outside-to-close simple.
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
        >
          <div
            className={s.modalBody}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            role="document"
          >
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
          </div>
        </div>
      )}
    </div>
  );
};
