import { describe, expect, test } from 'vitest';

describe('isValidLlmOutput', () => {
  test('accepts valid todo with tags', async () => {
    const { isValidLlmOutput } = await import('./braindump-prompt');
    expect(
      isValidLlmOutput({
        category: 'todo',
        title: 'Buy milk tonight',
        summary: 'Pick up milk on the way home from work.',
        tags: ['home', 'urgency:today'],
      }),
    ).toBe(true);
  });

  test('accepts valid thought with empty tags', async () => {
    const { isValidLlmOutput } = await import('./braindump-prompt');
    expect(
      isValidLlmOutput({
        category: 'thought',
        title: 'Refactor idea',
        summary: 'Could split the processor into two files.',
        tags: [],
      }),
    ).toBe(true);
  });

  test('accepts valid read-later', async () => {
    const { isValidLlmOutput } = await import('./braindump-prompt');
    expect(
      isValidLlmOutput({
        category: 'read-later',
        title: 'Paper on data oriented design',
        summary: 'An article about structuring systems by data access patterns.',
        tags: ['reading'],
      }),
    ).toBe(true);
  });

  test('rejects missing field', async () => {
    const { isValidLlmOutput } = await import('./braindump-prompt');
    expect(isValidLlmOutput({ category: 'todo', title: 't', summary: 's' })).toBe(false);
  });

  test('rejects wrong category', async () => {
    const { isValidLlmOutput } = await import('./braindump-prompt');
    expect(
      isValidLlmOutput({
        category: 'reminder',
        title: 't',
        summary: 's',
        tags: [],
      }),
    ).toBe(false);
  });

  test('rejects non-string title', async () => {
    const { isValidLlmOutput } = await import('./braindump-prompt');
    expect(
      isValidLlmOutput({
        category: 'todo',
        title: 42,
        summary: 's',
        tags: [],
      }),
    ).toBe(false);
  });

  test('rejects non-array tags', async () => {
    const { isValidLlmOutput } = await import('./braindump-prompt');
    expect(
      isValidLlmOutput({
        category: 'todo',
        title: 't',
        summary: 's',
        tags: 'home',
      }),
    ).toBe(false);
  });

  test('rejects non-string tag element', async () => {
    const { isValidLlmOutput } = await import('./braindump-prompt');
    expect(
      isValidLlmOutput({
        category: 'todo',
        title: 't',
        summary: 's',
        tags: ['home', 42],
      }),
    ).toBe(false);
  });

  test('rejects null / non-object', async () => {
    const { isValidLlmOutput } = await import('./braindump-prompt');
    expect(isValidLlmOutput(null)).toBe(false);
    expect(isValidLlmOutput('nope')).toBe(false);
    expect(isValidLlmOutput(undefined)).toBe(false);
  });
});

describe('PROMPT', () => {
  test('mentions the three categories and the JSON rule', async () => {
    const { PROMPT } = await import('./braindump-prompt');
    expect(PROMPT).toContain('todo');
    expect(PROMPT).toContain('thought');
    expect(PROMPT).toContain('read-later');
    expect(PROMPT.toLowerCase()).toContain('json');
  });
});
