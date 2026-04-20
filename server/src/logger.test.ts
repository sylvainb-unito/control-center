import pino from 'pino';
import { describe, expect, test } from 'vitest';

function buildLogger(stream: NodeJS.WritableStream) {
  return pino(
    {
      level: 'info',
      redact: {
        paths: [
          'token',
          'authorization',
          'Authorization',
          'cookie',
          'Cookie',
          '*.token',
          '*.authorization',
          '*.Authorization',
          '*.cookie',
          '*.Cookie',
        ],
        censor: '[REDACTED]',
      },
    },
    stream,
  );
}

function captureLog(run: (log: pino.Logger) => void): Record<string, unknown> {
  const chunks: string[] = [];
  const stream = {
    write(chunk: string) {
      chunks.push(chunk);
    },
  } as unknown as NodeJS.WritableStream;
  const log = buildLogger(stream);
  run(log);
  const line = chunks.join('').trim().split('\n').pop() ?? '';
  return JSON.parse(line) as Record<string, unknown>;
}

describe('logger redaction', () => {
  test('redacts top-level sensitive keys', () => {
    const out = captureLog((l) =>
      l.info({ token: 's1', authorization: 's2', cookie: 's3', keep: 'v' }, 'hi'),
    );
    expect(out.token).toBe('[REDACTED]');
    expect(out.authorization).toBe('[REDACTED]');
    expect(out.cookie).toBe('[REDACTED]');
    expect(out.keep).toBe('v');
  });

  test('redacts one-level nested sensitive keys', () => {
    const out = captureLog((l) =>
      l.info({ headers: { Authorization: 'Bearer x', cookie: 'sid=abc', keep: 'v' } }, 'hi'),
    );
    const headers = out.headers as Record<string, unknown>;
    expect(headers.Authorization).toBe('[REDACTED]');
    expect(headers.cookie).toBe('[REDACTED]');
    expect(headers.keep).toBe('v');
  });
});
