import { describe, expect, it } from 'vitest';
import { createStarterDocument } from '../src/domain';
import { appendHistory, createHistory, jumpHistory, MAX_HISTORY_ENTRIES } from '../src/history';
import type { HistorySnapshot, LayoutDocument } from '../src/types';

const snapshot = (document: LayoutDocument, selectedId: string | null = null): HistorySnapshot => ({ document, selectedId: selectedId ?? document.elements[0]?.id ?? null });

describe('history engine', () => {
  it('appends entries and moves the current pointer', () => {
    const base = snapshot(createStarterDocument());
    const history = appendHistory(createHistory(base, '初始布局'), { ...base, selectedId: 'x' }, '移动元素');
    expect(history.entries).toHaveLength(2);
    expect(history.currentIndex).toBe(1);
  });

  it('truncates redo branches when a new edit is made after jumping back', () => {
    const base = snapshot(createStarterDocument());
    let history = createHistory(base, '初始布局');
    history = appendHistory(history, base, '第一步');
    history = appendHistory(history, base, '第二步');
    history = jumpHistory(history, 1);
    history = appendHistory(history, base, '新分支');
    expect(history.entries.map((entry) => entry.label)).toEqual(['初始布局', '第一步', '新分支']);
  });

  it('caps the number of retained entries and keeps the newest steps', () => {
    const base = snapshot(createStarterDocument());
    let history = createHistory(base, '初始布局');
    for (let index = 0; index < MAX_HISTORY_ENTRIES + 10; index += 1) history = appendHistory(history, base, `步骤 ${index}`);
    expect(history.entries).toHaveLength(MAX_HISTORY_ENTRIES);
    expect(history.currentIndex).toBe(MAX_HISTORY_ENTRIES - 1);
    expect(history.entries[history.entries.length - 1].label).toBe(`步骤 ${MAX_HISTORY_ENTRIES + 9}`);
  });
});
