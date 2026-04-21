import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { fetchJson } from '../../web/src/lib/fetchJson';
import type { ListResponse, SessionSummary } from './types';
import s from './ui.module.css';

const QK = ['claude-sessions'] as const;
const LIVE_POLL_MS = 30_000;

function humanizeRelative(fromIso: string, now: Date): string {
  const from = new Date(fromIso);
  const diffMs = now.getTime() - from.getTime();
  if (Number.isNaN(diffMs)) return '—';
  const diffMins = Math.round(diffMs / 60_000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.round(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  // Compare calendar days
  const fromStart = new Date(from);
  fromStart.setHours(0, 0, 0, 0);
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const diffDays = Math.round((todayStart.getTime() - fromStart.getTime()) / 86_400_000);
  if (diffDays === 1) return 'yesterday';
  if (diffDays > 1 && diffDays < 7) return `${diffDays}d ago`;
  return fromStart.toISOString().slice(0, 10);
}

function formatTokens(tokens: {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}): string {
  const total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheCreation;
  if (total === 0) return '0 tok';
  if (total < 1_000) return `${total} tok`;
  if (total < 1_000_000) return `${(total / 1_000).toFixed(1)}K tok`;
  if (total < 1_000_000_000) return `${(total / 1_000_000).toFixed(1)}M tok`;
  return `${(total / 1_000_000_000).toFixed(1)}G tok`;
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

type MergedSession = SessionSummary & {
  mergedCount: number; // 1 when not merged, >=2 when merged
};

function mergeByProjectAndDay(sessions: SessionSummary[]): MergedSession[] {
  // Key = `${project}|${YYYY-MM-DD of lastActivityAt in local tz}`
  const groups = new Map<string, SessionSummary[]>();
  for (const session of sessions) {
    const d = new Date(session.lastActivityAt);
    d.setHours(0, 0, 0, 0);
    const dayKey = d.toISOString().slice(0, 10);
    const key = `${session.project}|${dayKey}`;
    const arr = groups.get(key) ?? [];
    arr.push(session);
    groups.set(key, arr);
  }

  const merged: MergedSession[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      const only = group[0];
      if (!only) continue;
      merged.push({ ...only, mergedCount: 1 });
      continue;
    }
    // Sort desc by lastActivityAt — "latest" is index 0
    const sorted = [...group].sort((a, b) =>
      a.lastActivityAt < b.lastActivityAt ? 1 : a.lastActivityAt > b.lastActivityAt ? -1 : 0,
    );
    const latest = sorted[0];
    if (!latest) continue;
    const summed = sorted.reduce(
      (acc, s) => {
        acc.messageCount += s.messageCount;
        acc.tokens.input += s.tokens.input;
        acc.tokens.output += s.tokens.output;
        acc.tokens.cacheRead += s.tokens.cacheRead;
        acc.tokens.cacheCreation += s.tokens.cacheCreation;
        return acc;
      },
      {
        messageCount: 0,
        tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
      },
    );
    merged.push({
      ...latest,
      messageCount: summed.messageCount,
      tokens: summed.tokens,
      isLive: sorted.some((s) => s.isLive),
      mergedCount: sorted.length,
    });
  }

  // Sort overall desc by lastActivityAt so groupByDay's downstream .sort().reverse() stays stable
  merged.sort((a, b) =>
    a.lastActivityAt < b.lastActivityAt ? 1 : a.lastActivityAt > b.lastActivityAt ? -1 : 0,
  );
  return merged;
}

function groupByDay(sessions: SessionSummary[]): Array<{ label: string; rows: SessionSummary[] }> {
  const today = new Date();
  const groups = new Map<string, SessionSummary[]>();
  for (const session of sessions) {
    const d = new Date(session.lastActivityAt);
    d.setHours(0, 0, 0, 0);
    const key = d.toISOString().slice(0, 10);
    const arr = groups.get(key) ?? [];
    arr.push(session);
    groups.set(key, arr);
  }
  const sortedKeys = [...groups.keys()].sort().reverse();
  return sortedKeys.map((key) => {
    const firstRow = groups.get(key)?.[0];
    const iso = firstRow?.lastActivityAt ?? `${key}T00:00:00Z`;
    return {
      label: dayHeaderLabel(iso, today),
      rows: groups.get(key) ?? [],
    };
  });
}

function formatNumber(n: number): string {
  return n.toLocaleString();
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
      setTimeout(() => {
        setRowError((prev) => {
          const { [args.sessionId]: _drop, ...rest } = prev;
          return rest;
        });
      }, 5_000);
    },
  });

  const now = new Date();

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
          <p style={{ color: 'var(--fg-dim)' }}>
            No sessions in the last {data.window.officeDays} office days.
          </p>
        )}
        {data && data.sessions.length > 0 && (
          <>
            <div className={s.statsStrip}>
              <span>
                Last {data.window.officeDays} office days · <strong>{data.stats.count}</strong>{' '}
                sessions · {formatNumber(data.stats.messageCount)} msgs
              </span>
              <span>
                {formatNumber(data.stats.tokens.input)} in /{' '}
                {formatNumber(data.stats.tokens.output)} out /{' '}
                {formatNumber(data.stats.tokens.cacheRead + data.stats.tokens.cacheCreation)} cache
              </span>
            </div>
            {groupByDay(mergeByProjectAndDay(data.sessions)).map((group) => (
              <div key={group.label}>
                <div className={s.dayHeader}>{group.label}</div>
                {(group.rows as MergedSession[]).map((row) => {
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
                        // biome-ignore lint/a11y/useSemanticElements: row is a flex layout; native <button> would break the visual row contract.
                        role="button"
                        tabIndex={row.isLive ? -1 : 0}
                        aria-disabled={row.isLive}
                        title={title}
                      >
                        {row.isLive && <span className={s.liveDot} aria-hidden="true" />}
                        {row.isLive && <span className={s.liveBadge}>LIVE</span>}
                        <span className={s.project}>{row.project}</span>
                        <span className={s.meta}>
                          {row.gitBranch ?? '—'} · {row.primaryModel ?? '—'} ·{' '}
                          {humanizeRelative(row.lastActivityAt, now)}
                        </span>
                        <span className={s.tokens}>{formatTokens(row.tokens)}</span>
                        <span className={s.msgs}>
                          {row.messageCount} msgs
                          {row.mergedCount > 1 && (
                            <span
                              className={s.mergedCount}
                              title={`${row.mergedCount} sessions merged`}
                            >
                              ×{row.mergedCount}
                            </span>
                          )}
                        </span>
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
