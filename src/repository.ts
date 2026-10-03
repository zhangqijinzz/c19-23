import { createStarterDocument } from './domain';
import type { DocumentStorageService } from './storageService';
import type { ExpoElement, HistoryEntry, HistoryStack, LayoutDocument, PersistedLayout } from './types';

export interface LayoutRepository {
  load(): Promise<PersistedLayout>;
  save(document: LayoutDocument, history: HistoryStack): Promise<void>;
}

const isElement = (value: unknown): value is ExpoElement => {
  if (!value || typeof value !== 'object') return false;
  const element = value as Record<string, unknown>;
  return typeof element.id === 'string' && typeof element.kind === 'string' && typeof element.x === 'number' && typeof element.y === 'number' && typeof element.width === 'number' && typeof element.height === 'number' && typeof element.rotation === 'number';
};

const isDocument = (value: unknown): value is LayoutDocument => {
  if (!value || typeof value !== 'object') return false;
  const document = value as Record<string, unknown>;
  const field = document.field as Record<string, unknown> | undefined;
  return document.version === 1 && typeof document.title === 'string' && !!field && typeof field.width === 'number' && typeof field.height === 'number' && Array.isArray(document.elements) && document.elements.every(isElement);
};

const isHistoryEntry = (value: unknown): value is HistoryEntry => {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.id === 'string' && typeof entry.label === 'string' && typeof entry.at === 'number'
    && (typeof entry.selectedId === 'string' || entry.selectedId === null) && isDocument(entry.document);
};

const sanitizeHistory = (value: unknown): HistoryStack | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.entries)) return null;
  const entries = raw.entries.filter(isHistoryEntry).map((entry) => ({
    ...entry,
    selectedId: entry.selectedId && entry.document.elements.some((element) => element.id === entry.selectedId) ? entry.selectedId : null,
  }));
  if (entries.length === 0) return null;
  const index = typeof raw.index === 'number' && Number.isFinite(raw.index)
    ? Math.min(Math.max(Math.trunc(raw.index), 0), entries.length - 1)
    : entries.length - 1;
  return { entries, index };
};

const isPersistedLayout = (value: unknown): value is PersistedLayout => {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Record<string, unknown>;
  return payload.version === 2 && isDocument(payload.document);
};

const fallbackLayout = (): PersistedLayout => ({ version: 2, document: createStarterDocument(), history: null });

export class LocalLayoutRepository implements LayoutRepository {
  constructor(private readonly storage: DocumentStorageService) {}

  async load(): Promise<PersistedLayout> {
    try {
      const saved = await this.storage.read();
      if (isPersistedLayout(saved)) return { version: 2, document: saved.document, history: sanitizeHistory(saved.history) };
      if (isDocument(saved)) return { version: 2, document: saved, history: null };
      return fallbackLayout();
    } catch {
      return fallbackLayout();
    }
  }

  async save(document: LayoutDocument, history: HistoryStack): Promise<void> {
    const payload: PersistedLayout = { version: 2, document, history };
    await this.storage.write(payload);
  }
}
