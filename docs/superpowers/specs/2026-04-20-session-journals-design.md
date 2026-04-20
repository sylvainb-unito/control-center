# Session Journals & Retrospectives

## Overview

An automated journaling system that captures what was accomplished in each Claude Code session, with weekly and monthly aggregation that produces post-mortems and actionable recommendations.

## File Structure

All journals live in `~/.claude/journals/`:

```
journals/
  daily/
    2026-04-20.md
    2026-04-20-2.md        # second session same day
    2026-04-20-3.md
  weekly/
    2026-W16.md            # ISO week number
  monthly/
    2026-04.md
```

## Daily Journal Format

```markdown
---
date: 2026-04-20
session: 1
source: session | git
repos: [control-center, draveur]
started: 14:32
ended: 16:45
---

## Completed
- Bullet list of what was done

## In Progress
- Work started but not finished

## Key Decisions
- Decisions made and their rationale (session-source only)

## Blockers
- Anything that slowed or stopped work (session-source only)

## Repos & Branches Touched
- repo-name: `branch-name`
```

- `source: session` — rich journal generated from conversation context
- `source: git` — minimal journal generated from git activity only (safety net)
- "Key Decisions" and "Blockers" sections are omitted for git-source journals since they can't be inferred

## Triggers

Three paths feed into the same journal skill:

| Trigger | When | Context |
|---|---|---|
| `/clear` hook | User clears a session | Full conversation — rich journal |
| `/journal` command | User invokes manually | Full conversation — rich journal |
| Evening cron (19:00) | Daily safety net | Git activity only — minimal journal |

### Session numbering

First session of the day: `2026-04-20.md`. Subsequent sessions: `2026-04-20-2.md`, `2026-04-20-3.md`, etc. The skill checks for existing files and increments.

### Cron safety net merge logic

- If a rich journal (`source: session`) already exists for today, the cron either skips or appends git activity not already covered
- If no journal exists, the cron generates a git-based journal by scanning `~/Workspace/` repos
- Git scan: `git log --since="today" --author=$(git config user.name)` per repo, plus `gh` for PRs created/merged

## Weekly Retrospective Format

Generated Fridays via cron + on-demand via `/retro weekly`.

Reads all daily journals from the current ISO week.

```markdown
---
type: weekly
week: 2026-W16
period: 2026-04-13 to 2026-04-19
sessions: 14
repos: [control-center, draveur, kirby]
---

## Summary
Brief narrative of the week's work.

## Accomplishments
Grouped by repo or theme, not by day.

## Productivity Patterns
- Which repos got the most attention
- Session frequency and duration trends
- Types of work (features, bugs, refactors, brainstorming)

## Recurring Blockers
Patterns that showed up across multiple sessions.

## Technical Debt Flagged
Deferred decisions or unfinished work carried across sessions.

## Process Improvements
- What slowed things down repeatedly
- What worked well worth repeating

## Recommendations
Concrete suggestions for next week.
```

## Monthly Retrospective Format

Generated 1st of month via cron + on-demand via `/retro monthly`.

Reads weekly retros (not raw dailies) to stay at the right altitude.

Same structure as weekly, plus:

- **Trend analysis** — patterns improving or declining across weeks
- **Debt accumulation** — longer-term unresolved items
- **Strategic recommendations** — not just tactical, but directional suggestions

## Deliverables

### 1. `/journal` skill

- Generates a daily journal entry
- When invoked from a session: reads conversation context for a rich journal
- When invoked from cron: scans git activity across `~/Workspace/` repos for a minimal journal
- Handles session numbering (suffix increment)
- Writes to `~/.claude/journals/daily/`

### 2. `/retro` skill

- Accepts argument: `weekly` or `monthly`
- Weekly: reads daily journals for the current/specified week
- Monthly: reads weekly retros for the current/specified month
- Produces post-mortem analysis with four lenses:
  - Productivity patterns
  - Process improvements
  - Technical debt tracking
  - Actionable recommendations
- Writes to `~/.claude/journals/weekly/` or `monthly/`

### 3. Configuration

- **Hook** in `~/.claude/settings.json`: fires `/journal` before `/clear` executes
- **Cron trigger (daily)**: 19:00 — runs `/journal` as safety net
- **Cron trigger (weekly)**: Fridays — runs `/retro weekly`
- **Cron trigger (monthly)**: 1st of month — runs `/retro monthly`

## What Lives Where

| Component | Location |
|---|---|
| Skills | `~/.claude/skills/journal.md`, `~/.claude/skills/retro.md` |
| Daily journals | `~/.claude/journals/daily/` |
| Weekly retros | `~/.claude/journals/weekly/` |
| Monthly retros | `~/.claude/journals/monthly/` |
| Hook config | `~/.claude/settings.json` |
| Cron triggers | Claude Code schedule system |
