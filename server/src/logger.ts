import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
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
});
