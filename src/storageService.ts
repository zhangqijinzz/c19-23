export interface DocumentStorageService {
  read(): Promise<unknown>;
  write(payload: unknown): Promise<void>;
}

const STORAGE_KEY = 'exposketch.document.v1';

const canUseIndexedDb = () => typeof indexedDB !== 'undefined';

export class BrowserStorageService implements DocumentStorageService {
  async read(): Promise<unknown> {
    if (!canUseIndexedDb()) {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as unknown) : null;
    }
    return this.withDatabase((store) => new Promise<unknown>((resolve, reject) => {
      const request = store.get(STORAGE_KEY);
      request.onsuccess = () => resolve((request.result as unknown) ?? null);
      request.onerror = () => reject(request.error ?? new Error('读取布局失败'));
    }));
  }

  async write(payload: unknown): Promise<void> {
    if (!canUseIndexedDb()) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      return;
    }
    await this.withDatabase((store) => new Promise<void>((resolve, reject) => {
      const request = store.put(payload, STORAGE_KEY);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error('保存布局失败'));
    }));
  }

  private withDatabase<T>(run: (store: IDBObjectStore) => Promise<T>): Promise<T> {
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
