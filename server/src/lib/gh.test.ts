import { beforeEach, describe, expect, test, vi } from 'vitest';

describe('gh token + graphql', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  test('reads token from gh auth token and caches it', async () => {
    let calls = 0;
    const runner = async (_cmd: string, args: string[]) => {
      if (args[0] === 'auth' && args[1] === 'token') {
        calls++;
        return { stdout: 'gho_secret\n', stderr: '' };
      }
      return { stdout: '', stderr: '' };
    };
    const fetcher = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ data: { viewer: { login: 'me' } } }),
        }) as unknown as Response,
    );

    const { graphql, __resetTokenForTests } = await import('./gh');
    __resetTokenForTests();

    await graphql('query{viewer{login}}', {}, { runner, fetcher });
    await graphql('query{viewer{login}}', {}, { runner, fetcher });

    expect(calls).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const firstCall = fetcher.mock.calls[0] as unknown as
      | [unknown, RequestInit | undefined]
      | undefined;
    expect(firstCall).toBeDefined();
    const init = firstCall?.[1];
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe('Bearer gho_secret');
  });

  test('refreshes token on 401 and retries once', async () => {
    const runner = async () => ({ stdout: 'gho_secret\n', stderr: '' });
    let count = 0;
    const fetcher = vi.fn(async () => {
      count++;
      if (count === 1) {
        return {
          ok: false,
          status: 401,
          text: async () => 'unauthorized',
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: { x: 1 } }),
      } as unknown as Response;
    });
    const { graphql, __resetTokenForTests } = await import('./gh');
    __resetTokenForTests();
    const result = await graphql('query', {}, { runner, fetcher });
    expect(result).toEqual({ x: 1 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  test('throws GH_AUTH_MISSING when gh fails', async () => {
    const runner = async () => {
      throw new Error('not logged in');
    };
    const fetcher = vi.fn();
    const { graphql, __resetTokenForTests } = await import('./gh');
    __resetTokenForTests();
    await expect(graphql('q', {}, { runner, fetcher })).rejects.toMatchObject({
      code: 'GH_AUTH_MISSING',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
