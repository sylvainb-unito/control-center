import { useEffect } from 'react';

export type Shortcut = {
  key: string; // e.g. 'B' (compared case-insensitively)
  meta?: boolean; // Cmd on mac, Win on windows
  shift?: boolean;
  alt?: boolean;
  ctrl?: boolean;
};

function matches(e: KeyboardEvent, s: Shortcut): boolean {
  if (e.key.toLowerCase() !== s.key.toLowerCase()) return false;
  if ((s.meta ?? false) !== e.metaKey) return false;
  if ((s.shift ?? false) !== e.shiftKey) return false;
  if ((s.alt ?? false) !== e.altKey) return false;
  if ((s.ctrl ?? false) !== e.ctrlKey) return false;
  return true;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  if (target.isContentEditable) return true;
  return false;
}

export function useGlobalShortcut(shortcut: Shortcut, handler: () => void): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!matches(e, shortcut)) return;
      // Cmd-Shift-B intentionally works even inside inputs — user wants to dump a thought from anywhere.
      if (isEditableTarget(e.target) && !shortcut.meta) return;
      e.preventDefault();
      handler();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shortcut, handler]);
}
