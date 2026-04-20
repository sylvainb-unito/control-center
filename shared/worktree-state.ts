export type WorktreeState = 'merged' | 'pr-pending' | 'unpushed' | 'dirty';

export type WorktreeClassifiable = Readonly<{
  dirty: boolean;
  mergedToMain: boolean;
  ahead: number;
  hasUpstream: boolean;
}>;

export function classifyWorktreeState(w: WorktreeClassifiable): WorktreeState {
  if (w.dirty) return 'dirty';
  if (w.mergedToMain) return 'merged';
  if (w.ahead > 0 || !w.hasUpstream) return 'unpushed';
  return 'pr-pending';
}
