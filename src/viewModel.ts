import { createElement, createStarterDocument, analyzeLayout, findElement, getBoundingBox, normalizeRotation } from './domain';
import { MERGE_WINDOW_MS, capHistoryStack, createInitialHistory, sanitizeEntrySelection } from './history';
import type { LayoutRepository } from './repository';
import type { Analysis, ElementKind, HistoryStack, LayoutDocument, LayoutMode, Notice, RenderElement, ViewPhase } from './types';

export interface ExpoSketchState {
  phase: ViewPhase;
  document: LayoutDocument;
  renderElements: RenderElement[];
  selectedId: string | null;
  selectedElement: RenderElement | null;
  mode: LayoutMode;
  analysis: Analysis;
  notice: Notice;
  lastSavedAt: number | null;
  history: HistoryStack;
}

const toRenderElements = (document: LayoutDocument): RenderElement[] => document.elements.map((element) => {
  const box = getBoundingBox(element);
  return { ...element, displayWidth: box.width, displayHeight: box.height, occupiedArea: Number((box.width * box.height).toFixed(1)) };
});

const starter = createStarterDocument();
const starterRenderElements = toRenderElements(starter);

type Listener = () => void;

export class ExpoSketchViewModel {
  private listeners = new Set<Listener>();
  private entrySeq = 0;
  private lastMergeKey: string | null = null;
  private lastMergeAt = 0;
  private transformGesture = false;
  private persistInFlight: Promise<void> | null = null;
  private persistRequested = false;
  private stateValue: ExpoSketchState = {
    phase: 'loading',
    document: starter,
    renderElements: starterRenderElements,
    selectedId: 'stage-1',
    selectedElement: starterRenderElements.find((element) => element.id === 'stage-1') ?? null,
    mode: 'edit',
    analysis: analyzeLayout(createStarterDocument()),
    notice: { tone: 'info', message: '正在恢复最近布局…' },
    lastSavedAt: null,
    history: createInitialHistory(starter, 'stage-1'),
  };

  constructor(private readonly repository: LayoutRepository) {}

  get state() { return this.stateValue; }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async initialize() {
    try {
      const persisted = await this.repository.load();
      const history = persisted.history && persisted.history.entries.length > 0
        ? capHistoryStack(persisted.history)
        : createInitialHistory(persisted.document, persisted.document.elements[0]?.id ?? null);
      const current = history.entries[history.index];
      const document = current.document;
      const selectedId = sanitizeEntrySelection(current) ?? document.elements[0]?.id ?? null;
      this.commit({
        document,
        history,
        selectedId,
        phase: 'ready',
        notice: { tone: 'success', message: persisted.history ? '布局与操作历史已恢复，可继续编辑' : '布局已就绪，可开始编辑' },
      });
    } catch {
      this.commit({
        phase: 'error',
        history: createInitialHistory(this.stateValue.document, this.stateValue.selectedId),
        notice: { tone: 'error', message: '布局读取失败，已载入安全示例' },
      });
    }
  }

  selectElement(id: string) {
    this.lastMergeKey = null;
    this.commit({ selectedId: id });
  }

  setMode(mode: LayoutMode) {
    this.lastMergeKey = null;
    this.commit({ mode, notice: { tone: 'info', message: mode === 'inspect' ? '检查模式已开启：拖动元素查看即时提示' : mode === 'path' ? '路径模式已开启：入口到重点区域的访问路线已生成' : '编辑模式已开启' } });
  }

  beginTransform() { this.transformGesture = true; }

  endTransform() {
    this.transformGesture = false;
    this.lastMergeKey = null;
  }

  undo() {
    const { index, entries } = this.stateValue.history;
    if (index <= 0) return;
    this.applyHistoryIndex(index - 1, `已撤销「${entries[index].label}」`);
  }

  redo() {
    const { index, entries } = this.stateValue.history;
    if (index >= entries.length - 1) return;
    this.applyHistoryIndex(index + 1, `已重做「${entries[index + 1].label}」`);
  }

  jumpToHistory(index: number) {
    const entry = this.stateValue.history.entries[index];
    if (!entry) return;
    this.applyHistoryIndex(index, `已跳转到「${entry.label}」`);
  }

  addElement(kind: ElementKind) {
    const element = createElement(kind, this.stateValue.document.elements.length, this.stateValue.document.field);
    const document = { ...this.stateValue.document, elements: [...this.stateValue.document.elements, element] };
    this.commitAndPersist({ document, selectedId: element.id, notice: { tone: 'success', message: `${element.name} 已加入场地` } }, `添加 ${element.name}`);
  }

  removeSelected() {
    if (!this.stateValue.selectedId) return;
    const removed = findElement(this.stateValue.document, this.stateValue.selectedId);
    const elements = this.stateValue.document.elements.filter((element) => element.id !== this.stateValue.selectedId);
    this.commitAndPersist({ document: { ...this.stateValue.document, elements }, selectedId: elements[0]?.id ?? null, notice: { tone: 'info', message: `${removed?.name ?? '元素'} 已移除` } }, `移除 ${removed?.name ?? '元素'}`);
  }

  moveElement(id: string, x: number, y: number) {
    const target = findElement(this.stateValue.document, id);
    if (!target) return;
    const nextX = Number(x.toFixed(1));
    const nextY = Number(y.toFixed(1));
    if (target.x === nextX && target.y === nextY) return;
    const elements = this.stateValue.document.elements.map((element) => element.id === id ? { ...element, x: nextX, y: nextY } : element);
    this.commitAndPersist({ document: { ...this.stateValue.document, elements } }, `移动 ${target.name}`, `move:${id}`);
  }

  resizeSelected(width: number, height: number) {
    const id = this.stateValue.selectedId;
    if (!id || width <= 0 || height <= 0) return;
    const target = findElement(this.stateValue.document, id);
    if (!target) return;
    const nextWidth = Number(width.toFixed(1));
    const nextHeight = Number(height.toFixed(1));
    if (target.width === nextWidth && target.height === nextHeight) return;
    const elements = this.stateValue.document.elements.map((element) => element.id === id ? { ...element, width: nextWidth, height: nextHeight } : element);
    this.commitAndPersist({ document: { ...this.stateValue.document, elements } }, `调整 ${target.name} 尺寸`, `resize:${id}`);
  }

  rotateSelected() {
    const id = this.stateValue.selectedId;
    if (!id) return;
    const target = findElement(this.stateValue.document, id);
    if (!target) return;
    const elements = this.stateValue.document.elements.map((element) => element.id === id ? { ...element, rotation: normalizeRotation(element.rotation + 90) } : element);
    this.commitAndPersist({ document: { ...this.stateValue.document, elements }, notice: { tone: 'info', message: '方向已旋转 90°' } }, `旋转 ${target.name}`);
  }

  renameSelected(name: string) {
    const id = this.stateValue.selectedId;
    if (!id || !name.trim()) return;
    const target = findElement(this.stateValue.document, id);
    if (!target || target.name === name.trim()) return;
    const elements = this.stateValue.document.elements.map((element) => element.id === id ? { ...element, name: name.trim() } : element);
    this.commitAndPersist({ document: { ...this.stateValue.document, elements } }, `重命名为「${name.trim()}」`, `rename:${id}`);
  }

  resizeField(width: number, height: number) {
    if (width < 12 || height < 10) return;
    const nextWidth = Number(width.toFixed(1));
    const nextHeight = Number(height.toFixed(1));
    const field = this.stateValue.document.field;
    if (field.width === nextWidth && field.height === nextHeight) return;
    this.commitAndPersist({ document: { ...this.stateValue.document, field: { width: nextWidth, height: nextHeight } }, notice: { tone: 'success', message: '场地尺寸已更新' } }, `场地调整为 ${nextWidth} × ${nextHeight} m`, 'field-size');
  }

  renameProject(title: string) {
    if (!title.trim() || title.trim() === this.stateValue.document.title) return;
    this.commitAndPersist({ document: { ...this.stateValue.document, title: title.trim() } }, `重命名项目为「${title.trim()}」`, 'project-title');
  }

  resetExample() {
    const document = createStarterDocument();
    this.commitAndPersist({ document, selectedId: 'stage-1', mode: 'edit', notice: { tone: 'success', message: '已恢复示例布局' } }, '恢复示例布局');
  }

  private applyHistoryIndex(index: number, message: string) {
    const stack = this.stateValue.history;
    if (index < 0 || index >= stack.entries.length || index === stack.index) return;
    const entry = stack.entries[index];
    this.lastMergeKey = null;
    this.commit({
      document: entry.document,
      selectedId: sanitizeEntrySelection(entry),
      history: { entries: stack.entries, index },
      notice: { tone: 'info', message },
    });
    this.requestPersist();
  }

  private commitAndPersist(patch: Partial<ExpoSketchState>, historyLabel?: string, mergeKey?: string) {
    this.commit(historyLabel ? { ...patch, history: this.buildNextHistory(patch, historyLabel, mergeKey) } : patch);
    this.requestPersist();
  }

  private buildNextHistory(patch: Partial<ExpoSketchState>, label: string, mergeKey?: string): HistoryStack {
    const document = patch.document ?? this.stateValue.document;
    const selectedId = patch.selectedId !== undefined ? patch.selectedId : this.stateValue.selectedId;
    const now = Date.now();
    const stack = this.stateValue.history;
    const canMerge = !!mergeKey && mergeKey === this.lastMergeKey && stack.index === stack.entries.length - 1
      && stack.entries.length > 0 && (this.transformGesture || now - this.lastMergeAt <= MERGE_WINDOW_MS);
    this.lastMergeKey = mergeKey ?? null;
    this.lastMergeAt = now;
    if (canMerge) {
      const entries = stack.entries.slice();
      entries[stack.index] = { ...entries[stack.index], label, at: now, document, selectedId };
      return { entries, index: stack.index };
    }
    const kept = stack.entries.slice(0, stack.index + 1);
    this.entrySeq += 1;
    kept.push({ id: `entry-${now}-${this.entrySeq}`, label, at: now, document, selectedId });
    return capHistoryStack({ entries: kept, index: kept.length - 1 });
  }

  private requestPersist() {
    this.persistRequested = true;
    if (!this.persistInFlight) this.persistInFlight = this.flushPersists();
  }

  private async flushPersists() {
    while (this.persistRequested) {
      this.persistRequested = false;
      try {
        await this.repository.save(this.stateValue.document, this.stateValue.history);
        this.commit({ lastSavedAt: Date.now() });
      } catch {
        this.commit({ notice: { tone: 'error', message: '本地保存失败，当前编辑仍保留在页面中' } });
      }
    }
    this.persistInFlight = null;
  }

  private commit(patch: Partial<ExpoSketchState>) {
    const next = { ...this.stateValue, ...patch };
    const renderElements = toRenderElements(next.document);
    this.stateValue = { ...next, renderElements, selectedElement: renderElements.find((element) => element.id === next.selectedId) ?? null, analysis: analyzeLayout(next.document) };
    this.listeners.forEach((listener) => listener());
  }
}
