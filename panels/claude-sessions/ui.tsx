import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { fetchJson } from '../../web/src/lib/fetchJson';
import type { ListResponse, SessionSummary } from './types';
import s from './ui.module.css';

const QK = ['claude-sessions'] as const;
const LIVE_POLL_MS = 30_000;

function humanizeDuration(ms: number): string {
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function dayHeaderLabel(iso: string, today: Date): string {
  const d = new Date(iso);
  const dStart = new Date(d);
  dStart.setHours(0, 0, 0, 0);
  const todayStart = new Date(today);
  todayStart.setHours(0, 0, 0, 0);
  const diffDays = Math.round((todayStart.getTime() - dStart.getTime()) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays > 1 && diffDays < 7) {
    return dStart.toLocaleDateString(undefined, { weekday: 'long' });
  }
  return dStart.toISOString().slice(0, 10);
}

function groupByDay(sessions: SessionSummary[]): Array<{ label: string; rows: SessionSummary[] }> {
  const today = new Date();
  const groups = new Map<string, SessionSummary[]>();
  for (const session of sessions) {
    const d = new Date(session.startedAt);
    d.setHours(0, 0, 0, 0);
    const key = d.toISOString().slice(0, 10);
    const arr = groups.get(key) ?? [];
    arr.push(session);
    groups.set(key, arr);
  }
  const sortedKeys = [...groups.keys()].sort().reverse();
  return sortedKeys.map((key) => {
    const firstRow = groups.get(key)?.[0];
    const iso = firstRow?.startedAt ?? `${key}T00:00:00Z`;
    return {
      label: dayHeaderLabel(iso, today),
      rows: groups.get(key) ?? [],
    };
  });
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function formatUsd(n: number): string {
  return `~$${n.toFixed(2)}`;
}

type OpenArgs = { sessionId: string; cwd: string };

export const UI = () => {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery<ListResponse>({
    queryKey: QK,
    queryFn: () => fetchJson<ListResponse>('/api/claude-sessions'),
    staleTime: 30_000,
    refetchInterval: (q) => {
      const latest = q.state.data as ListResponse | undefined;
      return latest?.sessions.some((row) => row.isLive) ? LIVE_POLL_MS : false;
    },
  });

  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [flashingId, setFlashingId] = useState<string | null>(null);

  const open = useMutation({
    mutationFn: async (args: OpenArgs) =>
      fetchJson<{ opened: true }>('/api/claude-sessions/open', {
        method: 'POST',
        body: JSON.stringify(args),
      }),
    onSuccess: (_data, args) => {
      setRowError((prev) => {
        const { [args.sessionId]: _drop, ...rest } = prev;
        return rest;
      });
      setFlashingId(args.sessionId);
      setTimeout(() => setFlashingId(null), 700);
      qc.invalidateQueries({ queryKey: QK });
    },
    onError: (err, args) => {
      setRowError((prev) => ({ ...prev, [args.sessionId]: (err as Error).message }));
    },
  });

  return (
    <div className="panel">
      <div className="panel-header">
        Claude Sessions
        <button type="button" className="panel-refresh" onClick={() => refetch()}>
          refresh
        </button>
      </div>
      <div className="panel-body">
        {isLoading && <p style={{ color: 'var(--fg-dim)' }}>loading…</p>}
        {error && <p style={{ color: 'var(--danger)' }}>{(error as Error).message}</p>}
        {data && data.sessions.length === 0 && (
          <p style={{ color: 'var(--fg-dim)' }}>No sessions in the last {data.window.officeDays} office days.</p>
        )}
        {data && data.sessions.length > 0 && (
          <>
            <div className={s.statsStrip}>
              <span>
                Last {data.window.officeDays} office days · <strong>{data.stats.count}</strong> sessions ·{' '}
                {humanizeDuration(data.stats.durationMs)} · {formatNumber(data.stats.messageCount)} msgs
              </span>
              <span>
                {formatNumber(data.stats.tokens.input)} in / {formatNumber(data.stats.tokens.output)} out /{' '}
                {formatNumber(data.stats.tokens.cacheRead + data.stats.tokens.cacheCreation)} cache ·{' '}
                <strong>{formatUsd(data.stats.estCostUsd)} est</strong>
                {data.stats.pricingMissing && <span className={s.pricingMissing}> (some rates missing)</span>}
              </span>
            </div>
            {groupByDay(data.sessions).map((group) => (
              <div key={group.label}>
                <div className={s.dayHeader}>{group.label}</div>
                {group.rows.map((row) => {
                  const rowClassNames = [
                    s.row,
                    row.isLive ? s.rowLive : s.rowClickable,
                    flashingId === row.sessionId ? s.rowFlash : '',
                  ]
                    .filter(Boolean)
                    .join(' ');
                  const onClick = row.isLive
                    ? undefined
                    : () => open.mutate({ sessionId: row.sessionId, cwd: row.cwd });
                  const title = row.isLive
                    ? 'session open — switch to it manually (cmd-`)'
                    : row.cwd;
                  return (
                    <div key={row.sessionId}>
                      <div
                        className={rowClassNames}
                        onClick={onClick}
                        onKeyDown={(e) => {
                          if (!row.isLive && (e.key === 'Enter' || e.key === ' ')) {
                            e.preventDefault();
                            open.mutate({ sessionId: row.sessionId, cwd: row.cwd });
                          }
                        }}
                        role="button"
                        tabIndex={row.isLive ? -1 : 0}
                        aria-disabled={row.isLive}
                        title={title}
                      >
                        {row.isLive && <span className={s.liveDot} aria-hidden="true" />}
                        {row.isLive && <span className={s.liveBadge}>LIVE</span>}
                        <span className={s.project}>{row.project}</span>
                        <span className={s.meta}>
                          {row.gitBranch ?? '—'} · {row.primaryModel ?? '—'} · {humanizeDuration(row.durationMs)}
                        </span>
                        <span className={s.msgs}>{row.messageCount} msgs</span>
                      </div>
                      {rowError[row.sessionId] && (
                        <p className={s.rowError}>open failed: {rowError[row.sessionId]}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
};
