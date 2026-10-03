import { createStarterDocument } from './domain';
import { createHistory } from './history';
import type { DocumentStorageService } from './storageService';
import type { ExpoElement, HistoryEntry, HistorySnapshot, LayoutDocument, SessionRecord } from './types';

export interface LayoutRepository {
  load(): Promise<LayoutDocument>;
  save(document: LayoutDocument): Promise<void>;
}

export interface SessionRepository {
  loadSession(): Promise<SessionRecord | null>;
  saveSession(session: SessionRecord): Promise<void>;
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

const isSnapshot = (value: unknown): value is HistorySnapshot => {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Record<string, unknown>;
  if (!isDocument(snapshot.document) || (snapshot.selectedId !== null && typeof snapshot.selectedId !== 'string')) return false;
  return snapshot.selectedId === null || snapshot.document.elements.some((element) => element.id === snapshot.selectedId);
};

const isHistoryEntry = (value: unknown): value is HistoryEntry => {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.id === 'string' && typeof entry.label === 'string' && typeof entry.at === 'number' && isSnapshot(entry.snapshot);
};

/**
 * 校验并清洗持久化会话：损坏条目直接丢弃；
 * 每个快照都必须指向真实存在的元素，选中悬空时回退到首元素。
 */
export const sanitizeSession = (value: unknown): SessionRecord | null => {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.version !== 2 || !record.history || typeof record.history !== 'object') return null;
  const view = record.history as Record<string, unknown>;
  if (!Array.isArray(view.entries) || typeof view.currentIndex !== 'number') return null;
  const entries = view.entries.filter(isHistoryEntry);
  if (!entries.length) return null;
  const currentIndex = view.currentIndex >= 0 && view.currentIndex < entries.length ? view.currentIndex : entries.length - 1;
  return { version: 2, history: { entries, currentIndex } };
};

export class LocalLayoutRepository implements LayoutRepository {
  constructor(private readonly storage: DocumentStorageService) {}

  async load(): Promise<LayoutDocument> {
    try {
      const saved = await this.storage.read();
      return isDocument(saved) ? saved : createStarterDocument();
    } catch {
      return createStarterDocument();
    }
  }

  async save(document: LayoutDocument): Promise<void> {
    await this.storage.write(document);
  }
}

export class LocalSessionRepository implements SessionRepository {
  constructor(private readonly storage: DocumentStorageService) {}

  async loadSession(): Promise<SessionRecord | null> {
    if (!this.storage.readSession || !this.storage.writeSession) return null;
    try {
      return sanitizeSession(await this.storage.readSession());
    } catch {
      return null;
    }
  }

  async saveSession(session: SessionRecord): Promise<void> {
    if (!this.storage.writeSession) throw new Error('当前环境不支持会话持久化');
    await this.storage.writeSession(session);
  }
}

export const fallbackSession = (): SessionRecord => {
  const document = createStarterDocument();
  return { version: 2, history: createHistory({ document, selectedId: document.elements[0]?.id ?? null }, '示例布局') };
};
