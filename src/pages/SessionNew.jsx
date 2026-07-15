import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  decodeAudioFile,
  computeRMS,
  detectSegments,
  playSegmentsOnly,
  splitPlaySegments,
  sliceAudioBufferToWavBlob,
  drawWaveform,
  formatTime,
  ANALYSIS_INTERVAL_SEC,
  DEFAULT_ANALYSIS_OPTIONS,
} from '../audio/audioAnalysis.js';
import { getOrCreateDefaultBand, createSession, createTrack, saveTrackAudio } from '../repository/localRepository.js';
import TrackTrimEditor from '../components/TrackTrimEditor.jsx';

const SPEEDS = [1, 1.25, 1.5, 2];
const ZOOM_LEVELS = [
  { label: '全体', sec: 0 },
  { label: '10分', sec: 600 },
  { label: '5分', sec: 300 },
  { label: '2分', sec: 120 },
  { label: '1分', sec: 60 },
];

function todayStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fmtSliderSec(sec) {
  return sec >= 60 ? `${(sec / 60).toFixed(sec % 60 === 0 ? 0 : 1)}分` : `${sec}秒`;
}

export default function SessionNew() {
  const navigate = useNavigate();
  const canvasRef = useRef(null);
  const previewAudioRef = useRef(null);
  const boundedEndRef = useRef(null); // 曲単位プレビュー時の終了位置(そこで自動停止)

  const [stage, setStage] = useState('idle'); // idle | analyzing | review | saving
  const [isDragActive, setIsDragActive] = useState(false);
  const [progress, setProgress] = useState(0);
  const [audioBuffer, setAudioBuffer] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [rms, setRms] = useState(null);
  const [allSegments, setAllSegments] = useState([]); // play + silence(自動判定のまま)
  const [manualSplits, setManualSplits] = useState([]); // ユーザーが追加した分割点(秒)
  const [trimOverrides, setTrimOverrides] = useState({}); // index -> {start,end} (曲単位の前後トリム)
  const [editMode, setEditMode] = useState('preview'); // 'preview' | 'split'
  const [titles, setTitles] = useState({});
  const [settings, setSettings] = useState(DEFAULT_ANALYSIS_OPTIONS);
  const [dirty, setDirty] = useState(false);
  const [date, setDate] = useState(todayStr());
  const [memo, setMemo] = useState('');
  const [error, setError] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [playhead, setPlayhead] = useState(0);

  // ---- ズーム表示(プレビューモード専用。元ツールのズーム切替を踏襲) ----
  const [zoomWindowSec, setZoomWindowSec] = useState(300);
  const [zoomActive, setZoomActive] = useState(false);
  const [viewStart, setViewStart] = useState(0);
  const [viewEnd, setViewEnd] = useState(0);

  const playSegs = playSegmentsOnly(allSegments);
  const finalSegs = splitPlaySegments(playSegs, manualSplits);
  const effectiveSegs = finalSegs.map((seg, i) =>
    trimOverrides[i] ? { ...seg, start: trimOverrides[i].start, end: trimOverrides[i].end } : seg
  );
  const duration = audioBuffer ? audioBuffer.duration : 0;
  const view = zoomActive ? { start: viewStart, end: viewEnd } : { start: 0, end: duration };
  const viewDur = Math.max(0.001, view.end - view.start);

  // 波形の再描画(ズーム範囲・区間が変わるたびに反映)
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      if (!audioBuffer || !canvasRef.current) return;
      drawWaveform(canvasRef.current, audioBuffer, allSegments, zoomActive ? { start: viewStart, end: viewEnd } : null);
    });
    return () => cancelAnimationFrame(raf);
  }, [audioBuffer, allSegments, zoomActive, viewStart, viewEnd]);

  function recompute(nextSettings, buffer, rmsData) {
    const detected = detectSegments(rmsData, ANALYSIS_INTERVAL_SEC, buffer.duration, nextSettings);
    setAllSegments(detected);
  }

  async function handleFile(file) {
    if (!file) return;
    setError('');
    setStage('analyzing');
    setProgress(0);
    try {
      const buffer = await decodeAudioFile(file);
      await new Promise((r) => setTimeout(r, 30)); // UIを更新してから重い解析へ
      const rmsData = computeRMS(buffer, ANALYSIS_INTERVAL_SEC, (p) => setProgress(Math.round(p * 100)));
      setAudioBuffer(buffer);
      setRms(rmsData);
      setTitles({});
      setManualSplits([]);
      setTrimOverrides({});
      setDirty(false);
      setZoomActive(false);
      setPreviewUrl(URL.createObjectURL(file));
      recompute(settings, buffer, rmsData);
      setStage('review');
    } catch (err) {
      console.error(err);
      setError('音声ファイルを読み込めませんでした。対応形式(wav / mp3 / m4a など)かご確認ください。');
      setStage('idle');
    }
  }

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function handleDrop(e) {
    e.preventDefault();
    setIsDragActive(false);
    const file = e.dataTransfer.files?.[0];
    handleFile(file);
  }

  function handleSliderChange(key, value) {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  function handleReanalyze() {
    if (!rms || !audioBuffer) return;
    recompute(settings, audioBuffer, rms);
    setManualSplits([]); // 区間が変わるので手動分割点・トリムはリセット
    setTrimOverrides({});
    setDirty(false);
  }

  function applyZoomCenter(windowSec, center) {
    const dur = audioBuffer.duration;
    const half = windowSec / 2;
    let start = center - half;
    let end = center + half;
    if (end - start > dur) {
      start = 0;
      end = dur;
    } else if (start < 0) {
      start = 0;
      end = Math.min(dur, windowSec);
    } else if (end > dur) {
      end = dur;
      start = Math.max(0, dur - windowSec);
    }
    setViewStart(start);
    setViewEnd(end);
  }

  function handleZoomChange(sec) {
    if (!audioBuffer) return;
    if (sec === 0) {
      setZoomWindowSec(0);
      setZoomActive(false);
      return;
    }
    const center = isPlaying ? playhead : zoomActive ? (viewStart + viewEnd) / 2 : 0;
    setZoomWindowSec(sec);
    applyZoomCenter(sec, center);
    setZoomActive(true);
  }

  function handleModeChange(mode) {
    setEditMode(mode);
    if (mode !== 'preview' && zoomActive) {
      setZoomActive(false);
    }
  }

  function timeFromClientX(clientX) {
    const canvas = canvasRef.current;
    if (!canvas || !duration) return 0;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return view.start + ratio * viewDur;
  }

  function handleCanvasClick(e) {
    const t = timeFromClientX(e.clientX);
    if (editMode === 'preview') {
      boundedEndRef.current = null;
      seekPreview(t);
      if (zoomWindowSec > 0) {
        setZoomActive(true);
        applyZoomCenter(zoomWindowSec, t);
      }
      return;
    }
    // 分割モード: 演奏区間内かどうか確認(分割モードは常に全体表示)
    const inPlaySeg = playSegs.some((s) => t > s.start + 0.05 && t < s.end - 0.05);
    if (!inPlaySeg) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const pxPerSec = rect.width / viewDur;
    const nearExisting = manualSplits.find((m) => Math.abs(m - t) * pxPerSec < 8);
    if (nearExisting !== undefined) {
      setManualSplits((prev) => prev.filter((m) => m !== nearExisting));
    } else {
      setManualSplits((prev) => [...prev, t].sort((a, b) => a - b));
    }
    setTrimOverrides({}); // 区間の切れ目が変わるのでトリムはリセット
  }

  function seekPreview(t) {
    const el = previewAudioRef.current;
    if (!el) return;
    el.currentTime = t;
    el.play();
  }

  function togglePlay() {
    const el = previewAudioRef.current;
    if (!el) return;
    if (el.paused) {
      el.play();
    } else {
      el.pause();
    }
  }

  function changeSpeed(s) {
    setSpeed(s);
    if (previewAudioRef.current) previewAudioRef.current.playbackRate = s;
  }

  function handlePreviewTimeUpdate(e) {
    const t = e.target.currentTime;
    setPlayhead(t);
    if (zoomActive && zoomWindowSec > 0 && t > viewEnd - zoomWindowSec * 0.1 && viewEnd < duration) {
      applyZoomCenter(zoomWindowSec, t);
    }
    if (boundedEndRef.current != null && t >= boundedEndRef.current) {
      e.target.pause();
      boundedEndRef.current = null;
    }
  }

  function handlePreviewRange(start, end) {
    const el = previewAudioRef.current;
    if (!el) return;
    boundedEndRef.current = end;
    el.currentTime = start;
    el.play();
  }

  function updateTitle(index, title) {
    setTitles((prev) => ({ ...prev, [index]: title }));
  }

  function getTrimBounds(index) {
    const lower = index === 0 ? 0 : effectiveSegs[index - 1].end;
    const upper = index === effectiveSegs.length - 1 ? duration : effectiveSegs[index + 1].start;
    return { lower, upper };
  }

  function handleTrimChange(index, range) {
    setTrimOverrides((prev) => ({ ...prev, [index]: range }));
  }

  async function handleSave() {
    setStage('saving');
    try {
      const band = await getOrCreateDefaultBand();
      const session = await createSession({ bandId: band.id, date, memo });
      for (let i = 0; i < effectiveSegs.length; i++) {
        const seg = effectiveSegs[i];
        const title = titles[i] || `Song ${i + 1}`;
        const track = await createTrack({
          sessionId: session.id,
          title,
          order: i,
          startTime: seg.start,
          endTime: seg.end,
        });
        const wavBlob = sliceAudioBufferToWavBlob(audioBuffer, seg.start, seg.end);
        await saveTrackAudio(track.id, wavBlob);
      }
      navigate(`/session/${session.id}`);
    } catch (err) {
      console.error(err);
      setError('保存に失敗しました。');
      setStage('review');
    }
  }

  const silenceCount = allSegments.filter((s) => s.type === 'silence').length;

  function toPercentInView(t) {
    if (t < view.start || t > view.end) return null;
    return ((t - view.start) / viewDur) * 100;
  }

  return (
    <div>
      <div className="top-bar">
        <Link to="/" className="back-link">
          ← 戻る
        </Link>
        <h1>新規録音</h1>
      </div>

      {(stage === 'idle' || stage === 'analyzing') && (
        <label
          className={`dropzone ${isDragActive ? 'is-active' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragActive(true);
          }}
          onDragLeave={() => setIsDragActive(false)}
          onDrop={handleDrop}
        >
          <input
            type="file"
            accept="audio/*"
            onChange={(e) => handleFile(e.target.files?.[0])}
            disabled={stage === 'analyzing'}
          />
          {stage === 'analyzing' ? (
            <>
              <span>解析中です... ({progress}%)</span>
              <div className="progress-track" style={{ marginTop: 10 }}>
                <div className="progress-fill" style={{ width: `${progress}%` }} />
              </div>
            </>
          ) : (
            <span>
              タップして音声ファイルを選択
              <br />
              (またはここにドロップ)
            </span>
          )}
        </label>
      )}

      {error && <p style={{ color: 'var(--color-danger)', fontSize: 13, marginTop: 10 }}>{error}</p>}

      {(stage === 'review' || stage === 'saving') && (
        <>
          <div className="mode-toggle">
            <button
              className={`mode-toggle-btn ${editMode === 'preview' ? 'is-active' : ''}`}
              onClick={() => handleModeChange('preview')}
            >
              プレビュー
            </button>
            <button
              className={`mode-toggle-btn ${editMode === 'split' ? 'is-active' : ''}`}
              onClick={() => handleModeChange('split')}
            >
              分割点を編集
            </button>
          </div>

          {editMode === 'preview' && (
            <div className="zoom-switch">
              {ZOOM_LEVELS.map((z) => (
                <button
                  key={z.sec}
                  className={`zoom-btn ${
                    (z.sec === 0 && !zoomActive) || (zoomActive && zoomWindowSec === z.sec) ? 'is-active' : ''
                  }`}
                  onClick={() => handleZoomChange(z.sec)}
                >
                  {z.label}
                </button>
              ))}
            </div>
          )}

          <div className="waveform-wrap">
            <canvas ref={canvasRef} className="waveform" onClick={handleCanvasClick} />
            {toPercentInView(playhead) !== null && (
              <div className="playhead-line" style={{ left: `${toPercentInView(playhead)}%` }} />
            )}
            {manualSplits.map((t, i) => {
              const p = toPercentInView(t);
              if (p === null) return null;
              return <div key={i} className="manual-split-marker" style={{ left: `${p}%` }} />;
            })}
          </div>

          <p style={{ fontSize: 11, color: 'var(--color-ink-soft)', marginTop: 6 }}>
            {editMode === 'preview'
              ? 'タップした位置から再生します(ズーム中はタップ位置を中心に追従します)'
              : '演奏区間(グレーの帯以外)をタップして分割点を追加/削除できます(オレンジの縦線)'}
            ・グレーの帯 = 無音と判定された区間({silenceCount}箇所)
          </p>

          {previewUrl && (
            <div className="preview-bar">
              <button className="btn btn-secondary" onClick={togglePlay}>
                {isPlaying ? '一時停止' : '再生'}
              </button>
              <div className="speed-group">
                {SPEEDS.map((s) => (
                  <button
                    key={s}
                    className={`speed-btn ${speed === s ? 'is-active' : ''}`}
                    onClick={() => changeSpeed(s)}
                  >
                    {s}x
                  </button>
                ))}
              </div>
              <span className="preview-time">{formatTime(playhead)}</span>
              <audio
                ref={previewAudioRef}
                src={previewUrl}
                style={{ display: 'none' }}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onTimeUpdate={handlePreviewTimeUpdate}
              />
            </div>
          )}

          <div className="settings-panel">
            <div className="setting-row">
              <div className="setting-label">
                無音判定時間
                <br />
                <span style={{ fontSize: 10 }}>これ以上続いたら無音</span>
              </div>
              <input
                type="range"
                min="10"
                max="600"
                step="10"
                value={settings.minSilenceSec}
                onChange={(e) => handleSliderChange('minSilenceSec', Number(e.target.value))}
              />
              <div className="setting-value">{fmtSliderSec(settings.minSilenceSec)}</div>
            </div>

            <div className="setting-row">
              <div className="setting-label">
                無音判定閾値
                <br />
                <span style={{ fontSize: 10 }}>これ以下を無音候補</span>
              </div>
              <input
                type="range"
                min="-60"
                max="-10"
                step="1"
                value={settings.silenceDb}
                onChange={(e) => handleSliderChange('silenceDb', Number(e.target.value))}
              />
              <div className="setting-value">{settings.silenceDb}dB</div>
            </div>

            <div className="setting-row">
              <div className="setting-label">
                最小演奏時間
                <br />
                <span style={{ fontSize: 10 }}>これより短い演奏は無視</span>
              </div>
              <input
                type="range"
                min="0"
                max="180"
                step="5"
                value={settings.minPlaySec}
                onChange={(e) => handleSliderChange('minPlaySec', Number(e.target.value))}
              />
              <div className="setting-value">{fmtSliderSec(settings.minPlaySec)}</div>
            </div>
          </div>

          {dirty && (
            <button className="btn btn-secondary btn-block" style={{ marginTop: 8 }} onClick={handleReanalyze}>
              この設定で再判定(手動分割点・トリムはリセットされます)
            </button>
          )}

          <div className="section-title">練習日</div>
          <input className="field" type="date" value={date} onChange={(e) => setDate(e.target.value)} />

          <div className="section-title">メモ</div>
          <input
            className="field"
            placeholder="例: ライブ前最終リハ"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />

          <div className="section-title">検出された曲 ({effectiveSegs.length})</div>
          <div className="card">
            {effectiveSegs.length === 0 && (
              <p style={{ fontSize: 13, color: 'var(--color-ink-soft)' }}>
                演奏区間が検出されませんでした。閾値を調整してみてください。
              </p>
            )}
            {effectiveSegs.map((seg, i) => {
              const bounds = getTrimBounds(i);
              return (
                <div key={i} className="song-preview-item">
                  <input
                    className="field"
                    value={titles[i] || `Song ${i + 1}`}
                    onChange={(e) => updateTitle(i, e.target.value)}
                  />
                  <TrackTrimEditor
                    audioBuffer={audioBuffer}
                    original={finalSegs[i]}
                    value={{ start: seg.start, end: seg.end }}
                    lowerBound={bounds.lower}
                    upperBound={bounds.upper}
                    onChange={(range) => handleTrimChange(i, range)}
                    onPreview={handlePreviewRange}
                  />
                </div>
              );
            })}
          </div>

          <button
            className="btn btn-block"
            style={{ marginTop: 20 }}
            onClick={handleSave}
            disabled={stage === 'saving' || effectiveSegs.length === 0}
          >
            {stage === 'saving' ? '保存中...' : 'このセッションを保存'}
          </button>
        </>
      )}
    </div>
  );
}
