import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
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

function displayRepo(repo: string): string {
  return repo.startsWith('unitoio/') ? repo.slice('unitoio/'.length) : repo;
}

function Row({ pr, showRepo }: { pr: PR; showRepo: boolean }) {
  return (
    <div className="panel-row">
      {showRepo && (
        <span className={s.repo} title={displayRepo(pr.repo)}>
          {displayRepo(pr.repo)}
        </span>
      )}
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

type Filters = {
  search: string;
  hideDrafts: boolean;
  activeRepo: string;
};

function apply(prs: PR[], f: Filters): PR[] {
  const q = f.search.trim().toLowerCase();
  return prs.filter((pr) => {
    if (f.hideDrafts && pr.isDraft) return false;
    if (f.activeRepo !== '__all__' && pr.repo !== f.activeRepo) return false;
    if (
      q &&
      !pr.title.toLowerCase().includes(q) &&
      !pr.repo.toLowerCase().includes(q) &&
      !String(pr.number).includes(q)
    ) {
      return false;
    }
    return true;
  });
}

export const UI = () => {
  const { data, isLoading, error, refetch } = useQuery<ListResponse>({
    queryKey: ['pull-requests'],
    queryFn: () => fetchJson<ListResponse>('/api/pull-requests'),
  });

  const [search, setSearch] = useState('');
  const [hideDrafts, setHideDrafts] = useState(true);
  const [activeRepo, setActiveRepo] = useState<string>('__all__');

  const { repos, filteredAuthored, filteredReview } = useMemo(() => {
    if (!data) {
      return { repos: [] as string[], filteredAuthored: [] as PR[], filteredReview: [] as PR[] };
    }
    const filters: Filters = { search, hideDrafts, activeRepo };
    const all = [...data.authored, ...data.reviewRequested];
    const uniqueRepos = [...new Set(all.map((p) => p.repo))].sort();
    return {
      repos: uniqueRepos,
      filteredAuthored: apply(data.authored, filters),
      filteredReview: apply(data.reviewRequested, filters),
    };
  }, [data, search, hideDrafts, activeRepo]);

  const clearFilters = () => {
    setSearch('');
  };

  const hasFilters = search !== '';

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
            {repos.length > 0 && (
              <div className={s.tabs}>
                <button
                  type="button"
                  className={`${s.tab} ${activeRepo === '__all__' ? s.tabActive : ''}`}
                  onClick={() => setActiveRepo('__all__')}
                >
                  All
                </button>
                {repos.map((repo) => (
                  <button
                    key={repo}
                    type="button"
                    className={`${s.tab} ${activeRepo === repo ? s.tabActive : ''}`}
                    onClick={() => setActiveRepo(repo)}
                  >
                    {displayRepo(repo)}
                  </button>
                ))}
              </div>
            )}
            <div className={s.filters}>
              <input
                className={s.search}
                type="search"
                placeholder="filter by title or id…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <label className={s.toggle}>
                <input
                  type="checkbox"
                  checked={hideDrafts}
                  onChange={(e) => setHideDrafts(e.target.checked)}
                />
                <span>hide drafts</span>
              </label>
              {hasFilters && (
                <button type="button" className={s.clear} onClick={clearFilters}>
                  clear
                </button>
              )}
            </div>
            <div className={s.section}>
              <div className={s.sectionHead}>
                Yours ({filteredAuthored.length}
                {filteredAuthored.length !== data.authored.length && `/${data.authored.length}`})
              </div>
              {filteredAuthored.length === 0 && <p style={{ color: 'var(--fg-dim)' }}>none</p>}
              {filteredAuthored.map((pr) => (
                <Row key={`${pr.repo}-${pr.number}`} pr={pr} showRepo={activeRepo === '__all__'} />
              ))}
            </div>
            <div className={s.section}>
              <div className={s.sectionHead}>
                To Review ({filteredReview.length}
                {filteredReview.length !== data.reviewRequested.length &&
                  `/${data.reviewRequested.length}`}
                )
              </div>
              {filteredReview.length === 0 && <p style={{ color: 'var(--fg-dim)' }}>none</p>}
              {filteredReview.map((pr) => (
                <Row key={`${pr.repo}-${pr.number}`} pr={pr} showRepo={activeRepo === '__all__'} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
