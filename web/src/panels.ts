import type { PanelMeta, PanelUI } from '@cc/shared';
import { meta as worktreesMeta } from '../../panels/worktrees/meta';
import { UI as worktreesUI } from '../../panels/worktrees/ui';

export type PanelEntry = { meta: PanelMeta; UI: PanelUI };

export const panels: PanelEntry[] = [{ meta: worktreesMeta, UI: worktreesUI }];
