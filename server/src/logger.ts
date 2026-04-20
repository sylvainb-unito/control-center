import pino from 'pino';

const SENSITIVE_KEYS = /token|authorization|cookie/i;

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: ['*.token', '*.Authorization', '*.authorization', '*.cookie'],
    censor: '[REDACTED]',
  },
  formatters: {
    log(obj) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        out[k] = SENSITIVE_KEYS.test(k) ? '[REDACTED]' : v;
      }
      return out;
    },
  },
});
