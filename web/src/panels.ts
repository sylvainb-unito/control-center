import type { PanelMeta, PanelUI } from '@cc/shared';
import { meta as prsMeta } from '../../panels/pull-requests/meta';
import { UI as prsUI } from '../../panels/pull-requests/ui';
import { meta as worktreesMeta } from '../../panels/worktrees/meta';
import { UI as worktreesUI } from '../../panels/worktrees/ui';

export type PanelEntry = { meta: PanelMeta; UI: PanelUI };

export const panels: PanelEntry[] = [
  { meta: worktreesMeta, UI: worktreesUI },
  { meta: prsMeta, UI: prsUI },
];
