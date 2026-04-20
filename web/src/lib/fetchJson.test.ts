import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fetchJson } from './fetchJson';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status });
}

describe('fetchJson', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('returns data on ok envelope', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ ok: true, data: { x: 1 } }),
    );
    await expect(fetchJson<{ x: number }>('/api/x')).resolves.toEqual({ x: 1 });
  });

  test('throws envelope error preserving code and message', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ ok: false, error: { code: 'X', message: 'y' } }),
    );
    await expect(fetchJson('/api/x')).rejects.toMatchObject({ code: 'X', message: 'y' });
  });

  test('throws HTTP_<status> on non-ok status', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse({}, 500));
    await expect(fetchJson('/api/x')).rejects.toMatchObject({ code: 'HTTP_500' });
  });

  test('throws PARSE_ERROR when body is not JSON', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      textResponse('<html>not json</html>'),
    );
    await expect(fetchJson('/api/x')).rejects.toMatchObject({ code: 'PARSE_ERROR' });
  });

  test('throws NETWORK_ERROR when fetch rejects', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(fetchJson('/api/x')).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      message: 'Failed to fetch',
    });
  });

  test('caller-provided content-type overrides the default', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ ok: true, data: null }),
    );
    await fetchJson('/api/x', { headers: { 'content-type': 'application/custom' } });
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] ?? [];
    const headers = (init as RequestInit | undefined)?.headers as
      | Record<string, string>
      | undefined;
    expect(headers?.['content-type']).toBe('application/custom');
  });
});
