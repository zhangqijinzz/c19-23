import type { HistoryEntry, HistoryStack, LayoutDocument } from './types';

export const MAX_HISTORY_ENTRIES = 50;
export const MERGE_WINDOW_MS = 800;

export const createInitialHistory = (document: LayoutDocument, selectedId: string | null): HistoryStack => ({
  entries: [{ id: 'entry-initial', label: '初始布局', at: Date.now(), document, selectedId }],
  index: 0,
});

export const capHistoryStack = (stack: HistoryStack): HistoryStack => {
  if (stack.entries.length <= MAX_HISTORY_ENTRIES) return stack;
  const dropped = stack.entries.length - MAX_HISTORY_ENTRIES;
  const entries = stack.entries.slice(dropped);
  return { entries, index: Math.max(0, Math.min(stack.index - dropped, entries.length - 1)) };
};

export const sanitizeEntrySelection = (entry: HistoryEntry): string | null =>
  entry.selectedId && entry.document.elements.some((element) => element.id === entry.selectedId) ? entry.selectedId : null;
