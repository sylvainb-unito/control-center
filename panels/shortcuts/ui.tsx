import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { fetchJson } from '../../web/src/lib/fetchJson';
import type { Shortcut } from './types';
import s from './ui.module.css';

function Logo({ shortcut }: { shortcut: Shortcut }) {
  const [broken, setBroken] = useState(false);
  if (!shortcut.logo || broken) {
    return <div className={s.placeholder}>{shortcut.label.slice(0, 2).toUpperCase()}</div>;
  }
  return (
    <img
      className={s.logo}
      src={`/logos/${shortcut.logo}`}
      alt={shortcut.label}
      onError={() => setBroken(true)}
    />
  );
}

function Tile({ shortcut }: { shortcut: Shortcut }) {
  const [openPopover, setOpenPopover] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openPopover) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpenPopover(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenPopover(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [openPopover]);

  if (shortcut.links.length === 1) {
    const link = shortcut.links[0];
    if (!link) return null;
    return (
      <a className={s.tile} href={link.url} target="_blank" rel="noopener noreferrer">
        <Logo shortcut={shortcut} />
        <span className={s.label}>{shortcut.label}</span>
      </a>
    );
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className={s.tile} onClick={() => setOpenPopover((o) => !o)}>
        <Logo shortcut={shortcut} />
        <span className={s.label}>{shortcut.label}</span>
      </button>
      {openPopover && (
        <div className={s.popover}>
          {shortcut.links.map((l) => (
            <a
              key={l.url}
              className={s.popoverItem}
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {l.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export const UI = () => {
  const { data, isLoading, error, refetch } = useQuery<Shortcut[]>({
    queryKey: ['shortcuts'],
    queryFn: () => fetchJson<Shortcut[]>('/api/shortcuts'),
  });

  return (
    <div className="panel">
      <div className="panel-header">
        Shortcuts
        <button type="button" className="panel-refresh" onClick={() => refetch()}>
          refresh
        </button>
      </div>
      <div className="panel-body">
        {isLoading && <p style={{ color: 'var(--fg-dim)' }}>loading…</p>}
        {error && <p style={{ color: 'var(--danger)' }}>{(error as Error).message}</p>}
        {data && (
          <div className={s.grid}>
            {data.map((sh) => (
              <Tile key={sh.id} shortcut={sh} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
