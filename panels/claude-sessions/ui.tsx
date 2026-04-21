import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '../../web/src/lib/fetchJson';
import type { ListResponse, SessionSummary } from './types';
import s from './ui.module.css';

const QK = ['claude-sessions'] as const;

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

export const UI = () => {
  const { data, isLoading, error, refetch } = useQuery<ListResponse>({
    queryKey: QK,
    queryFn: () => fetchJson<ListResponse>('/api/claude-sessions'),
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
                {group.rows.map((row) => (
                  <div key={row.sessionId} className={s.row}>
                    <span className={s.project} title={row.cwd}>
                      {row.project}
                    </span>
                    <span className={s.meta}>
                      {row.gitBranch ?? '—'} · {row.primaryModel ?? '—'} · {humanizeDuration(row.durationMs)}
                    </span>
                    <span className={s.msgs}>{row.messageCount} msgs</span>
                  </div>
                ))}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
};
