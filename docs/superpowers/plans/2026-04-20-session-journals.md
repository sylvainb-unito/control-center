# Session Journals & Retrospectives — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automated session journaling with weekly/monthly retrospectives and post-mortems.

**Architecture:** Two skills (`/journal` and `/retro`) in `~/.claude/skills/`, triggered by hooks (SessionEnd on `/clear`), manual invocation, and cron schedules. Journals stored as markdown in `~/.claude/journals/`.

**Tech Stack:** Claude Code skills (markdown), hooks (settings.json), cron triggers (Claude Code schedule system), shell scripting (git scanning for safety net cron).

---

### Task 1: Create journal directory structure

**Files:**
- Create: `~/.claude/journals/daily/.gitkeep`
- Create: `~/.claude/journals/weekly/.gitkeep`
- Create: `~/.claude/journals/monthly/.gitkeep`

- [ ] **Step 1: Create the directories**

```bash
mkdir -p ~/.claude/journals/daily ~/.claude/journals/weekly ~/.claude/journals/monthly
```

- [ ] **Step 2: Verify**

```bash
ls -la ~/.claude/journals/
```

Expected: three subdirectories `daily/`, `weekly/`, `monthly/`.

---

### Task 2: Write the `/journal` skill

**Files:**
- Create: `~/.claude/skills/journal/SKILL.md`

This skill generates a daily session journal. When invoked from a live session, it reads conversation context. When invoked from a cron (no conversation context), it falls back to git scanning.

- [ ] **Step 1: Create the skill directory**

```bash
mkdir -p ~/.claude/skills/journal
```

- [ ] **Step 2: Write the skill file**

Create `~/.claude/skills/journal/SKILL.md` with this content:

```markdown
---
name: journal
description: >
  Generate a session journal entry summarizing what was accomplished.
  Triggered automatically on /clear via hook, manually via /journal,
  or via evening cron as a git-activity safety net.
  Writes markdown journals to ~/.claude/journals/daily/.
---

# Session Journal

Generate a structured journal entry for today's session.

## Determine Source Mode

Check whether you have conversation context (prior messages about work done) or not:

- **If you have conversation context** (invoked from a live session or /clear hook): generate a rich journal with all sections. Set `source: session` in frontmatter.
- **If you have no conversation context** (invoked from cron or fresh session with no prior work): fall back to git scanning mode. Set `source: git` in frontmatter.

## Git Scanning Mode (safety net)

When there is no conversation context, scan git activity:

1. List all directories in `~/Workspace/` that contain a `.git` folder
2. For each repo, run: `git -C <repo> log --since="today" --author="$(git config user.name)" --oneline`
3. For each repo with commits, also run: `git -C <repo> branch --show-current`
4. Check for PRs: `gh pr list --author="@me" --state=all --search="created:$(date +%Y-%m-%d)" 2>/dev/null`
5. Compile findings into the journal format below, omitting "Key Decisions" and "Blockers" sections

## Session Numbering

Before writing, check for existing journals today:

1. Get today's date: `date +%Y-%m-%d`
2. List existing files: `ls ~/.claude/journals/daily/<date>*.md 2>/dev/null`
3. If no files exist, use `<date>.md`
4. If `<date>.md` exists, use `<date>-2.md`. If that exists, use `<date>-3.md`, etc.

## Merge Logic (cron safety net)

If running in git scanning mode and a `source: session` journal already exists for today:
- Read the existing journal(s) to see which repos/branches are already covered
- Only append a new journal if there is git activity NOT already captured
- If all activity is covered, skip — do not create a redundant journal

## Journal Format

Write the journal to `~/.claude/journals/daily/<filename>.md` using this exact format:

```
---
date: <YYYY-MM-DD>
session: <number>
source: <session|git>
repos: [<repo-names>]
started: <HH:MM or "unknown" for git mode>
ended: <HH:MM or "unknown" for git mode>
---

## Completed
- <bullet list of what was accomplished>

## In Progress
- <work started but not finished — omit section if nothing applies>

## Key Decisions
- <decisions made and their rationale — session source only>

## Blockers
- <anything that slowed or stopped work — session source only, omit if none>

## Repos & Branches Touched
- <repo-name>: `<branch-name>`
```

## After Writing

Confirm to the user: "Journal saved to `~/.claude/journals/daily/<filename>.md`"
```

- [ ] **Step 3: Verify the skill is discoverable**

```bash
cat ~/.claude/skills/journal/SKILL.md | head -8
```

Expected: the frontmatter with `name: journal` and `description`.

- [ ] **Step 4: Commit**

```bash
cd ~/.claude && git add skills/journal/SKILL.md && git commit -m "feat: add /journal skill for session journaling"
```

Note: if `~/.claude` is not a git repo, skip this step — the file is written and discoverable.

---

### Task 3: Write the `/retro` skill

**Files:**
- Create: `~/.claude/skills/retro/SKILL.md`

- [ ] **Step 1: Create the skill directory**

```bash
mkdir -p ~/.claude/skills/retro
```

- [ ] **Step 2: Write the skill file**

Create `~/.claude/skills/retro/SKILL.md` with this content:

```markdown
---
name: retro
description: >
  Generate weekly or monthly retrospectives by aggregating session journals.
  Produces post-mortems with productivity patterns, process improvements,
  technical debt tracking, and actionable recommendations.
  Usage: /retro weekly or /retro monthly
argument-hint: weekly|monthly
---

# Retrospective Generator

Generate an aggregated retrospective from session journals.

## Parse Argument

The user passes `weekly` or `monthly` as argument. If no argument is given, ask:
> "Which retrospective? `weekly` or `monthly`?"

## Weekly Retrospective

### Gather Data

1. Determine the current ISO week: `date +%G-W%V`
2. Determine the date range for this week (Monday to Sunday)
3. Read all daily journals from `~/.claude/journals/daily/` whose `date` frontmatter falls within this week
4. If no journals exist for this week, report: "No journals found for this week. Nothing to aggregate."

### Generate the Retrospective

Read each daily journal carefully, then write a retrospective to `~/.claude/journals/weekly/<YYYY>-W<WW>.md` with this format:

```
---
type: weekly
week: <YYYY-WNN>
period: <YYYY-MM-DD> to <YYYY-MM-DD>
sessions: <count of daily journals>
repos: [<all unique repos across journals>]
---

## Summary
A brief narrative (2-4 sentences) of the week's work — what was the main focus, what shifted, what was the overall arc.

## Accomplishments
Group by repo or theme, not by day. Deduplicate across sessions.

## Productivity Patterns
- Which repos got the most attention (count sessions and commits per repo)
- Session frequency: how many sessions this week, average per day
- Types of work observed: features, bug fixes, refactors, brainstorming, reviews, ops
- Any notable concentration or scatter patterns

## Recurring Blockers
Patterns that appeared in multiple sessions' "Blockers" sections. If no blockers were logged, note that explicitly.

## Technical Debt Flagged
Items that appeared in "In Progress" across multiple sessions without moving to "Completed". Deferred decisions mentioned in "Key Decisions". Anything that looks like it's accumulating.

## Process Improvements
- What friction showed up repeatedly (same type of blocker, same slow workflow)
- What worked well — patterns worth repeating
- Any process that was tried for the first time and its outcome

## Recommendations
3-5 concrete, actionable suggestions for next week. Each should be specific enough to act on (not "be more productive" but "batch PR reviews to Tuesday/Thursday mornings to reduce context switching").
```

## Monthly Retrospective

### Gather Data

1. Determine the current month: `date +%Y-%m`
2. Read all weekly retrospectives from `~/.claude/journals/weekly/` whose `week` frontmatter falls within this month
3. If no weekly retros exist, fall back to reading daily journals for the month directly
4. If nothing exists, report: "No journals or retros found for this month."

### Generate the Retrospective

Write to `~/.claude/journals/monthly/<YYYY-MM>.md` with this format:

```
---
type: monthly
month: <YYYY-MM>
period: <YYYY-MM-DD> to <YYYY-MM-DD>
weeks: <count of weekly retros>
total_sessions: <sum of sessions across weeks>
repos: [<all unique repos>]
---

## Summary
A narrative (3-5 sentences) of the month's arc — major themes, shifts in focus, overall trajectory.

## Accomplishments
Grouped by theme or initiative, not by week. This is the "what did we ship" section.

## Productivity Patterns
- Repo attention distribution across the month
- Session frequency trends (increasing, decreasing, stable)
- Work type distribution (what percentage was features vs bugs vs ops)
- Week-over-week trends

## Recurring Blockers
Blockers that persisted across multiple weeks. These are systemic, not incidental.

## Technical Debt Flagged
Items that have been "in progress" or deferred for multiple weeks. Accumulation trends. Anything becoming a risk.

## Process Improvements
- What process changes were tried and their outcomes
- Friction patterns that persisted all month
- What worked well consistently

## Trend Analysis
- What's improving week over week
- What's declining or stagnating
- New patterns that emerged this month

## Strategic Recommendations
3-5 directional suggestions. These go beyond tactical ("review PRs faster") into strategic ("the ratio of bug fixes to features has been climbing for 3 weeks — consider a stability sprint" or "repo X hasn't been touched in 3 weeks despite open debt items — schedule dedicated time").
```

## After Writing

Confirm: "Retrospective saved to `~/.claude/journals/<weekly|monthly>/<filename>.md`"
```

- [ ] **Step 3: Verify the skill is discoverable**

```bash
cat ~/.claude/skills/retro/SKILL.md | head -8
```

Expected: the frontmatter with `name: retro` and `description`.

- [ ] **Step 4: Commit**

```bash
cd ~/.claude && git add skills/retro/SKILL.md && git commit -m "feat: add /retro skill for weekly/monthly retrospectives"
```

---

### Task 4: Configure the SessionEnd hook for `/clear`

**Files:**
- Modify: `~/.claude/settings.json`

**Spec deviation:** The spec says "fires `/journal` before `/clear` executes." In practice, `SessionEnd` hooks run shell commands after the session ends — they can't invoke skills or access conversation context. The pragmatic solution: the hook logs a session timestamp so the cron safety net knows sessions happened. Rich journals come from manual `/journal` invocation before `/clear`.

- [ ] **Step 1: Read current settings.json**

```bash
cat ~/.claude/settings.json
```

- [ ] **Step 2: Add the SessionEnd hook**

Add a `SessionEnd` entry to the `hooks` object in `~/.claude/settings.json`:

```json
"SessionEnd": [
  {
    "matcher": "clear",
    "hooks": [
      {
        "type": "command",
        "command": "echo 'IMPORTANT: Before clearing, run /journal to save a session journal. This is a reminder — the hook cannot invoke skills directly.'"
      }
    ]
  }
]
```

**Important design note:** `SessionEnd` hooks run shell commands, not skills. They cannot invoke `/journal` directly because the session context is about to be destroyed. The practical approach is:

- Option A: The hook prints a reminder to run `/journal` before `/clear` (but this fires _after_ the clear, so too late).
- Option B: We use a **`Stop` hook** instead — this fires every time Claude finishes a response, which is too frequent.

The realistic solution: **Rely on manual `/journal` invocation + cron safety net.** The `/clear` reminder is a nice-to-have but the hook fires after context is gone. Update the hook to log a timestamp so the cron can check "was there a session today without a journal?"

```json
"SessionEnd": [
  {
    "matcher": "clear",
    "hooks": [
      {
        "type": "command",
        "command": "bash -c 'echo $(date +%Y-%m-%dT%H:%M:%S) >> ~/.claude/journals/.session-timestamps'"
      }
    ]
  }
]
```

This gives the cron a signal that sessions happened, even if no journal was explicitly created.

- [ ] **Step 3: Verify settings.json is valid**

```bash
python3 -c "import json; json.load(open('$HOME/.claude/settings.json'))" && echo "Valid JSON"
```

Expected: "Valid JSON"

- [ ] **Step 4: Commit**

```bash
cd ~/.claude && git add settings.json && git commit -m "feat: add SessionEnd hook for journal session tracking"
```

---

### Task 5: Set up cron triggers

**Files:** None (uses Claude Code schedule system)

Three cron triggers need to be created using the Claude Code schedule/trigger system.

- [ ] **Step 1: Create the daily safety-net cron (19:00)**

Use the Claude Code `CronCreate` tool (or `schedule` skill) to create a trigger:

- **Name:** `journal-daily-safety-net`
- **Schedule:** `0 19 * * *` (every day at 7pm)
- **Prompt:** `Run /journal in git scanning mode. Check ~/.claude/journals/.session-timestamps for sessions today. If session journals already exist for today, only create a new one if there's git activity not already captured. Scan all repos in ~/Workspace/ for today's commits.`

- [ ] **Step 2: Create the weekly retro cron (Fridays)**

- **Name:** `retro-weekly`
- **Schedule:** `0 18 * * 5` (Fridays at 6pm)
- **Prompt:** `Run /retro weekly`

- [ ] **Step 3: Create the monthly retro cron (1st of month)**

- **Name:** `retro-monthly`
- **Schedule:** `0 18 1 * *` (1st of each month at 6pm)
- **Prompt:** `Run /retro monthly`

- [ ] **Step 4: Verify crons are registered**

Use `CronList` to confirm all three triggers appear.

---

### Task 6: End-to-end test — manual journal

- [ ] **Step 1: Invoke `/journal` manually**

Run `/journal` in the current session. It should detect conversation context (this brainstorming + planning session) and generate a rich journal.

- [ ] **Step 2: Verify the journal was created**

```bash
ls ~/.claude/journals/daily/
cat ~/.claude/journals/daily/2026-04-20.md
```

Expected: a journal file with `source: session`, sections for Completed, In Progress, Key Decisions, and repos touched.

- [ ] **Step 3: Run `/journal` again to test session numbering**

Run `/journal` a second time. It should create `2026-04-20-2.md`.

```bash
ls ~/.claude/journals/daily/
```

Expected: both `2026-04-20.md` and `2026-04-20-2.md`.

---

### Task 7: End-to-end test — retro

- [ ] **Step 1: Run `/retro weekly`**

With at least one daily journal in place, run `/retro weekly`.

- [ ] **Step 2: Verify the weekly retro**

```bash
ls ~/.claude/journals/weekly/
cat ~/.claude/journals/weekly/2026-W17.md
```

Expected: a weekly retro file with all sections populated, referencing the daily journal(s).

- [ ] **Step 3: Commit test journals (optional)**

If desired, commit the generated journals as examples. Otherwise leave them as working data.
