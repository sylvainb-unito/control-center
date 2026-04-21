import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { fetchJson } from '../../web/src/lib/fetchJson';
import { useCaptureModal } from '../../web/src/lib/useCaptureModal';
import {
  type BodyResponse,
  CATEGORY_VALUES,
  type Category,
  type EntryStatus,
  type EntrySummary,
  type ListResponse,
} from './types';
import s from './ui.module.css';

type Tab = 'processed' | 'inbox';
type CategoryFilter = 'all' | Category;

const QK = ['braindump'] as const;
const FILTER_VALUES: CategoryFilter[] = ['all', ...CATEGORY_VALUES];

type PillMeta = { className: string | undefined; label: string };

const CATEGORY_META: Record<Category, PillMeta> = {
  todo: { className: s.catTodo, label: 'TODO' },
  thought: { className: s.catThought, label: 'THOUGHT' },
  'read-later': { className: s.catReadLater, label: 'READ-LATER' },
};

const STATUS_META: Partial<Record<EntryStatus, PillMeta>> = {
  new: { className: s.statusNew, label: 'NEW' },
  processing: { className: s.statusProcessing, label: 'PROCESSING' },
  failed: { className: s.statusFailed, label: 'FAILED' },
};

function timeAgo(iso: string, now: Date): string {
  const ms = now.getTime() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return '';
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

const EntryBody = ({ id }: { id: string }) => {
  const { data, isLoading, error } = useQuery<BodyResponse>({
    queryKey: ['braindump-body', id] as const,
    queryFn: () => fetchJson<BodyResponse>(`/api/braindump/${encodeURIComponent(id)}`),
    staleTime: Number.POSITIVE_INFINITY,
  });
  if (isLoading) return <div>loading…</div>;
  if (error) return <div className={s.failureLine}>{(error as Error).message}</div>;
  return <pre className={s.raw}>{data?.rawText ?? ''}</pre>;
};

type RowProps = {
  entry: EntrySummary;
  now: Date;
  isOpen: boolean;
  onToggle: () => void;
  onReprocess: () => void;
  onDelete: () => void;
  kind: 'inbox' | 'processed';
};

const EntryRow = ({ entry, now, isOpen, onToggle, onReprocess, onDelete, kind }: RowProps) => {
  const title = entry.title ?? entry.preview ?? entry.id;
  const pill =
    kind === 'processed'
      ? entry.category && CATEGORY_META[entry.category]
      : STATUS_META[entry.status];
  return (
    <div>
      <div
        className={`${s.row} ${s.rowClickable}`}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
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
        <span className={`${s.catPill} ${pill?.className ?? ''}`}>{pill?.label ?? '—'}</span>
        <span className={s.rowTitle}>{title}</span>
        {entry.tags && entry.tags.length > 0 && (
          <span className={s.tags}>
            {entry.tags.map((t) => (
              <span key={t} className={s.tag}>
                {t}
              </span>
            ))}
          </span>
        )}
        <span className={s.timeAgo}>{timeAgo(entry.capturedAt, now)}</span>
      </div>
      {isOpen && (
        <div className={`${s.expand} ${entry.status === 'failed' ? s.expandFail : ''}`}>
          {entry.status === 'failed' && entry.failure && (
            <p className={s.failureLine}>
              processing failed ({entry.failure.attempts} attempts): {entry.failure.lastError}
            </p>
          )}
          {entry.summary && <p className={s.summary}>{entry.summary}</p>}
          <EntryBody id={entry.id} />
          <div className={s.rowFooter}>
            <button type="button" className={s.actionBtn} onClick={onReprocess}>
              {entry.status === 'failed' ? 'Retry' : 'Re-process'}
            </button>
            <button type="button" className={`${s.actionBtn} ${s.actionDanger}`} onClick={onDelete}>
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export const UI = () => {
  const qc = useQueryClient();
  const { open } = useCaptureModal();
  const [tab, setTab] = useState<Tab>('processed');
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<CategoryFilter>('all');

  const { data, isLoading, error, refetch } = useQuery<ListResponse>({
    queryKey: QK,
    queryFn: () => fetchJson<ListResponse>('/api/braindump'),
  });

  const now = new Date();

  const invalidateAll = (id?: string) => {
    qc.invalidateQueries({ queryKey: QK });
    if (id) qc.invalidateQueries({ queryKey: ['braindump-body', id] });
  };

  const processNow = useMutation({
    mutationFn: async () =>
      fetchJson<{ processed: number; failed: number; skipped: number }>('/api/braindump/process', {
        method: 'POST',
      }),
    onSettled: () => invalidateAll(),
  });

  const reprocess = useMutation({
    mutationFn: async (id: string) =>
      fetchJson<{ reprocessing: true }>(`/api/braindump/${encodeURIComponent(id)}/reprocess`, {
        method: 'POST',
      }),
    onSettled: (_data, _err, id) => invalidateAll(id),
  });

  const del = useMutation({
    mutationFn: async (id: string) =>
      fetchJson<{ deleted: true }>(`/api/braindump/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
    onSettled: (_data, _err, id) => invalidateAll(id),
  });

  const toggle = (id: string) => setOpenId((prev) => (prev === id ? null : id));

  const inbox = data?.inbox ?? [];
  const processed = data?.processed ?? [];
  const rows =
    tab === 'processed'
      ? filter === 'all'
        ? processed
        : processed.filter((e) => e.category === filter)
      : inbox;

  const emptyCopy =
    tab === 'inbox'
      ? 'Nothing pending — waiting for the next processing tick.'
      : processed.length === 0
        ? 'No processed entries yet.'
        : `No entries match "${filter}".`;

  return (
    <div className="panel">
      <div className="panel-header">
        Braindump
        <button
          type="button"
          className={`${s.actionBtn} ${s.headerBtn}`}
          onClick={open}
          title="New braindump (Cmd-Shift-B)"
        >
          + new
        </button>
        <button
          type="button"
          className={`${s.actionBtn} ${s.headerBtn}`}
          onClick={() => processNow.mutate()}
          disabled={processNow.isPending}
        >
          {processNow.isPending ? 'processing…' : 'process now'}
        </button>
        <button type="button" className="panel-refresh" onClick={() => refetch()}>
          refresh
        </button>
      </div>
      <div className="panel-body">
        <div className={s.tabs}>
          <button
            type="button"
            className={`${s.tab} ${tab === 'processed' ? s.tabActive : ''}`}
            onClick={() => setTab('processed')}
          >
            Processed
          </button>
          <button
            type="button"
            className={`${s.tab} ${tab === 'inbox' ? s.tabActive : ''}`}
            onClick={() => setTab('inbox')}
          >
            Inbox
            {inbox.length > 0 && <span className={s.tabBadge}>{inbox.length}</span>}
          </button>
        </div>

        {isLoading && <p className={s.loading}>loading…</p>}
        {error && <p className={s.error}>{(error as Error).message}</p>}

        {tab === 'processed' && (
          <div className={s.chips}>
            {FILTER_VALUES.map((c) => (
              <button
                key={c}
                type="button"
                className={`${s.chip} ${filter === c ? s.chipActive : ''}`}
                onClick={() => setFilter(c)}
              >
                {c === 'all' ? 'All' : c}
              </button>
            ))}
          </div>
        )}

        {rows.length === 0 && !isLoading && <p className={s.empty}>{emptyCopy}</p>}
        {rows.map((entry) => (
          <EntryRow
            key={entry.id}
            entry={entry}
            now={now}
            isOpen={openId === entry.id}
            onToggle={() => toggle(entry.id)}
            onReprocess={() => reprocess.mutate(entry.id)}
            onDelete={() => del.mutate(entry.id)}
            kind={tab}
          />
        ))}
      </div>
    </div>
  );
};
