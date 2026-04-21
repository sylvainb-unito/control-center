import { describe, expect, test } from 'vitest';
import { buildPrompt, isValidLlmOutput } from './ai-news-prompt';

describe('buildPrompt', () => {
  test('is non-empty and mentions each category', () => {
    const p = buildPrompt();
    expect(p.length).toBeGreaterThan(100);
    for (const cat of ['tool', 'model', 'protocol', 'research', 'community']) {
      expect(p).toContain(cat);
    }
    expect(p).toMatch(/JSON/);
  });
});

describe('isValidLlmOutput', () => {
  const validItem = {
    title: 't',
    oneLineSummary: 's',
    url: 'https://x',
    category: 'tool',
  };
  const sample = {
    summary: 'today in AI…',
    items: Array.from({ length: 10 }, () => ({ ...validItem })),
  };

  test('accepts well-formed object', () => {
    expect(isValidLlmOutput(sample)).toBe(true);
  });

  test('rejects missing summary', () => {
    const { summary: _, ...rest } = sample;
    expect(isValidLlmOutput(rest)).toBe(false);
  });

  test('rejects empty items array', () => {
    expect(isValidLlmOutput({ ...sample, items: [] })).toBe(false);
  });

  test('rejects >15 items', () => {
    const big = { ...sample, items: Array.from({ length: 16 }, () => ({ ...validItem })) };
    expect(isValidLlmOutput(big)).toBe(false);
  });

  test('rejects item with unknown category', () => {
    const bad = { ...sample, items: [{ ...validItem, category: 'other' }] };
    expect(isValidLlmOutput(bad)).toBe(false);
  });

  test('rejects item with non-string url', () => {
    const bad = { ...sample, items: [{ ...validItem, url: 42 }] };
    expect(isValidLlmOutput(bad)).toBe(false);
  });

  test('rejects item with javascript: url', () => {
    const bad = { ...sample, items: [{ ...validItem, url: 'javascript:alert(1)' }] };
    expect(isValidLlmOutput(bad)).toBe(false);
  });

  test('rejects item with non-http url', () => {
    const bad = { ...sample, items: [{ ...validItem, url: 'ftp://example.com' }] };
    expect(isValidLlmOutput(bad)).toBe(false);
  });

  test('rejects non-object input', () => {
    expect(isValidLlmOutput(null)).toBe(false);
    expect(isValidLlmOutput('hello')).toBe(false);
    expect(isValidLlmOutput(undefined)).toBe(false);
  });

  test('rejects empty summary string', () => {
    expect(isValidLlmOutput({ ...sample, summary: '' })).toBe(false);
  });
});
