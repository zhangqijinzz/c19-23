import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStarterDocument, findElement } from '../src/domain';
import type { HistoryStack, LayoutDocument, PersistedLayout } from '../src/types';
import { ExpoSketchViewModel } from '../src/viewModel';

const persistedOf = (document: LayoutDocument, history: HistoryStack | null = null): PersistedLayout => ({ version: 2, document, history });

const fakeRepository = (initial?: PersistedLayout) => ({
  load: vi.fn(async () => initial ?? persistedOf(createStarterDocument())),
  save: vi.fn(async (_document: LayoutDocument, _history: HistoryStack) => {}),
});

const failingSaveRepository = () => ({
  load: vi.fn(async () => persistedOf(createStarterDocument())),
  save: vi.fn(async () => { throw new Error('quota'); }),
});

const selectionIsValid = (vm: ExpoSketchViewModel) =>
  vm.state.selectedId === null || vm.state.document.elements.some((element) => element.id === vm.state.selectedId);

describe('history: operation coverage', () => {
  it('records move, resize, rotate, add, remove and field changes as undoable entries', async () => {
    const vm = new ExpoSketchViewModel(fakeRepository());
    await vm.initialize();
    expect(vm.state.history.entries).toHaveLength(1);

    vm.selectElement('stage-1');
    vm.moveElement('stage-1', 12, 4);
    vm.resizeSelected(9, 5);
    vm.rotateSelected();
    vm.addElement('booth');
    vm.resizeField(32, 20);
    vm.selectElement('booth-1');
    vm.removeSelected();

    const labels = vm.state.history.entries.map((entry) => entry.label);
    expect(labels).toHaveLength(7);
    expect(labels[1]).toContain('移动');
    expect(labels[2]).toContain('尺寸');
    expect(labels[3]).toContain('旋转');
    expect(labels[4]).toContain('添加');
    expect(labels[5]).toContain('场地');
    expect(labels[6]).toContain('移除');

    while (vm.state.history.index > 0) vm.undo();
    expect(vm.state.document).toEqual(createStarterDocument());
    expect(vm.state.selectedId).toBe('entry-1');

    while (vm.state.history.index < vm.state.history.entries.length - 1) vm.redo();
    expect(findElement(vm.state.document, 'stage-1')).toMatchObject({ x: 12, y: 4, width: 9, height: 5, rotation: 90 });
    expect(vm.state.document.field).toEqual({ width: 32, height: 20 });
    expect(findElement(vm.state.document, 'booth-1')).toBeNull();
  });

  it('makes resetting the example layout undoable', () => {
    const vm = new ExpoSketchViewModel(fakeRepository());
    vm.addElement('booth');
    expect(vm.state.document.elements).toHaveLength(6);
    vm.resetExample();
    expect(vm.state.document.elements).toHaveLength(5);
    vm.undo();
    expect(vm.state.document.elements).toHaveLength(6);
    vm.redo();
    expect(vm.state.document.elements).toHaveLength(5);
  });

  it('drops the redo tail once a new operation is recorded', () => {
    const vm = new ExpoSketchViewModel(fakeRepository());
    vm.moveElement('stage-1', 12, 4);
    vm.undo();
    vm.addElement('seating');
    expect(vm.state.history.index).toBe(vm.state.history.entries.length - 1);
    expect(vm.state.history.entries.some((entry) => entry.label.includes('移动'))).toBe(false);
    vm.redo();
    expect(findElement(vm.state.document, 'stage-1')?.x).not.toBe(12);
  });
});

describe('history: drag coalescing', () => {
  it('merges a continuous drag into a single entry', () => {
    const vm = new ExpoSketchViewModel(fakeRepository());
    vm.beginTransform();
    vm.moveElement('stage-1', 5, 3);
    vm.moveElement('stage-1', 6, 4);
    vm.moveElement('stage-1', 7, 5);
    vm.moveElement('stage-1', 8, 6);
    vm.endTransform();
    expect(vm.state.history.entries).toHaveLength(2);
    expect(vm.state.history.entries[1].label).toContain('移动');
    vm.undo();
    expect(findElement(vm.state.document, 'stage-1')).toMatchObject({ x: 10, y: 1.5 });
    vm.redo();
    expect(findElement(vm.state.document, 'stage-1')).toMatchObject({ x: 8, y: 6 });
  });

  it('starts a new entry for the next drag after the gesture ends', () => {
    const vm = new ExpoSketchViewModel(fakeRepository());
    vm.beginTransform();
    vm.moveElement('stage-1', 5, 3);
    vm.endTransform();
    vm.beginTransform();
    vm.moveElement('stage-1', 9, 6);
    vm.endTransform();
    expect(vm.state.history.entries).toHaveLength(3);
  });

  it('ignores pointer moves that do not change the rounded position', () => {
    const vm = new ExpoSketchViewModel(fakeRepository());
    vm.beginTransform();
    vm.moveElement('stage-1', 10.01, 1.54);
    vm.endTransform();
    expect(vm.state.history.entries).toHaveLength(1);
  });

  it('merges rapid resize keystrokes but separates edits after a pause', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const vm = new ExpoSketchViewModel(fakeRepository());
    vm.resizeSelected(9, 4);
    vi.setSystemTime(1_300);
    vm.resizeSelected(9.5, 4);
    expect(vm.state.history.entries).toHaveLength(2);
    vi.setSystemTime(5_000);
    vm.resizeSelected(10, 4);
    expect(vm.state.history.entries).toHaveLength(3);
    vi.useRealTimers();
  });
});

describe('history: jumping restores the full editing context', () => {
  it('restores selection and analysis conclusions when jumping to any step', () => {
    const vm = new ExpoSketchViewModel(fakeRepository());
    vm.moveElement('stage-1', 4, 2);
    expect(vm.state.analysis.overlaps).toHaveLength(1);
    vm.selectElement('booth-2');
    vm.addElement('entrance');
    const addedId = vm.state.selectedId;
    expect(vm.state.analysis.overlaps).toHaveLength(1);

    vm.jumpToHistory(0);
    expect(vm.state.selectedId).toBe('stage-1');
    expect(vm.state.analysis.overlaps).toHaveLength(0);
    expect(vm.state.document.elements.some((element) => element.id === addedId)).toBe(false);

    vm.jumpToHistory(1);
    expect(vm.state.selectedId).toBe('stage-1');
    expect(vm.state.analysis.overlaps.length).toBeGreaterThan(0);

    vm.jumpToHistory(vm.state.history.entries.length - 1);
    expect(vm.state.selectedId).toBe(addedId);
    expect(vm.state.document.elements.some((element) => element.id === addedId)).toBe(true);
  });

  it('brings deleted elements back without dangling selection when jumping across a removal', () => {
    const vm = new ExpoSketchViewModel(fakeRepository());
    vm.selectElement('booth-1');
    vm.removeSelected();
    expect(findElement(vm.state.document, 'booth-1')).toBeNull();

    vm.jumpToHistory(0);
    expect(findElement(vm.state.document, 'booth-1')).not.toBeNull();
    expect(selectionIsValid(vm)).toBe(true);

    vm.jumpToHistory(1);
    expect(findElement(vm.state.document, 'booth-1')).toBeNull();
    expect(vm.state.selectedId).not.toBe('booth-1');
    expect(selectionIsValid(vm)).toBe(true);
  });

  it('sanitizes history entries that reference elements missing from their snapshot', async () => {
    const document = createStarterDocument();
    const history: HistoryStack = {
      entries: [
        { id: 'e1', label: '初始布局', at: 1, document, selectedId: 'ghost-element' },
        { id: 'e2', label: '移动 分享舞台', at: 2, document, selectedId: 'booth-1' },
      ],
      index: 1,
    };
    const vm = new ExpoSketchViewModel(fakeRepository(persistedOf(document, history)));
    await vm.initialize();
    expect(vm.state.selectedId).toBe('booth-1');
    vm.jumpToHistory(0);
    expect(vm.state.selectedId).toBeNull();
    expect(selectionIsValid(vm)).toBe(true);
  });
});

describe('history: autosave coordination', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.localStorage.clear());

  it('persists the document together with the history stack on every change', async () => {
    const repository = fakeRepository();
    const vm = new ExpoSketchViewModel(repository);
    await vm.initialize();
    vm.addElement('stage');
    expect(repository.save).toHaveBeenCalledWith(vm.state.document, vm.state.history);
    const calls = repository.save.mock.calls;
    const [, savedHistory] = calls[calls.length - 1] as [LayoutDocument, HistoryStack];
    expect(savedHistory.entries[savedHistory.entries.length - 1].label).toContain('添加');
  });

  it('persists the new position after undo, redo and jumps', async () => {
    const repository = fakeRepository();
    const vm = new ExpoSketchViewModel(repository);
    await vm.initialize();
    vm.moveElement('stage-1', 12, 4);
    vm.undo();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(repository.save).toHaveBeenLastCalledWith(vm.state.document, expect.objectContaining({ index: 0 }));
    vm.redo();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(repository.save).toHaveBeenLastCalledWith(vm.state.document, expect.objectContaining({ index: 1 }));
  });

  it('keeps the in-memory history intact and undoable when saving fails', async () => {
    const repository = failingSaveRepository();
    const vm = new ExpoSketchViewModel(repository);
    await vm.initialize();
    vm.addElement('booth');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(vm.state.notice.tone).toBe('error');
    expect(vm.state.history.entries).toHaveLength(2);
    expect(vm.state.document.elements).toHaveLength(6);
    vm.undo();
    expect(vm.state.document.elements).toHaveLength(5);
    vm.redo();
    expect(vm.state.document.elements).toHaveLength(6);
  });

  it('restores the document and the whole history after a restart', async () => {
    const starter = createStarterDocument();
    const moved = { ...starter, elements: starter.elements.map((element) => element.id === 'stage-1' ? { ...element, x: 12 } : element) };
    const history: HistoryStack = {
      entries: [
        { id: 'e1', label: '初始布局', at: 1, document: starter, selectedId: 'stage-1' },
        { id: 'e2', label: '移动 分享舞台', at: 2, document: moved, selectedId: 'stage-1' },
      ],
      index: 1,
    };
    const vm = new ExpoSketchViewModel(fakeRepository(persistedOf(moved, history)));
    await vm.initialize();
    expect(vm.state.history.entries).toHaveLength(2);
    expect(vm.state.history.index).toBe(1);
    expect(findElement(vm.state.document, 'stage-1')?.x).toBe(12);
    vm.undo();
    expect(findElement(vm.state.document, 'stage-1')?.x).toBe(10);
  });
});
