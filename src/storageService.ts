import type { LayoutDocument, SessionRecord } from './types';

export interface DocumentStorageService {
  read(): Promise<LayoutDocument | null>;
  write(document: LayoutDocument): Promise<void>;
  readSession?(): Promise<SessionRecord | null>;
  writeSession?(session: SessionRecord): Promise<void>;
}

const STORAGE_KEY = 'exposketch.document.v1';
const SESSION_STORAGE_KEY = 'exposketch.session.v2';

const parseJson = (raw: string | null): unknown => {
  if (!raw) return null;
  return JSON.parse(raw);
};

const canUseIndexedDb = () => typeof indexedDB !== 'undefined';

export class BrowserStorageService implements DocumentStorageService {
  async read(): Promise<LayoutDocument | null> {
    if (!canUseIndexedDb()) return parseJson(window.localStorage.getItem(STORAGE_KEY)) as LayoutDocument | null;
    return this.withStore((store) => this.getKey<LayoutDocument>(store, STORAGE_KEY));
  }

  async write(document: LayoutDocument): Promise<void> {
    if (!canUseIndexedDb()) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(document));
      return;
    }
    await this.withStore((store) => this.putKey(store, STORAGE_KEY, document));
  }

  async readSession(): Promise<SessionRecord | null> {
    if (!canUseIndexedDb()) return parseJson(window.localStorage.getItem(SESSION_STORAGE_KEY)) as SessionRecord | null;
    return this.withStore((store) => this.getKey<SessionRecord>(store, SESSION_STORAGE_KEY));
  }

  async writeSession(session: SessionRecord): Promise<void> {
    if (!canUseIndexedDb()) {
      window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
      return;
    }
    await this.withStore((store) => this.putKey(store, SESSION_STORAGE_KEY, session));
  }

  private getKey<T>(store: IDBObjectStore, key: string): Promise<T | null> {
    return new Promise((resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error('读取布局失败'));
    });
  }

  private putKey(store: IDBObjectStore, key: string, value: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = store.put(value, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error('保存布局失败'));
    });
  }

  private withStore<T>(run: (store: IDBObjectStore) => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('exposketch-db', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('documents');
      request.onerror = () => reject(request.error ?? new Error('打开本地数据库失败'));
      request.onsuccess = () => {
        const transaction = request.result.transaction('documents', 'readwrite');
        run(transaction.objectStore('documents')).then(resolve).catch(reject);
        transaction.oncomplete = () => request.result.close();
      };
    });
  }
}
