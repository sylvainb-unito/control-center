import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../logger';

const execFile = promisify(execFileCb);

export class GhError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'GhError';
  }
}

type Runner = (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;
type Fetcher = typeof fetch;

const defaultRunner: Runner = async (cmd, args) => {
  const { stdout, stderr } = await execFile(cmd, args);
  return { stdout, stderr };
};

let cachedToken: string | null = null;

export function __resetTokenForTests(): void {
  cachedToken = null;
}

async function getToken(runner: Runner, refresh = false): Promise<string> {
  if (cachedToken && !refresh) return cachedToken;
  try {
    const { stdout } = await runner('gh', ['auth', 'token']);
    const token = stdout.trim();
    if (!token) throw new Error('empty token');
    cachedToken = token;
    return token;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Deliberately do NOT log the error with full detail — `gh auth token` stderr
    // can contain diagnostic info; we truncate and avoid echoing the token itself.
    logger.warn({ err: msg.slice(0, 200) }, 'gh auth token failed');
    throw new GhError('GH_AUTH_MISSING', `gh auth token failed: ${msg.slice(0, 200)}`);
  }
}

export async function graphql<T>(
  query: string,
  variables: Record<string, unknown> = {},
  opts: { runner?: Runner; fetcher?: Fetcher } = {},
): Promise<T> {
  const runner = opts.runner ?? defaultRunner;
  const fetcher = opts.fetcher ?? fetch;

  const doFetch = async (token: string): Promise<Response> =>
    fetcher('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'user-agent': 'control-center/0.1',
      },
      body: JSON.stringify({ query, variables }),
    });

  let token = await getToken(runner);
  let res = await doFetch(token);

  if (res.status === 401) {
    token = await getToken(runner, true);
    res = await doFetch(token);
  }

  const text = await res.text();
  if (!res.ok) {
    throw new GhError(`HTTP_${res.status}`, text.slice(0, 200));
  }
  const body = JSON.parse(text) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };
  if (body.errors?.length) {
    throw new GhError(
      'GRAPHQL_ERROR',
      body.errors
        .map((e) => e.message)
        .join('; ')
        .slice(0, 200),
    );
  }
  return body.data as T;
}
