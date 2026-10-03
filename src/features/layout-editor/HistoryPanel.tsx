import type { HistoryStack } from '../../types';

interface HistoryPanelProps {
  history: HistoryStack;
  onJump: (index: number) => void;
  onUndo: () => void;
  onRedo: () => void;
}

const formatTime = (at: number) => new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function HistoryPanel({ history, onJump, onUndo, onRedo }: HistoryPanelProps) {
  const canUndo = history.index > 0;
  const canRedo = history.index < history.entries.length - 1;
  const ordered = history.entries.map((entry, index) => ({ entry, index })).reverse();
  return <section className="panel history-panel">
    <div className="panel-heading"><div><span className="section-kicker">HISTORY</span><h2>操作历史</h2></div><span className="count-badge">{history.index + 1}/{history.entries.length}</span></div>
    <div className="history-actions">
      <button type="button" className="secondary-button" disabled={!canUndo} onClick={onUndo} title="撤销 (⌘Z)">↩ 撤销</button>
      <button type="button" className="secondary-button" disabled={!canRedo} onClick={onRedo} title="重做 (⌘⇧Z)">↪ 重做</button>
    </div>
    <ol className="history-list">
      {ordered.map(({ entry, index }) => {
        const isCurrent = index === history.index;
        const classes = ['history-item', isCurrent ? 'is-current' : '', index > history.index ? 'is-future' : ''].filter(Boolean).join(' ');
        return <li key={entry.id}>
          <button type="button" className={classes} disabled={isCurrent} onClick={() => onJump(index)} title={isCurrent ? '当前状态' : `回到「${entry.label}」`}>
            <span className="history-step">{index + 1}</span>
            <span className="history-label">{entry.label}</span>
            <time>{formatTime(entry.at)}</time>
            {isCurrent ? <span className="history-current-mark">当前</span> : null}
          </button>
        </li>;
      })}
    </ol>
  </section>;
}
