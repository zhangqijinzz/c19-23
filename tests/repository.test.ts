import { describe, expect, it } from 'vitest';
import { createStarterDocument } from '../src/domain';
import { LocalLayoutRepository } from '../src/repository';
import { BrowserStorageService } from '../src/storageService';
import type { HistoryStack } from '../src/types';

const STORAGE_KEY = 'exposketch.document.v1';

const sampleHistory = (): HistoryStack => ({
  entries: [{ id: 'e1', label: '初始布局', at: 1, document: createStarterDocument(), selectedId: 'stage-1' }],
  index: 0,
});

describe('LocalLayoutRepository', () => {
  it('falls back to the starter document when persisted JSON is damaged', async () => {
    window.localStorage.setItem(STORAGE_KEY, '{broken-json');
    const repository = new LocalLayoutRepository(new BrowserStorageService());
    expect(await repository.load()).toEqual({ version: 2, document: createStarterDocument(), history: null });
    window.localStorage.clear();
  });

  it('migrates a legacy bare document save without history', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(createStarterDocument()));
    const repository = new LocalLayoutRepository(new BrowserStorageService());
    const loaded = await repository.load();
    expect(loaded.document).toEqual(createStarterDocument());
    expect(loaded.history).toBeNull();
    window.localStorage.clear();
  });

  it('round-trips the document together with the history stack', async () => {
    const repository = new LocalLayoutRepository(new BrowserStorageService());
    await repository.save(createStarterDocument(), sampleHistory());
    const loaded = await repository.load();
    expect(loaded.document).toEqual(createStarterDocument());
    expect(loaded.history?.entries).toHaveLength(1);
    expect(loaded.history?.index).toBe(0);
    window.localStorage.clear();
  });

  it('drops damaged history entries, clamps the index and clears dangling selections', async () => {
    const damaged = {
      version: 2,
      document: createStarterDocument(),
      history: {
        entries: [
          { id: 'bad', label: 42, at: 'x', document: null, selectedId: null },
          { id: 'ok', label: '移动 分享舞台', at: 2, document: createStarterDocument(), selectedId: 'ghost-element' },
        ],
        index: 9,
      },
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(damaged));
    const repository = new LocalLayoutRepository(new BrowserStorageService());
    const loaded = await repository.load();
    expect(loaded.history?.entries).toHaveLength(1);
    expect(loaded.history?.entries[0].id).toBe('ok');
    expect(loaded.history?.entries[0].selectedId).toBeNull();
    expect(loaded.history?.index).toBe(0);
    window.localStorage.clear();
  });
});
