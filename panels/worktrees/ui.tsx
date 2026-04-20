import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { fetchJson } from '../../web/src/lib/fetchJson';
import type { ListResponse, Worktree } from './types';
import s from './ui.module.css';

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
            {r.worktrees.map((w) => (
              <div key={w.path} className="panel-row">
                <span className={s.branch}>{w.branch}</span>
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
            ))}
          </div>
        ))}
      </div>
      {pending && (
        <div
          className={s.modal}
          onClick={() => setPending(null)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setPending(null);
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
            <p>
              Remove <code>{pending.path}</code>?
            </p>
            {pending.dirty && (
              <p style={{ color: 'var(--yellow)' }}>
                ⚠ Uncommitted changes. Use "Force" to remove anyway.
              </p>
            )}
            <div className={s.actions}>
              <button type="button" className={s.cancel} onClick={() => setPending(null)}>
                cancel
              </button>
              {!pending.dirty && (
                <button
                  type="button"
                  className={s.confirm}
                  onClick={() => remove.mutate({ path: pending.path, force: false })}
                  disabled={remove.isPending}
                >
                  remove
                </button>
              )}
              {pending.dirty && (
                <button
                  type="button"
                  className={s.force}
                  onClick={() => remove.mutate({ path: pending.path, force: true })}
                  disabled={remove.isPending}
                >
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
