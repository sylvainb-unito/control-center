import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '../../web/src/lib/fetchJson';
import type { ListResponse, PR } from './types';
import s from './ui.module.css';

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
      <a className={s.title} href={pr.url} target="_blank" rel="noopener noreferrer">
        {pr.title}
      </a>
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
        <button type="button" className="panel-refresh" onClick={() => refetch()}>
          refresh
        </button>
      </div>
      <div className="panel-body">
        {isLoading && <p style={{ color: 'var(--fg-dim)' }}>loading…</p>}
        {error && <p style={{ color: 'var(--danger)' }}>{(error as Error).message}</p>}
        {data && (
          <>
            <div className={s.section}>
              <div className={s.sectionHead}>Yours ({data.authored.length})</div>
              {data.authored.length === 0 && <p style={{ color: 'var(--fg-dim)' }}>none</p>}
              {data.authored.map((pr) => (
                <Row key={`${pr.repo}-${pr.number}`} pr={pr} />
              ))}
            </div>
            <div className={s.section}>
              <div className={s.sectionHead}>To Review ({data.reviewRequested.length})</div>
              {data.reviewRequested.length === 0 && <p style={{ color: 'var(--fg-dim)' }}>none</p>}
              {data.reviewRequested.map((pr) => (
                <Row key={`${pr.repo}-${pr.number}`} pr={pr} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
