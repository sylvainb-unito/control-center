import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { fetchJson } from '../../web/src/lib/fetchJson';
import type {
  AiNewsCategory,
  AiNewsItem,
  RunResponse,
  StarResponse,
  StarredResponse,
  TodayResponse,
} from './types';
import s from './ui.module.css';

const QK_TODAY = ['ai-news', 'today'] as const;
const QK_STARRED = ['ai-news', 'starred'] as const;

const CATEGORY_LABEL: Record<AiNewsCategory, string> = {
  tool: 'TOOL',
  model: 'MODEL',
  protocol: 'PROTO',
  research: 'RSRCH',
  community: 'COMM',
};

const CATEGORY_CLASS: Record<AiNewsCategory, string | undefined> = {
  tool: s.catTool,
  model: s.catModel,
  protocol: s.catProto,
  research: s.catRsrch,
  community: s.catComm,
};

type Tab = 'digest' | 'starred';

function formatRunAt(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

type ToggleArgs = { date: string; id: string; starred: boolean };

const ItemRow = ({
  item,
  date,
  onToggleStar,
}: {
  item: AiNewsItem;
  date: string;
  onToggleStar: (args: ToggleArgs) => void;
}) => (
  <div className={s.row}>
    <span className={`${s.pill} ${CATEGORY_CLASS[item.category] ?? ''}`}>
      {CATEGORY_LABEL[item.category]}
    </span>
    <div className={s.rowBody}>
      <a className={s.rowTitle} href={item.url} target="_blank" rel="noopener noreferrer">
        {item.title}
      </a>
      <div className={s.rowSummary}>{item.oneLineSummary}</div>
    </div>
    <button
      type="button"
      className={s.star}
      aria-pressed={item.starred}
      title={item.starred ? 'Unstar' : 'Star'}
      onClick={() => onToggleStar({ date, id: item.id, starred: !item.starred })}
    >
      {item.starred ? '★' : '☆'}
    </button>
  </div>
);

export const UI = () => {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('digest');

  const todayQuery = useQuery<TodayResponse>({
    queryKey: QK_TODAY,
    queryFn: () => fetchJson<TodayResponse>('/api/ai-news/today'),
    refetchInterval: (query) => (query.state.data?.state.isRunning ? 30_000 : false),
  });

  const starredQuery = useQuery<StarredResponse>({
    queryKey: QK_STARRED,
    queryFn: () => fetchJson<StarredResponse>('/api/ai-news/starred'),
    enabled: tab === 'starred',
  });

  const starMutation = useMutation({
    mutationFn: async ({ date, id, starred }: ToggleArgs) =>
      fetchJson<StarResponse>(
        `/api/ai-news/digests/${encodeURIComponent(date)}/items/${encodeURIComponent(id)}/star`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ starred }),
        },
      ),
    onMutate: async ({ date, id, starred }) => {
      await qc.cancelQueries({ queryKey: QK_TODAY });
      await qc.cancelQueries({ queryKey: QK_STARRED });
      const prevToday = qc.getQueryData<TodayResponse>(QK_TODAY);
      const prevStarred = qc.getQueryData<StarredResponse>(QK_STARRED);

      if (prevToday?.digest && prevToday.digest.date === date) {
        qc.setQueryData<TodayResponse>(QK_TODAY, {
          ...prevToday,
          digest: {
            ...prevToday.digest,
            items: prevToday.digest.items.map((it) => (it.id === id ? { ...it, starred } : it)),
          },
        });
      }
      if (prevStarred) {
        if (starred) {
          const found: AiNewsItem | undefined = prevToday?.digest?.items.find((it) => it.id === id);
          if (found) {
            const alreadyIn = prevStarred.items.some(
              (it) => it.id === id && it.digestDate === date,
            );
            if (!alreadyIn) {
              qc.setQueryData<StarredResponse>(QK_STARRED, {
                items: [{ ...found, starred: true, digestDate: date }, ...prevStarred.items],
              });
            }
          }
        } else {
          qc.setQueryData<StarredResponse>(QK_STARRED, {
            items: prevStarred.items.filter((it) => !(it.id === id && it.digestDate === date)),
          });
        }
      }

      return { prevToday, prevStarred };
    },
    onError: (_err, _vars, context) => {
      if (context?.prevToday !== undefined) qc.setQueryData(QK_TODAY, context.prevToday);
      if (context?.prevStarred !== undefined) qc.setQueryData(QK_STARRED, context.prevStarred);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: QK_TODAY });
      void qc.invalidateQueries({ queryKey: QK_STARRED });
    },
  });

  const runMutation = useMutation({
    mutationFn: async () => fetchJson<RunResponse>('/api/ai-news/run', { method: 'POST' }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: QK_TODAY });
    },
  });

  const state = todayQuery.data?.state;
  const digest = todayQuery.data?.digest;
  const status = state?.isRunning
    ? 'Running…'
    : state?.lastError
      ? `Failed: ${state.lastError}`
      : state?.lastRunAt
        ? `Last run ${formatRunAt(state.lastRunAt)} · ${digest?.items.length ?? 0} items`
        : '';

  return (
    <div className="panel">
      <div className="panel-header">
        AI News
        <button
          type="button"
          className="panel-refresh"
          disabled={state?.isRunning || runMutation.isPending}
          onClick={() => runMutation.mutate()}
        >
          {state?.isRunning ? 'running…' : 'refresh'}
        </button>
      </div>
      <div className="panel-body">
        <div className={s.tabs}>
          <button
            type="button"
            className={tab === 'digest' ? s.tabActive : s.tab}
            onClick={() => setTab('digest')}
          >
            Digest
          </button>
          <button
            type="button"
            className={tab === 'starred' ? s.tabActive : s.tab}
            onClick={() => setTab('starred')}
          >
            Starred
          </button>
        </div>
        <div className={s.status}>{status}</div>

        {tab === 'digest' ? (
          <DigestTab query={todayQuery} onToggleStar={(args) => starMutation.mutate(args)} />
        ) : (
          <StarredTab query={starredQuery} onToggleStar={(args) => starMutation.mutate(args)} />
        )}
      </div>
    </div>
  );
};

const StarredTab = ({
  query,
  onToggleStar,
}: {
  query: ReturnType<typeof useQuery<StarredResponse>>;
  onToggleStar: (args: ToggleArgs) => void;
}) => {
  if (query.isLoading) return <div className={s.empty}>Loading…</div>;
  if (query.error) return <div className={s.empty}>Failed: {(query.error as Error).message}</div>;
  const items = query.data?.items ?? [];
  if (items.length === 0)
    return (
      <div className={s.empty}>
        Nothing starred yet — star items from the Digest tab to pin them here.
      </div>
    );
  const groups = new Map<string, typeof items>();
  for (const item of items) {
    const list = groups.get(item.digestDate) ?? [];
    list.push(item);
    groups.set(item.digestDate, list);
  }
  const dates = Array.from(groups.keys()).sort((a, b) => (a < b ? 1 : -1));
  return (
    <div className={s.items}>
      {dates.map((date) => {
        const group = groups.get(date) ?? [];
        return (
          <div key={date}>
            <div className={s.dateHeader}>
              {date} · {group.length} starred
            </div>
            {group.map((item) => (
              <ItemRow key={item.id} item={item} date={date} onToggleStar={onToggleStar} />
            ))}
          </div>
        );
      })}
    </div>
  );
};

const DigestTab = ({
  query,
  onToggleStar,
}: {
  query: ReturnType<typeof useQuery<TodayResponse>>;
  onToggleStar: (args: ToggleArgs) => void;
}) => {
  if (query.isLoading) return <div className={s.empty}>Loading…</div>;
  if (query.error) return <div className={s.empty}>Failed: {(query.error as Error).message}</div>;
  const digest = query.data?.digest;
  const state = query.data?.state;
  if (digest) {
    return (
      <>
        <div className={s.summary}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{digest.summary}</ReactMarkdown>
        </div>
        <div className={s.items}>
          {digest.items.map((item) => (
            <ItemRow key={item.id} item={item} date={digest.date} onToggleStar={onToggleStar} />
          ))}
        </div>
      </>
    );
  }
  return (
    <div className={s.empty}>
      {state?.isRunning
        ? 'No digest yet today — running shortly.'
        : 'No digest yet today — click Refresh to generate one.'}
    </div>
  );
};
