import { describe, expect, test } from 'vitest';
import { Readable } from 'node:stream';

describe('officeDayCutoff', () => {
  test('returns start-of-day of the weekday exactly N weekdays before now (weekday now)', async () => {
    const { officeDayCutoff } = await import('./sessions');
    // Wednesday 2026-04-22 local-noon → step back 10 weekdays → Wednesday 2026-04-08
    const now = new Date('2026-04-22T12:00:00');
    const cutoff = officeDayCutoff(now, 10);
    expect(cutoff.getFullYear()).toBe(2026);
    expect(cutoff.getMonth()).toBe(3); // April
    expect(cutoff.getDate()).toBe(8);
    expect(cutoff.getHours()).toBe(0);
    expect(cutoff.getMinutes()).toBe(0);
    expect(cutoff.getSeconds()).toBe(0);
    expect(cutoff.getMilliseconds()).toBe(0);
  });

  test('skips Saturdays and Sundays while stepping back', async () => {
    const { officeDayCutoff } = await import('./sessions');
    // Monday 2026-04-20 → step back 1 weekday → Friday 2026-04-17
    const cutoff = officeDayCutoff(new Date('2026-04-20T12:00:00'), 1);
    expect(cutoff.getDate()).toBe(17);
    expect(cutoff.getDay()).toBe(5); // Friday
  });

  test('when now falls on a Sunday, steps back through preceding Saturday', async () => {
    const { officeDayCutoff } = await import('./sessions');
    // Sunday 2026-04-19 → step back 1 weekday → Friday 2026-04-17
    const cutoff = officeDayCutoff(new Date('2026-04-19T12:00:00'), 1);
    expect(cutoff.getDate()).toBe(17);
    expect(cutoff.getDay()).toBe(5);
  });

  test('officeDays=0 clamps now to start-of-day (no stepping)', async () => {
    const { officeDayCutoff } = await import('./sessions');
    const now = new Date('2026-04-22T15:30:45');
    const originalMs = now.getTime();
    const cutoff = officeDayCutoff(now, 0);
    expect(cutoff.getDate()).toBe(22);
    expect(cutoff.getHours()).toBe(0);
    expect(now.getTime()).toBe(originalMs);
  });

  test('when now falls on a Saturday, steps back through preceding Friday', async () => {
    const { officeDayCutoff } = await import('./sessions');
    // Saturday 2026-04-18 → step back 1 weekday → Friday 2026-04-17
    const cutoff = officeDayCutoff(new Date('2026-04-18T12:00:00'), 1);
    expect(cutoff.getDate()).toBe(17);
    expect(cutoff.getDay()).toBe(5); // Friday
  });
});

function streamOf(...lines: string[]): Readable {
  return Readable.from(lines.map((l) => `${l}\n`));
}

describe('parseSessionFile', () => {
  test('extracts aggregates from a small valid JSONL', async () => {
    const { parseSessionFile } = await import('./sessions');
    const lines = [
      JSON.stringify({
        type: 'user',
        timestamp: '2026-04-22T10:00:00Z',
        sessionId: 'S1',
        cwd: '/Users/u/Workspace/proj',
        gitBranch: 'main',
      }),
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-04-22T10:00:30Z',
        sessionId: 'S1',
        message: { model: 'claude-opus-4-7', usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 20, cache_creation_input_tokens: 10 } },
      }),
      JSON.stringify({
        type: 'user',
        timestamp: '2026-04-22T10:05:00Z',
        sessionId: 'S1',
      }),
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-04-22T10:05:45Z',
        sessionId: 'S1',
        message: { model: 'claude-opus-4-7', usage: { input_tokens: 200, output_tokens: 90, cache_read_input_tokens: 5, cache_creation_input_tokens: 0 } },
      }),
    ];
    const result = await parseSessionFile(streamOf(...lines), 'S1');
    expect(result).toEqual({
      sessionId: 'S1',
      cwd: '/Users/u/Workspace/proj',
      gitBranch: 'main',
      startedAt: '2026-04-22T10:00:00Z',
      lastActivityAt: '2026-04-22T10:05:45Z',
      messageCount: 4,
      primaryModel: 'claude-opus-4-7',
      tokensByModel: {
        'claude-opus-4-7': { input: 300, output: 140, cacheRead: 25, cacheCreation: 10 },
      },
    });
  });

  test('tolerates trailing incomplete line (session still being written)', async () => {
    const { parseSessionFile } = await import('./sessions');
    const full = JSON.stringify({ type: 'user', timestamp: '2026-04-22T10:00:00Z', sessionId: 'S2', cwd: '/p' });
    const partial = '{"type":"assist'; // truncated mid-write
    const result = await parseSessionFile(streamOf(full, partial), 'S2');
    expect(result.messageCount).toBe(1);
    expect(result.startedAt).toBe('2026-04-22T10:00:00Z');
    expect(result.lastActivityAt).toBe('2026-04-22T10:00:00Z');
  });

  test('primary-model tie-break picks most-recent when output tokens equal', async () => {
    const { parseSessionFile } = await import('./sessions');
    const lines = [
      JSON.stringify({ type: 'user', timestamp: '2026-04-22T10:00:00Z', sessionId: 'S3', cwd: '/p' }),
      JSON.stringify({ type: 'assistant', timestamp: '2026-04-22T10:00:10Z', sessionId: 'S3',
        message: { model: 'claude-opus-4-7', usage: { input_tokens: 0, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }),
      JSON.stringify({ type: 'assistant', timestamp: '2026-04-22T10:01:00Z', sessionId: 'S3',
        message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 0, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }),
    ];
    const result = await parseSessionFile(streamOf(...lines), 'S3');
    expect(result.primaryModel).toBe('claude-sonnet-4-6');
  });

  test('session with no assistant lines has null primaryModel and empty tokensByModel', async () => {
    const { parseSessionFile } = await import('./sessions');
    const lines = [
      JSON.stringify({ type: 'user', timestamp: '2026-04-22T10:00:00Z', sessionId: 'S4', cwd: '/p' }),
      JSON.stringify({ type: 'user', timestamp: '2026-04-22T10:00:30Z', sessionId: 'S4' }),
    ];
    const result = await parseSessionFile(streamOf(...lines), 'S4');
    expect(result.primaryModel).toBeNull();
    expect(result.tokensByModel).toEqual({});
    expect(result.messageCount).toBe(2);
  });

  test('skips attachment/permission-mode lines for message count', async () => {
    const { parseSessionFile } = await import('./sessions');
    const lines = [
      JSON.stringify({ type: 'permission-mode', permissionMode: 'default', sessionId: 'S5' }),
      JSON.stringify({ type: 'user', timestamp: '2026-04-22T10:00:00Z', sessionId: 'S5', cwd: '/p' }),
      JSON.stringify({ type: 'attachment', timestamp: '2026-04-22T10:00:01Z', sessionId: 'S5' }),
      JSON.stringify({ type: 'assistant', timestamp: '2026-04-22T10:00:10Z', sessionId: 'S5',
        message: { model: 'claude-opus-4-7', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }),
    ];
    const result = await parseSessionFile(streamOf(...lines), 'S5');
    expect(result.messageCount).toBe(2); // user + assistant only
  });

  test('returns null-ish fields if every line is unparseable', async () => {
    const { parseSessionFile } = await import('./sessions');
    const result = await parseSessionFile(streamOf('nope', 'also nope'), 'S6');
    expect(result.cwd).toBe('');
    expect(result.startedAt).toBe('');
    expect(result.messageCount).toBe(0);
    expect(result.primaryModel).toBeNull();
    expect(result.tokensByModel).toEqual({});
  });
});
