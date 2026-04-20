import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail, ok } from '@cc/server/envelope';
import { Hono } from 'hono';
import type { Shortcut } from './types';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = path.resolve(HERE, '..', '..', 'config', 'shortcuts.json');

export const api = new Hono();

api.get('/', async (c) => {
  try {
    const raw = await readFile(CONFIG, 'utf8');
    const data = JSON.parse(raw) as Shortcut[];
    return c.json(ok(data));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json(fail('SHORTCUTS_READ_FAILED', msg.slice(0, 200)), 500);
  }
});
