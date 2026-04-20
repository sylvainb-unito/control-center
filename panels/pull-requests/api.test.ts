import { describe, expect, test, vi } from 'vitest';

vi.mock('@cc/server/lib/gh', () => ({
  graphql: vi.fn(async () => ({
    viewer: {
      login: 'me',
      pullRequests: {
        nodes: [
          {
            number: 1,
            title: 'a',
            url: 'u',
            isDraft: false,
            createdAt: 'c',
            updatedAt: 'up',
            reviewDecision: 'APPROVED',
            repository: { nameWithOwner: 'o/r' },
            commits: {
              nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }],
            },
          },
        ],
      },
    },
    search: {
      nodes: [
        {
          number: 2,
          title: 'b',
          url: 'u2',
          isDraft: true,
          createdAt: 'c2',
          updatedAt: 'u2',
          reviewDecision: null,
          repository: { nameWithOwner: 'o/r2' },
          commits: { nodes: [] },
        },
      ],
    },
  })),
  GhError: class extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));

describe('pull-requests api', () => {
  test('GET / maps graphql payload to envelope', async () => {
    const { api } = await import('./api');
    const res = await api.request('/');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.authored).toHaveLength(1);
    expect(body.data.authored[0]).toMatchObject({
      number: 1,
      repo: 'o/r',
      checks: 'SUCCESS',
      reviewDecision: 'APPROVED',
    });
    expect(body.data.reviewRequested[0]).toMatchObject({
      number: 2,
      repo: 'o/r2',
      checks: null,
      isDraft: true,
    });
  });

  test('GH_AUTH_MISSING surfaces as 401 envelope', async () => {
    const gh = await import('@cc/server/lib/gh');
    const GhError = gh.GhError as unknown as new (code: string, message: string) => Error;
    (gh.graphql as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new GhError('GH_AUTH_MISSING', 'no auth'),
    );
    const { api } = await import('./api');
    const res = await api.request('/');
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({
      ok: false,
      error: { code: 'GH_AUTH_MISSING' },
    });
  });
});
