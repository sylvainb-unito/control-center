import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { fetchJson } from '../../web/src/lib/fetchJson';
import type { BodyResponse, JournalSummary, ListResponse, Tier } from './types';
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

const JournalBody = ({ tier, id }: { tier: Tier; id: string }) => {
  const { data, isLoading, error } = useQuery<BodyResponse>({
    queryKey: ['journal-body', tier, id] as const,
    queryFn: () => fetchJson<BodyResponse>(`/api/journals/${tier}/${encodeURIComponent(id)}`),
    staleTime: Number.POSITIVE_INFINITY,
  });
  if (isLoading) return <div className={s.bodyLoading}>loading…</div>;
  if (error) return <div className={s.bodyError}>{(error as Error).message}</div>;
  if (!data?.body || data.body.trim() === '')
    return <div className={s.bodyEmpty}>(empty journal)</div>;
  return (
    <div className={s.body}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{data.body}</ReactMarkdown>
    </div>
  );
};

export const UI = () => {
  const [tier, setTier] = useState<Tier>('daily');
  const [openByTier, setOpenByTier] = useState<Record<Tier, string | null>>({
    daily: null,
    weekly: null,
    monthly: null,
  });
  const { data, isLoading, error, refetch } = useQuery<ListResponse>({
    queryKey: QK,
    queryFn: () => fetchJson<ListResponse>('/api/journals'),
  });

  const rows = data?.[tier] ?? [];
  const openId = openByTier[tier];
  const toggle = (id: string) => {
    setOpenByTier((prev) => ({ ...prev, [tier]: prev[tier] === id ? null : id }));
  };

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
        {rows.map((row) => {
          const isOpen = openId === row.id;
          return (
            <div key={row.id}>
              <div
                className={`${s.row} ${s.rowClickable}`}
                onClick={() => toggle(row.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggle(row.id);
                  }
                }}
                // biome-ignore lint/a11y/useSemanticElements: row is a flex layout; native <button> would break the visual row contract.
                role="button"
                tabIndex={0}
                aria-expanded={isOpen}
              >
                <span className={s.chevron} aria-hidden="true">
                  {isOpen ? '▾' : '▸'}
                </span>
                <span className={s.rowDate}>{row.id}</span>
                <span className={s.rowMeta}>{rowMeta(row)}</span>
              </div>
              {isOpen && <JournalBody tier={tier} id={row.id} />}
            </div>
          );
        })}
      </div>
    </div>
  );
};
