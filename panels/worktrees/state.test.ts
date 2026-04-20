import { classifyWorktreeState } from '@cc/shared';
import { describe, expect, test } from 'vitest';

const base = {
  dirty: false,
  mergedToMain: false,
  ahead: 0,
  hasUpstream: true,
};

describe('classifyWorktreeState', () => {
  test('dirty wins over merged (data safety)', () => {
    expect(classifyWorktreeState({ ...base, dirty: true, mergedToMain: true })).toBe('dirty');
  });

  test('dirty wins when ahead > 0', () => {
    expect(classifyWorktreeState({ ...base, dirty: true, ahead: 3 })).toBe('dirty');
  });

  test('merged when clean and mergedToMain', () => {
    expect(classifyWorktreeState({ ...base, mergedToMain: true })).toBe('merged');
  });

  test('unpushed when ahead > 0 and not merged', () => {
    expect(classifyWorktreeState({ ...base, ahead: 2 })).toBe('unpushed');
  });

  test('unpushed when no upstream and clean', () => {
    expect(classifyWorktreeState({ ...base, hasUpstream: false })).toBe('unpushed');
  });

  test('pr-pending when clean, has upstream, ahead 0, not merged', () => {
    expect(classifyWorktreeState(base)).toBe('pr-pending');
  });

  test('pr-pending when only behind (ahead 0, behind > 0 is irrelevant)', () => {
    // behind is not part of the classifier input — this just documents the
    // contract: classification does not depend on behind.
    expect(classifyWorktreeState(base)).toBe('pr-pending');
  });
});
