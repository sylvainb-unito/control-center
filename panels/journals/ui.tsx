import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { fetchJson } from '../../web/src/lib/fetchJson';
import type { JournalSummary, ListResponse, Tier } from './types';
import s from './ui.module.css';

const QK = ['journals'] as const;
const TIER_LABELS: Record<Tier, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

function rowMeta(row: JournalSummary): string {
  const reposPart = row.repos.length > 0 ? row.repos.join(', ') : '—';
  const sessionPart =
    row.sessions === null
      ? '— sessions'
      : row.tier === 'daily'
        ? `Session ${row.sessions}`
        : `${row.sessions} session${row.sessions === 1 ? '' : 's'}`;
  const periodPart = row.period ? ` · ${row.period}` : '';
  return `${reposPart} · ${sessionPart}${periodPart}`;
}

export const UI = () => {
  const [tier, setTier] = useState<Tier>('daily');
  const { data, isLoading, error, refetch } = useQuery<ListResponse>({
    queryKey: QK,
    queryFn: () => fetchJson<ListResponse>('/api/journals'),
  });

  const rows = data?.[tier] ?? [];

  return (
    <div className="panel">
      <div className="panel-header">
        Journals
        <button type="button" className="panel-refresh" onClick={() => refetch()}>
          refresh
        </button>
      </div>
      <div className="panel-body">
        <div className={s.tabs}>
          {(['daily', 'weekly', 'monthly'] as Tier[]).map((t) => (
            <button
              key={t}
              type="button"
              className={`${s.tab} ${t === tier ? s.tabActive : ''}`}
              onClick={() => setTier(t)}
            >
              {TIER_LABELS[t]}
            </button>
          ))}
        </div>
        {isLoading && <p style={{ color: 'var(--fg-dim)' }}>loading…</p>}
        {error && <p style={{ color: 'var(--danger)' }}>{(error as Error).message}</p>}
        {data && rows.length === 0 && <p className={s.empty}>No {tier} journals yet.</p>}
        {rows.map((row) => (
          <div key={row.id} className={s.row}>
            <span className={s.chevron} aria-hidden="true">
              ▸
            </span>
            <span className={s.rowDate}>{row.id}</span>
            <span className={s.rowMeta}>{rowMeta(row)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
