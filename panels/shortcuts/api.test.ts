import { describe, expect, test, vi } from 'vitest';

vi.mock('node:fs/promises', async (orig) => {
  const actual = await (orig() as Promise<typeof import('node:fs/promises')>);
  return {
    ...actual,
    readFile: vi.fn(async () =>
      JSON.stringify([
        {
          id: 'asana',
          label: 'Asana',
          links: [{ label: 'Home', url: 'https://app.asana.com' }],
        },
      ]),
    ),
  };
});

describe('shortcuts api', () => {
  test('GET / returns envelope of shortcuts', async () => {
    const { api } = await import('./api');
    const res = await api.request('/');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data).toEqual([
      {
        id: 'asana',
        label: 'Asana',
        links: [{ label: 'Home', url: 'https://app.asana.com' }],
      },
    ]);
  });
});
