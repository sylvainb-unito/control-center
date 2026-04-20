import type { Envelope } from '@cc/shared';

export function ok<T>(data: T): Envelope<T> {
  return { ok: true, data };
}

export function fail(code: string, message: string): Envelope<never> {
  return { ok: false, error: { code, message } };
}
