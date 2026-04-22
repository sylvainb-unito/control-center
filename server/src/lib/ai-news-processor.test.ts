import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { listDigests, readDigest, readState } from './ai-news';
import { _resetForTests, boot, runDigest, tick } from './ai-news-processor';

function tmpHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cc-ai-news-proc-'));
}

function validRaw(): string {
  return JSON.stringify({
    summary: 's',
    items: Array.from({ length: 10 }, (_, i) => ({
      title: `t${i}`,
      oneLineSummary: 'x',
      url: `https://x/${i}`,
      category: 'tool',
    })),
  });
}

describe('ai-news processor', () => {
  let home: string;
  let ids: number;
  beforeEach(() => {
    home = tmpHome();
    ids = 0;
    _resetForTests();
  });
  afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

  test('tick skips when before 7am', async () => {
    const runClaude = vi.fn();
    await tick({
      home,
      runClaude,
      now: () => new Date(2026, 3, 21, 6, 30, 0),
      randomId: () => `id${ids++}`,
    });
    expect(runClaude).not.toHaveBeenCalled();
  });

  test("tick skips when today's digest already exists", async () => {
    const now = () => new Date(2026, 3, 21, 9, 0, 0);
    const today = '2026-04-21';
    const dir = path.join(home, '.claude', 'ai-news', 'digests');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `${today}.json`),
      JSON.stringify({ date: today, runAt: 'x', summary: '', items: [] }),
    );
    const runClaude = vi.fn();
    await tick({ home, runClaude, now, randomId: () => `id${ids++}` });
    expect(runClaude).not.toHaveBeenCalled();
  });

  test('tick skips when state.isRunning is true', async () => {
    const dir = path.join(home, '.claude', 'ai-news');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ isRunning: true }));
    const runClaude = vi.fn();
    await tick({
      home,
      runClaude,
      now: () => new Date(2026, 3, 21, 9, 0, 0),
      randomId: () => `id${ids++}`,
    });
    expect(runClaude).not.toHaveBeenCalled();
  });

  test('happy path writes digest, clears lastError, sets lastRunAt', async () => {
    const runClaude = vi.fn(async () => validRaw());
    const now = () => new Date(2026, 3, 21, 9, 0, 0);
    await tick({ home, runClaude, now, randomId: () => `id${ids++}` });
    expect(runClaude).toHaveBeenCalledOnce();
    const dates = await listDigests({ home });
    expect(dates).toContain('2026-04-21');
    const digest = await readDigest('2026-04-21', { home });
    expect(digest.items).toHaveLength(10);
    expect(digest.items.every((i) => i.id.startsWith('id'))).toBe(true);
    expect(digest.items.every((i) => i.starred === false)).toBe(true);
    const state = await readState({ home });
    expect(state.isRunning).toBe(false);
    expect(state.lastError).toBeUndefined();
    expect(state.lastRunAt).toBeDefined();
  });

  test('failure path preserves previous digest, records lastError', async () => {
    const dir = path.join(home, '.claude', 'ai-news', 'digests');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, '2026-04-20.json'),
      JSON.stringify({ date: '2026-04-20', runAt: 'x', summary: '', items: [] }),
    );
    const runClaude = vi.fn(async () => 'not json');
    const now = () => new Date(2026, 3, 21, 9, 0, 0);
    await tick({ home, runClaude, now, randomId: () => `id${ids++}` });
    const dates = await listDigests({ home });
    expect(dates).toContain('2026-04-20');
    expect(dates).not.toContain('2026-04-21');
    const state = await readState({ home });
    expect(state.isRunning).toBe(false);
    expect(state.lastError).toBeDefined();
    expect(state.lastError).toMatch(/JSON|schema|invalid/i);
  });

  test('boot clears stale state.isRunning from a prior crashed run', async () => {
    const dir = path.join(home, '.claude', 'ai-news');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'state.json'),
      JSON.stringify({ isRunning: true, lastRunAt: '2026-04-20T07:00:00Z' }),
    );
    await boot({ home });
    const state = await readState({ home });
    expect(state.isRunning).toBe(false);
    expect(state.lastRunAt).toBe('2026-04-20T07:00:00Z');
  });

  test('runDigest with force overwrites existing file (no throw)', async () => {
    const runClaude = vi.fn(async () => validRaw());
    const now1 = () => new Date(2026, 3, 21, 9, 0, 0);
    const now2 = () => new Date(2026, 3, 21, 10, 0, 0);
    await runDigest({ home, runClaude, now: now1, randomId: () => `id${ids++}`, force: true });
    expect(runClaude).toHaveBeenCalledOnce();
    await runDigest({ home, runClaude, now: now2, randomId: () => `id${ids++}`, force: true });
    expect(runClaude).toHaveBeenCalledTimes(2);
  });
});
