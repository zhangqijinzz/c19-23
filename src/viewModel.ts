import { createElement, createStarterDocument, analyzeLayout, findElement, getBoundingBox, normalizeRotation } from './domain';
import { appendHistory, createHistory, currentSnapshot, jumpHistory } from './history';
import type { LayoutRepository, SessionRepository } from './repository';
import type { Analysis, ElementKind, HistorySnapshot, HistoryView, LayoutDocument, LayoutMode, Notice, RenderElement, ViewPhase } from './types';

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
  history: HistoryView;
  canUndo: boolean;
  canRedo: boolean;
}

const toRenderElements = (document: LayoutDocument): RenderElement[] => document.elements.map((element) => {
  const box = getBoundingBox(element);
  return { ...element, displayWidth: box.width, displayHeight: box.height, occupiedArea: Number((box.width * box.height).toFixed(1)) };
});

const cloneSnapshot = (snapshot: HistorySnapshot): HistorySnapshot => ({
  document: JSON.parse(JSON.stringify(snapshot.document)) as LayoutDocument,
  selectedId: snapshot.selectedId,
});

const sameDocument = (a: LayoutDocument, b: LayoutDocument) => JSON.stringify(a) === JSON.stringify(b);

const validSelection = (document: LayoutDocument, selectedId: string | null) =>
  selectedId && document.elements.some((element) => element.id === selectedId) ? selectedId : null;

const starter = createStarterDocument();

type Listener = () => void;

interface InteractionFrame {
  label: string;
  document: LayoutDocument;
}

export class ExpoSketchViewModel {
  private listeners = new Set<Listener>();
  private history: HistoryView = createHistory({ document: starter, selectedId: 'stage-1' }, '初始布局');
  private working: HistorySnapshot = cloneSnapshot(currentSnapshot(this.history));
  private phase: ViewPhase = 'loading';
  private mode: LayoutMode = 'edit';
  private notice: Notice = { tone: 'info', message: '正在恢复最近布局…' };
  private lastSavedAt: number | null = null;
  private interactionStack: InteractionFrame[] = [];
  private initialized = false;
  private flushToken = 0;
  private saveSeq = 0;
  private stateValue: ExpoSketchState = this.buildState();

  constructor(
    private readonly repository: LayoutRepository,
    private readonly sessions: SessionRepository | null = null,
  ) {}

  get state() { return this.stateValue; }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async initialize() {
    if (this.initialized) return;
    this.initialized = true;
    try {
      let history: HistoryView | null = null;
      if (this.sessions) history = (await this.sessions.loadSession())?.history ?? null;
      if (!history) {
        const document = await this.repository.load();
        history = createHistory({ document, selectedId: document.elements[0]?.id ?? null }, '载入布局');
      }
      this.history = history;
      this.working = cloneSnapshot(currentSnapshot(history));
      this.phase = 'ready';
      this.notice = { tone: 'success', message: '布局与编辑历史已就绪' };
      this.emit();
    } catch {
      const document = createStarterDocument();
      this.history = createHistory({ document, selectedId: document.elements[0]?.id ?? null }, '安全示例');
      this.working = cloneSnapshot(currentSnapshot(this.history));
      this.phase = 'error';
      this.notice = { tone: 'error', message: '布局读取失败，已载入安全示例' };
      this.emit();
    }
  }

  selectElement(id: string) { this.applyPatch({ selectedId: id }); }

  setMode(mode: LayoutMode) {
    this.mode = mode;
    this.notice = { tone: 'info', message: mode === 'inspect' ? '检查模式已开启：拖动元素查看即时提示' : mode === 'path' ? '路径模式已开启：入口到重点区域的访问路线已生成' : '编辑模式已开启' };
    this.emit();
  }

  addElement(kind: ElementKind) {
    const element = createElement(kind, this.working.document.elements.length, this.working.document.field);
    const document = { ...this.working.document, elements: [...this.working.document.elements, element] };
    this.mutate(document, `添加「${element.name}」`, { selectedId: element.id, notice: { tone: 'success', message: `${element.name} 已加入场地` } });
  }

  removeSelected() {
    if (!this.working.selectedId) return;
    const removed = findElement(this.working.document, this.working.selectedId);
    const elements = this.working.document.elements.filter((element) => element.id !== this.working.selectedId);
    const nextId = elements[0]?.id ?? null;
    this.mutate({ ...this.working.document, elements }, `删除「${removed?.name ?? '元素'}」`, { selectedId: nextId, notice: { tone: 'info', message: `${removed?.name ?? '元素'} 已移除` } });
  }

  moveElement(id: string, x: number, y: number) {
    if (!this.working.document.elements.some((element) => element.id === id)) return;
    const elements = this.working.document.elements.map((element) => element.id === id ? { ...element, x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) } : element);
    this.mutate({ ...this.working.document, elements }, '移动元素');
  }

  resizeSelected(width: number, height: number) {
    const id = this.working.selectedId;
    if (!id || width <= 0 || height <= 0) return;
    const target = findElement(this.working.document, id);
    const elements = this.working.document.elements.map((element) => element.id === id ? { ...element, width: Number(width.toFixed(1)), height: Number(height.toFixed(1)) } : element);
    this.mutate({ ...this.working.document, elements }, '调整尺寸', { notice: { tone: 'info', message: `${target?.name ?? '元素'} 尺寸已更新` } });
  }

  rotateSelected() {
    const id = this.working.selectedId;
    if (!id) return;
    const target = findElement(this.working.document, id);
    const elements = this.working.document.elements.map((element) => element.id === id ? { ...element, rotation: normalizeRotation(element.rotation + 90) } : element);
    this.mutate({ ...this.working.document, elements }, `旋转「${target?.name ?? '元素'}」`, { notice: { tone: 'info', message: '方向已旋转 90°' } });
  }

  renameSelected(name: string) {
    const id = this.working.selectedId;
    if (!id || !name.trim()) return;
    const elements = this.working.document.elements.map((element) => element.id === id ? { ...element, name: name.trim() } : element);
    this.mutate({ ...this.working.document, elements }, '重命名元素');
  }

  resizeField(width: number, height: number) {
    if (width < 12 || height < 10) return;
    this.mutate({ ...this.working.document, field: { width: Number(width.toFixed(1)), height: Number(height.toFixed(1)) } }, '调整场地', { notice: { tone: 'success', message: '场地尺寸已更新' } });
  }

  renameProject(title: string) {
    if (!title.trim()) return;
    this.mutate({ ...this.working.document, title: title.trim() }, '重命名项目');
  }

  resetExample() {
    const document = createStarterDocument();
    this.interactionStack = [];
    this.mode = 'edit';
    this.mutate(document, '恢复示例布局', { selectedId: 'stage-1', notice: { tone: 'success', message: '已恢复示例布局，可用撤销回到之前的布局' } });
  }

  /** 开启一次连续交互（按下/聚焦），整段交互结束时只合并为一条历史 */
  beginInteraction(label: string) {
    this.interactionStack.push({ label, document: this.working.document });
  }

  /** 结束连续交互（抬起/失焦）：文档没有实质变化则不产生历史 */
  endInteraction() {
    const frame = this.interactionStack.pop();
    if (!frame || sameDocument(frame.document, this.working.document)) return;
    this.recordEntry(frame.label);
    this.schedulePersist();
  }

  undo() {
    if (!this.stateValue.canUndo || this.interactionStack.length > 0) return;
    const entry = this.history.entries[this.history.currentIndex];
    this.restore(jumpHistory(this.history, this.history.currentIndex - 1), { tone: 'info', message: `已撤销「${entry.label}」` });
  }

  redo() {
    if (!this.stateValue.canRedo || this.interactionStack.length > 0) return;
    this.restore(jumpHistory(this.history, this.history.currentIndex + 1), { tone: 'info', message: `已重做「${this.history.entries[this.history.currentIndex + 1].label}」` });
  }

  jumpTo(index: number) {
    if (this.interactionStack.length > 0 || index === this.history.currentIndex) return;
    const target = this.history.entries[index];
    if (!target) return;
    this.restore(jumpHistory(this.history, index), { tone: 'info', message: `已回到「${target.label}」` });
  }

  private mutate(document: LayoutDocument, label: string, extras: Partial<Pick<ExpoSketchState, 'selectedId' | 'notice'>> = {}) {
    if (extras.notice) this.notice = extras.notice;
    this.applyPatch({ document, ...(extras.selectedId !== undefined ? { selectedId: extras.selectedId } : {}) });
    if (this.interactionStack.length === 0) {
      this.recordEntry(label);
      this.schedulePersist();
    }
  }

  private recordEntry(label: string) {
    const snapshot: HistorySnapshot = {
      document: this.working.document,
      selectedId: validSelection(this.working.document, this.working.selectedId),
    };
    this.history = appendHistory(this.history, snapshot, label);
    this.working = { document: this.history.entries[this.history.currentIndex].snapshot.document, selectedId: snapshot.selectedId };
    this.emit();
  }

  private restore(history: HistoryView, notice: Notice) {
    this.history = history;
    this.working = cloneSnapshot(currentSnapshot(history));
    this.notice = notice;
    this.emit();
    this.schedulePersist();
  }

  private applyPatch(patch: Partial<Pick<ExpoSketchState, 'document' | 'selectedId'>>) {
    if (patch.document) this.working = { ...this.working, document: patch.document };
    if (patch.selectedId !== undefined) this.working = { ...this.working, selectedId: validSelection(this.working.document, patch.selectedId) };
    this.emit();
  }

  private schedulePersist() {
    const token = ++this.flushToken;
    void Promise.resolve().then(() => {
      if (token === this.flushToken) void this.flushPersist();
    });
  }

  private async flushPersist() {
    const seq = ++this.saveSeq;
    try {
      if (this.sessions) {
        await this.sessions.saveSession({ version: 2, history: this.history });
      } else {
        await this.repository.save(this.working.document);
      }
      if (seq !== this.saveSeq) return;
      this.lastSavedAt = Date.now();
      this.emit();
    } catch {
      // 保存失败只提示，不改动历史与工作区——下一次编辑会自动重试
      if (seq !== this.saveSeq) return;
      this.notice = { tone: 'error', message: '自动保存失败：编辑与历史仍保留在本页，可继续操作' };
      this.emit();
    }
  }

  private buildState(): ExpoSketchState {
    const selectedId = validSelection(this.working.document, this.working.selectedId);
    const renderElements = toRenderElements(this.working.document);
    return {
      phase: this.phase,
      document: this.working.document,
      renderElements,
      selectedId,
      selectedElement: renderElements.find((element) => element.id === selectedId) ?? null,
      mode: this.mode,
      analysis: analyzeLayout(this.working.document),
      notice: this.notice,
      lastSavedAt: this.lastSavedAt,
      history: this.history,
      canUndo: this.history.currentIndex > 0,
      canRedo: this.history.currentIndex < this.history.entries.length - 1,
    };
  }

  private emit() {
    this.stateValue = this.buildState();
    this.listeners.forEach((listener) => listener());
  }
}
