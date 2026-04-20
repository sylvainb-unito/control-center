import type { Envelope, EnvelopeError } from '@cc/shared';

export class FetchError extends Error implements EnvelopeError {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    throw new FetchError(`HTTP_${res.status}`, `Request failed: ${res.status}`);
  }
  const body = (await res.json()) as Envelope<T>;
  if (!body.ok) {
    throw new FetchError(body.error.code, body.error.message);
  }
  return body.data;
}
