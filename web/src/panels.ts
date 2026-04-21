import type { PanelMeta, PanelUI } from '@cc/shared';
import { meta as aiNewsMeta } from '../../panels/ai-news/meta';
import { UI as aiNewsUI } from '../../panels/ai-news/ui';
import { meta as braindumpMeta } from '../../panels/braindump/meta';
import { UI as braindumpUI } from '../../panels/braindump/ui';
import { meta as sessionsMeta } from '../../panels/claude-sessions/meta';
import { UI as sessionsUI } from '../../panels/claude-sessions/ui';
import { meta as journalsMeta } from '../../panels/journals/meta';
import { UI as journalsUI } from '../../panels/journals/ui';
import { meta as prsMeta } from '../../panels/pull-requests/meta';
import { UI as prsUI } from '../../panels/pull-requests/ui';
import { meta as shortcutsMeta } from '../../panels/shortcuts/meta';
import { UI as shortcutsUI } from '../../panels/shortcuts/ui';
import { meta as worktreesMeta } from '../../panels/worktrees/meta';
import { UI as worktreesUI } from '../../panels/worktrees/ui';

export type PanelEntry = { meta: PanelMeta; UI: PanelUI };

export const panels: PanelEntry[] = [
  { meta: worktreesMeta, UI: worktreesUI },
  { meta: prsMeta, UI: prsUI },
  { meta: shortcutsMeta, UI: shortcutsUI },
  { meta: sessionsMeta, UI: sessionsUI },
  { meta: journalsMeta, UI: journalsUI },
  { meta: braindumpMeta, UI: braindumpUI },
  { meta: aiNewsMeta, UI: aiNewsUI },
];
