import { describe, expect, it, vi } from 'vitest';
import { createStarterDocument } from '../src/domain';
import { sanitizeSession } from '../src/repository';
import type { LayoutRepository, SessionRepository } from '../src/repository';
import type { LayoutDocument, SessionRecord } from '../src/types';
import { ExpoSketchViewModel } from '../src/viewModel';

const fakeRepository = (initial: LayoutDocument | null = null): LayoutRepository => ({
  load: vi.fn(async () => initial ?? createStarterDocument()),
  save: vi.fn(async () => {}),
});

const fakeSessionRepository = (failSave = false): { sessions: SessionRepository; saved: () => SessionRecord | null } => {
  let stored: SessionRecord | null = null;
  return {
    sessions: {
      loadSession: vi.fn(async () => stored),
      saveSession: vi.fn(async (session: SessionRecord) => {
        if (failSave) throw new Error('quota');
        stored = session;
      }),
    },
    saved: () => stored,
  };
};

const waitForSave = async () => { await Promise.resolve(); await Promise.resolve(); };

describe('undo/redo history', () => {
  it('records discrete edits and restores document, selection and analysis together on undo', async () => {
    const vm = new ExpoSketchViewModel(fakeRepository(), fakeSessionRepository().sessions);
    await vm.initialize();
    const originalCount = vm.state.document.elements.length;

    vm.addElement('booth');
    vm.rotateSelected();
    await waitForSave();
    expect(vm.state.history.entries).toHaveLength(3);
    const overlapsBeforeMove = vm.state.analysis.overlaps.length;

    vm.moveElement(vm.state.selectedId ?? 'x', 4.5, 2.5);
    expect(vm.state.analysis.overlaps.length).toBeGreaterThan(0);

    vm.undo();
    expect(vm.state.document.elements).toHaveLength(originalCount + 1);
    expect(vm.state.analysis.overlaps.length).toBe(overlapsBeforeMove);
    expect(vm.state.canRedo).toBe(true);

    vm.undo();
    expect(vm.state.document.elements).toHaveLength(originalCount + 1);
    expect(vm.state.selectedElement?.rotation).toBe(0);

    vm.undo();
    expect(vm.state.document.elements).toHaveLength(originalCount);
    expect(vm.state.selectedId).toBe('entry-1');

    vm.redo();
    expect(vm.state.document.elements).toHaveLength(originalCount + 1);
    expect(vm.state.selectedId).toBeTruthy();  });

  it('coalesces one continuous drag into a single history entry', () => {
    const vm = new ExpoSketchViewModel(fakeRepository(), fakeSessionRepository().sessions);
    vm.beginInteraction('移动元素');
    vm.moveElement('stage-1', 11, 2);
    vm.moveElement('stage-1', 12, 3);
    vm.moveElement('stage-1', 12.5, 3.2);
    expect(vm.state.history.entries).toHaveLength(1);
    vm.endInteraction();
    expect(vm.state.history.entries).toHaveLength(2);
    expect(vm.state.history.entries[1].label).toBe('移动元素');
    expect(vm.state.document.elements.find((element) => element.id === 'stage-1')?.x).toBe(12.5);
  });

  it('does not record a drag that never changed the document', () => {
    const vm = new ExpoSketchViewModel(fakeRepository(), fakeSessionRepository().sessions);
    const stage = vm.state.document.elements.find((element) => element.id === 'stage-1')!;
    vm.beginInteraction('移动元素');
    vm.moveElement('stage-1', stage.x, stage.y);
    vm.endInteraction();
    expect(vm.state.history.entries).toHaveLength(1);
  });

  it('jumps to any step and brings back elements, selection and inspection results', async () => {
    const vm = new ExpoSketchViewModel(fakeRepository(), fakeSessionRepository().sessions);
    await vm.initialize();
    vm.addElement('booth');
    const addedId = vm.state.selectedId!;
    vm.moveElement(addedId, 4.5, 2.5);
    expect(vm.state.analysis.overlaps.length).toBeGreaterThan(0);
    vm.removeSelected();
    expect(vm.state.document.elements.some((element) => element.id === addedId)).toBe(false);

    vm.jumpTo(0);
    expect(vm.state.document.elements.some((element) => element.id === addedId)).toBe(false);
    expect(vm.state.analysis.overlaps.length).toBe(0);
    expect(vm.state.notice.message).toContain('载入布局');

    vm.jumpTo(2);
    expect(vm.state.document.elements.some((element) => element.id === addedId)).toBe(true);
    expect(vm.state.selectedId).toBe(addedId);
    expect(vm.state.analysis.overlaps.length).toBeGreaterThan(0);
  });

  it('treats restoring the example layout as a reversible edit', () => {
    const vm = new ExpoSketchViewModel(fakeRepository(), fakeSessionRepository().sessions);
    vm.addElement('stage');
    const before = vm.state.document.elements.length;
    vm.resetExample();
    expect(vm.state.document.elements.length).not.toBe(before);
    vm.undo();
    expect(vm.state.document.elements).toHaveLength(before);
  });

  it('keeps history intact and shows an error notice when autosave fails', async () => {
    const { sessions } = fakeSessionRepository(true);
    const vm = new ExpoSketchViewModel(fakeRepository(), sessions);
    await vm.initialize();
    vm.addElement('stage');
    await waitForSave();
    expect(vm.state.history.entries).toHaveLength(2);
    expect(vm.state.notice.tone).toBe('error');
    expect(vm.state.document.elements.length).toBeGreaterThan(createStarterDocument().elements.length);
  });

  it('persists the full session so a restart restores both the document and the history pointer', async () => {
    const bag = fakeSessionRepository();
    const first = new ExpoSketchViewModel(fakeRepository(), bag.sessions);
    await first.initialize();
    first.addElement('booth');
    first.addElement('stage');
    first.undo();
    await waitForSave();
    const stored = bag.saved();
    expect(stored?.version).toBe(2);
    expect(stored?.history.currentIndex).toBe(1);

    const restarted = new ExpoSketchViewModel(fakeRepository(), bag.sessions);
    await restarted.initialize();
    expect(restarted.state.history.entries).toHaveLength(3);
    expect(restarted.state.history.currentIndex).toBe(1);
    expect(restarted.state.canRedo).toBe(true);
    expect(restarted.state.document.elements.some((element) => element.kind === 'booth')).toBe(true);
  });
});

describe('session sanitization', () => {
  it('drops snapshots whose selection points at a missing element', () => {
    const document = createStarterDocument();
    const broken = {
      version: 2,
      history: {
        entries: [
          { id: 'a', label: '初始布局', at: 1, snapshot: { document, selectedId: document.elements[0].id } },
          { id: 'b', label: '坏步骤', at: 2, snapshot: { document, selectedId: 'ghost-id' } },
        ],
        currentIndex: 1,
      },
    };
    expect(sanitizeSession(broken)?.history.entries.map((entry) => entry.id)).toEqual(['a']);
    expect(sanitizeSession(broken)?.history.currentIndex).toBe(0);
  });

  it('rejects completely damaged session payloads', () => {
    expect(sanitizeSession(null)).toBeNull();
    expect(sanitizeSession({ version: 1 })).toBeNull();
    expect(sanitizeSession({ version: 2, history: { entries: [], currentIndex: 0 } })).toBeNull();
  });
});
