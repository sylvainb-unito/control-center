import { describe, expect, test } from 'vitest';
import { fail, ok } from './envelope';

describe('envelope', () => {
  test('ok wraps data', () => {
    expect(ok({ count: 1 })).toEqual({ ok: true, data: { count: 1 } });
  });

  test('fail wraps code and message', () => {
    expect(fail('E_CODE', 'message')).toEqual({
      ok: false,
      error: { code: 'E_CODE', message: 'message' },
    });
  });
});
