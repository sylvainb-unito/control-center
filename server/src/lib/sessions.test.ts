import { describe, expect, test } from 'vitest';

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
