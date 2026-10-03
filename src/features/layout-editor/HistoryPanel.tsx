import { useEffect, useRef } from 'react';
import type { HistoryView } from '../../types';

interface HistoryPanelProps {
  history: HistoryView;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onJump: (index: number) => void;
}

const formatStepTime = (at: number) => new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function HistoryPanel({ history, canUndo, canRedo, onUndo, onRedo, onJump }: HistoryPanelProps) {
  const currentRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest' });
  }, [history.currentIndex]);

  return <section className="panel history-panel">
    <div className="panel-heading"><div><span className="section-kicker">HISTORY</span><h2>编辑历史</h2></div></div>
    <div className="history-controls">
      <button type="button" className="secondary-button" disabled={!canUndo} onClick={onUndo} title="撤销 (Ctrl+Z)">↶ 撤销</button>
      <button type="button" className="secondary-button" disabled={!canRedo} onClick={onRedo} title="重做 (Ctrl+Shift+Z)">↷ 重做</button>
    </div>
    <ol className="history-list">
      {history.entries.map((entry, index) => {
        const isCurrent = index === history.currentIndex;
        const isPast = index < history.currentIndex;
        return <li
          key={entry.id}
          ref={isCurrent ? currentRef : null}
          className={['history-step', isCurrent ? 'is-current' : '', isPast ? 'is-past' : ''].filter(Boolean).join(' ')}
        >
          <button type="button" onClick={() => onJump(index)} title={isCurrent ? '当前步骤' : '跳到此步骤'}>
            <span className="history-marker" aria-hidden>{isCurrent ? '●' : isPast ? '↶' : '○'}</span>
            <span className="history-copy"><strong>{entry.label}</strong><small>{formatStepTime(entry.at)}</small></span>
          </button>
        </li>;
      })}
    </ol>
    <p className="history-hint">点击任意步骤直接跳转；新的编辑会清除该步之后的重做记录。</p>
  </section>;
}
