import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { fetchJson } from '../../web/src/lib/fetchJson';
import type { ListResponse, SessionSummary } from './types';
import s from './ui.module.css';

const QK = ['claude-sessions'] as const;
const LIVE_POLL_MS = 30_000;
const IDLE_POLL_MS = 60_000;

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

type MergedSession = SessionSummary & {
  mergedCount: number; // 1 when not merged, >=2 when merged
  sessionIds: string[]; // every sessionId that rolled up into this row (for bulk hide)
};

function mergeByProject(sessions: SessionSummary[]): MergedSession[] {
  const groups = new Map<string, SessionSummary[]>();
  for (const session of sessions) {
    const arr = groups.get(session.project) ?? [];
    arr.push(session);
    groups.set(session.project, arr);
  }

  const merged: MergedSession[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      const only = group[0];
      if (!only) continue;
      merged.push({ ...only, mergedCount: 1, sessionIds: [only.sessionId] });
      continue;
    }
    const sorted = [...group].sort((a, b) =>
      a.lastActivityAt < b.lastActivityAt ? 1 : a.lastActivityAt > b.lastActivityAt ? -1 : 0,
    );
    const latest = sorted[0];
    if (!latest) continue;
    const summed = sorted.reduce(
      (acc, session) => {
        acc.messageCount += session.messageCount;
        acc.tokens.input += session.tokens.input;
        acc.tokens.output += session.tokens.output;
        acc.tokens.cacheRead += session.tokens.cacheRead;
        acc.tokens.cacheCreation += session.tokens.cacheCreation;
        return acc;
      },
      {
        messageCount: 0,
        tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
      },
    );

    // primaryModel: pick the one with the highest output tokens across merged sessions
    // (approximation — we don't have tokensByModel here, but primaryModel of the session
    // with the largest total tokens is a reasonable proxy)
    const latestByTokens = [...sorted].sort((a, b) => {
      const totalA = a.tokens.input + a.tokens.output + a.tokens.cacheRead + a.tokens.cacheCreation;
      const totalB = b.tokens.input + b.tokens.output + b.tokens.cacheRead + b.tokens.cacheCreation;
      return totalB - totalA;
    })[0];

    merged.push({
      ...latest,
      messageCount: summed.messageCount,
      tokens: summed.tokens,
      primaryModel: latestByTokens?.primaryModel ?? latest.primaryModel,
      isLive: sorted.some((session) => session.isLive),
      // A merged row is "hidden" only if every session in it is hidden. If any visible
      // sessions exist in the group, the row shows. This only matters when the API was
      // called with includeHidden=true.
      isHidden: sorted.every((session) => session.isHidden),
      mergedCount: sorted.length,
      sessionIds: sorted.map((session) => session.sessionId),
    });
  }

  // Sort overall desc by lastActivityAt so day-grouping stays temporally consistent
  merged.sort((a, b) =>
    a.lastActivityAt < b.lastActivityAt ? 1 : a.lastActivityAt > b.lastActivityAt ? -1 : 0,
  );
  return merged;
}

function buildRowTooltip(row: MergedSession): string {
  const parts: string[] = [];
  parts.push(`Model: ${row.primaryModel ?? '—'}`);
  parts.push(`${row.messageCount} messages`);
  if (row.mergedCount > 1) parts.push(`${row.mergedCount} sessions merged`);
  if (row.isHidden) parts.push('hidden');
  return parts.join(' · ');
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

type OpenArgs = { sessionId: string; cwd: string };

export const UI = () => {
  const qc = useQueryClient();
  const [showHidden, setShowHidden] = useState(false);

  const { data, isLoading, error, refetch } = useQuery<ListResponse>({
    queryKey: [...QK, { showHidden }],
    queryFn: () =>
      fetchJson<ListResponse>(`/api/claude-sessions${showHidden ? '?includeHidden=true' : ''}`),
    staleTime: 30_000,
    refetchInterval: (q) => {
      const latest = q.state.data as ListResponse | undefined;
      return latest?.sessions.some((row) => row.isLive) ? LIVE_POLL_MS : IDLE_POLL_MS;
    },
  });

  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [flashingId, setFlashingId] = useState<string | null>(null);
  const [pendingOpen, setPendingOpen] = useState<MergedSession | null>(null);

  const closePending = () => setPendingOpen(null);
  const confirmOpen = () => {
    if (!pendingOpen) return;
    open.mutate({ sessionId: pendingOpen.sessionId, cwd: pendingOpen.cwd });
    setPendingOpen(null);
  };

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

  const hide = useMutation({
    mutationFn: async (sessionIds: string[]) =>
      fetchJson<{ hidden: string[] }>('/api/claude-sessions/hide', {
        method: 'POST',
        body: JSON.stringify({ sessionIds }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK }),
  });

  const unhide = useMutation({
    mutationFn: async (sessionIds: string[]) =>
      fetchJson<{ hidden: string[] }>('/api/claude-sessions/unhide', {
        method: 'POST',
        body: JSON.stringify({ sessionIds }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK }),
  });

  const now = new Date();

  const renderRow = (row: MergedSession, nowDate: Date) => {
    const rowClassNames = [
      s.row,
      row.isLive ? s.rowLive : s.rowClickable,
      row.isHidden ? s.rowHidden : '',
      flashingId === row.sessionId ? s.rowFlash : '',
    ]
      .filter(Boolean)
      .join(' ');
    const requestOpen = () => setPendingOpen(row);
    const onClick = row.isLive ? undefined : requestOpen;
    const toggleHidden = (event: React.MouseEvent) => {
      event.stopPropagation();
      if (row.isHidden) unhide.mutate(row.sessionIds);
      else hide.mutate(row.sessionIds);
    };
    return (
      <div key={row.sessionId}>
        <div
          className={rowClassNames}
          onClick={onClick}
          onKeyDown={(e) => {
            if (!row.isLive && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault();
              requestOpen();
            }
          }}
          // biome-ignore lint/a11y/useSemanticElements: row is a flex layout; native <button> would break the visual row contract.
          role="button"
          tabIndex={row.isLive ? -1 : 0}
          aria-disabled={row.isLive}
          title={
            row.isLive
              ? `Session open — switch manually (cmd-\`) · ${buildRowTooltip(row)}`
              : buildRowTooltip(row)
          }
        >
          <span className={s.project} title={row.project}>
            {row.project}
          </span>
          <span className={s.branch} title={row.gitBranch ?? undefined}>
            {row.gitBranch ?? '—'}
          </span>
          <span className={s.lastActive}>{humanizeRelative(row.lastActivityAt, nowDate)}</span>
          <span className={s.tokens}>{formatTokens(row.tokens)}</span>
          <button
            type="button"
            className={[s.rowAction, row.isHidden ? s.rowUnhide : ''].filter(Boolean).join(' ')}
            onClick={toggleHidden}
            title={row.isHidden ? 'Restore this session to the list' : 'Hide from panel'}
            aria-label={row.isHidden ? 'Unhide session' : 'Hide session'}
          >
            {row.isHidden ? 'unhide' : '✕'}
          </button>
        </div>
        {rowError[row.sessionId] && (
          <p className={s.rowError}>open failed: {rowError[row.sessionId]}</p>
        )}
      </div>
    );
  };

  const mergedRows = data ? mergeByProject(data.sessions) : [];
  const hiddenCount = mergedRows.filter((row) => row.isHidden).length;

  return (
    <div className="panel">
      <div className="panel-header">
        Claude Sessions
        <div className={s.panelToolbar}>
          {(showHidden || hiddenCount > 0) && (
            <button
              type="button"
              className={[s.toolbarToggle, showHidden ? s.active : ''].filter(Boolean).join(' ')}
              onClick={() => setShowHidden((v) => !v)}
              title={showHidden ? 'Hide dismissed sessions from view' : 'Reveal dismissed sessions'}
            >
              {showHidden ? `hiding ${hiddenCount}` : 'show hidden'}
            </button>
          )}
          <button type="button" className="panel-refresh" onClick={() => refetch()}>
            refresh
          </button>
        </div>
      </div>
      <div className="panel-body">
        {isLoading && <p style={{ color: 'var(--fg-dim)' }}>loading…</p>}
        {error && <p style={{ color: 'var(--danger)' }}>{(error as Error).message}</p>}
        {data && data.sessions.length === 0 && (
          <p style={{ color: 'var(--fg-dim)' }}>
            No sessions in the last {data.window.officeDays} office days.
          </p>
        )}
        {data &&
          data.sessions.length > 0 &&
          (() => {
            const liveRows = mergedRows.filter((r) => r.isLive);
            const otherRows = mergedRows.filter((r) => !r.isLive);
            const showHeaders = liveRows.length > 0 && otherRows.length > 0;
            return (
              <>
                <div className={s.statsStrip}>
                  <span>
                    Last {data.window.officeDays} office days · <strong>{data.stats.count}</strong>{' '}
                    sessions · {formatNumber(data.stats.messageCount)} msgs
                  </span>
                  <span>
                    {formatNumber(data.stats.tokens.input)} in /{' '}
                    {formatNumber(data.stats.tokens.output)} out /{' '}
                    {formatNumber(data.stats.tokens.cacheRead + data.stats.tokens.cacheCreation)}{' '}
                    cache
                  </span>
                </div>
                {liveRows.length > 0 && (
                  <>
                    {showHeaders && <div className={s.sectionHeader}>Live</div>}
                    {liveRows.map((row) => renderRow(row, now))}
                  </>
                )}
                {otherRows.length > 0 && (
                  <>
                    {showHeaders && <div className={s.sectionHeader}>Recent</div>}
                    {otherRows.map((row) => renderRow(row, now))}
                  </>
                )}
              </>
            );
          })()}
      </div>
      {pendingOpen && (
        <div
          className={s.modal}
          onClick={closePending}
          onKeyDown={(e) => {
            if (e.key === 'Escape') closePending();
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
              Resume <strong>{pendingOpen.project}</strong> in a new Ghostty tab?
            </p>
            <div className={s.modalActions}>
              <button type="button" className={s.modalCancel} onClick={closePending}>
                cancel
              </button>
              <button type="button" className={s.modalConfirm} onClick={confirmOpen}>
                open
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
