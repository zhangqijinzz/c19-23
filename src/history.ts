import type { HistoryEntry, HistorySnapshot, HistoryView } from './types';

export const MAX_HISTORY_ENTRIES = 120;

export const createHistoryEntry = (snapshot: HistorySnapshot, label: string, at = Date.now()): HistoryEntry => ({
  id: `step-${at.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  label,
  at,
  snapshot,
});

export const createHistory = (initial: HistorySnapshot, label = '初始布局', at = Date.now()): HistoryView => ({
  entries: [createHistoryEntry(initial, label, at)],
  currentIndex: 0,
});

export const appendHistory = (history: HistoryView, snapshot: HistorySnapshot, label: string, at = Date.now()): HistoryView => {
  const entries = [...history.entries.slice(0, history.currentIndex + 1), createHistoryEntry(snapshot, label, at)];
  const trimmed = entries.length > MAX_HISTORY_ENTRIES ? entries.slice(entries.length - MAX_HISTORY_ENTRIES) : entries;
  return { entries: trimmed, currentIndex: trimmed.length - 1 };
};

export const jumpHistory = (history: HistoryView, index: number): HistoryView => {
  if (!Number.isInteger(index) || index < 0 || index >= history.entries.length) return history;
  return { entries: history.entries, currentIndex: index };
};

export const currentSnapshot = (history: HistoryView): HistorySnapshot => history.entries[history.currentIndex].snapshot;
