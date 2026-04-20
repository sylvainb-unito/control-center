import type { Envelope, EnvelopeError } from '@cc/shared';

export class FetchError extends Error implements EnvelopeError {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'FetchError';
  }
}

export async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(input, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new FetchError('NETWORK_ERROR', msg);
  }

  if (!res.ok) {
    throw new FetchError(`HTTP_${res.status}`, `Request failed: ${res.status}`);
  }

  let body: Envelope<T>;
  try {
    body = (await res.json()) as Envelope<T>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new FetchError('PARSE_ERROR', `Invalid JSON response: ${msg}`);
  }

  if (!body.ok) {
    throw new FetchError(body.error.code, body.error.message);
  }
  return body.data;
}
