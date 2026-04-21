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

  test('pr-pending when behind > 0 (behind is not a classifier input)', () => {
    // A full Worktree has `behind`, but WorktreeClassifiable intentionally
    // does not. This test documents that structural typing passes extras
    // through harmlessly and that classification does not depend on `behind`.
    const wt = { ...base, behind: 5 } as const;
    expect(classifyWorktreeState(wt)).toBe('pr-pending');
  });

  test('orphan wins over everything (dirty + merged + ahead + no upstream)', () => {
    expect(
      classifyWorktreeState({
        ...base,
        orphan: true,
        dirty: true,
        mergedToMain: true,
        ahead: 5,
        hasUpstream: false,
      }),
    ).toBe('orphan');
  });

  test('orphan false does not affect other classification', () => {
    expect(classifyWorktreeState({ ...base, orphan: false, mergedToMain: true })).toBe('merged');
  });

  test('orphan omitted defaults to non-orphan behavior', () => {
    expect(classifyWorktreeState({ ...base, mergedToMain: true })).toBe('merged');
  });
});
