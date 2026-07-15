import { useEffect, useMemo, useRef } from 'react';
import { drawWaveform, formatTime } from '../audio/audioAnalysis.js';

const MIN_DURATION = 1; // トリムしても最低1秒は残す

/**
 * 1曲分の波形をズーム表示し、開始/終了のハンドルをドラッグしてトリムできる。
 * 表示範囲(view)は前後に少し余白を持たせて、元の自動分割の境界も見えるようにしてある。
 */
export default function TrackTrimEditor({
  audioBuffer,
  original,
  value,
  lowerBound,
  upperBound,
  onChange,
  onPreview,
  onSeek,
  currentPlayhead,
}) {
  const canvasRef = useRef(null);
  const dragRef = useRef(null);

  const view = useMemo(() => {
    const span = original.end - original.start;
    const pad = Math.min(6, Math.max(1.5, span * 0.15));
    return {
      start: Math.max(lowerBound, original.start - pad),
      end: Math.min(upperBound, original.end + pad),
    };
  }, [original.start, original.end, lowerBound, upperBound]);

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      if (canvasRef.current) drawWaveform(canvasRef.current, audioBuffer, [], view);
    });
    return () => cancelAnimationFrame(raf);
  }, [audioBuffer, view]);

  const viewDur = Math.max(0.001, view.end - view.start);
  const pct = (t) => ((Math.min(view.end, Math.max(view.start, t)) - view.start) / viewDur) * 100;

  function timeFromClientX(clientX) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return view.start + ratio * viewDur;
  }

  function handlePointerDown(handle) {
    return (e) => {
      e.preventDefault();
      dragRef.current = handle;
      const move = (ev) => {
        const t = timeFromClientX(ev.clientX);
        if (dragRef.current === 'start') {
          const newStart = Math.max(lowerBound, Math.min(t, value.end - MIN_DURATION));
          onChange({ start: newStart, end: value.end });
        } else if (dragRef.current === 'end') {
          const newEnd = Math.min(upperBound, Math.max(t, value.start + MIN_DURATION));
          onChange({ start: value.start, end: newEnd });
        }
      };
      const up = () => {
        dragRef.current = null;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    };
  }

  const startPct = pct(value.start);
  const endPct = pct(value.end);
  const isTrimmed = Math.abs(value.start - original.start) > 0.01 || Math.abs(value.end - original.end) > 0.01;
  const playheadPct =
    currentPlayhead != null && currentPlayhead >= view.start && currentPlayhead <= view.end ? pct(currentPlayhead) : null;

  function handleCanvasClick(e) {
    if (dragRef.current) return; // ドラッグ直後のクリックは無視
    const t = timeFromClientX(e.clientX);
    if (onSeek) onSeek(t);
  }

  return (
    <div className="trim-editor">
      <div className="trim-canvas-wrap">
        <canvas ref={canvasRef} className="waveform trim-waveform" onClick={handleCanvasClick} />
        {playheadPct !== null && <div className="playhead-line" style={{ left: `${playheadPct}%` }} />}
        <div className="trim-dim" style={{ left: 0, width: `${startPct}%` }} />
        <div className="trim-dim" style={{ right: 0, width: `${100 - endPct}%` }} />
        <div className="trim-kept" style={{ left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%` }} />
        <div
          className="trim-handle trim-handle-start"
          style={{ left: `${startPct}%` }}
          onPointerDown={handlePointerDown('start')}
        />
        <div
          className="trim-handle trim-handle-end"
          style={{ left: `${endPct}%` }}
          onPointerDown={handlePointerDown('end')}
        />
      </div>
      <div className="trim-controls">
        <button
          type="button"
          className="btn btn-secondary"
          style={{ padding: '4px 10px', fontSize: 12 }}
          onClick={() => onPreview(value.start, value.end)}
        >
          ▶ この範囲を再生
        </button>
        <span className="trim-range-label">
          {formatTime(value.start)} - {formatTime(value.end)}
        </span>
        {isTrimmed && (
          <button
            type="button"
            className="trim-reset"
            onClick={() => onChange({ start: original.start, end: original.end })}
          >
            リセット
          </button>
        )}
      </div>
    </div>
  );
}
