import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fetchJson } from './fetchJson';

describe('fetchJson', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('returns data on ok envelope', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, data: { x: 1 } }),
    });
    await expect(fetchJson<{ x: number }>('/api/x')).resolves.toEqual({ x: 1 });
  });

  test('throws envelope error', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: false, error: { code: 'X', message: 'y' } }),
    });
    await expect(fetchJson('/api/x')).rejects.toMatchObject({ code: 'X', message: 'y' });
  });

  test('throws on http error', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    });
    await expect(fetchJson('/api/x')).rejects.toMatchObject({ code: 'HTTP_500' });
  });
});
