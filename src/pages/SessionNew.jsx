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

const SPEEDS = [1, 1.25, 1.5, 2];

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
  const waveWrapRef = useRef(null);
  const previewAudioRef = useRef(null);

  const [stage, setStage] = useState('idle'); // idle | analyzing | review | saving
  const [isDragActive, setIsDragActive] = useState(false);
  const [progress, setProgress] = useState(0);
  const [audioBuffer, setAudioBuffer] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [rms, setRms] = useState(null);
  const [allSegments, setAllSegments] = useState([]); // play + silence(自動判定のまま)
  const [manualSplits, setManualSplits] = useState([]); // ユーザーが追加した分割点(秒)
  const [editMode, setEditMode] = useState('preview'); // 'preview' | 'split'
  const [titles, setTitles] = useState({}); // finalIndex -> タイトル
  const [settings, setSettings] = useState(DEFAULT_ANALYSIS_OPTIONS);
  const [dirty, setDirty] = useState(false);
  const [date, setDate] = useState(todayStr());
  const [memo, setMemo] = useState('');
  const [error, setError] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [playhead, setPlayhead] = useState(0);

  const playSegs = playSegmentsOnly(allSegments);
  const finalSegs = splitPlaySegments(playSegs, manualSplits);
  const duration = audioBuffer ? audioBuffer.duration : 0;

  function redraw(buffer, segs) {
    requestAnimationFrame(() => {
      if (canvasRef.current) drawWaveform(canvasRef.current, buffer, segs);
    });
  }

  function recompute(nextSettings, buffer, rmsData) {
    const detected = detectSegments(rmsData, ANALYSIS_INTERVAL_SEC, buffer.duration, nextSettings);
    setAllSegments(detected);
    redraw(buffer, detected);
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
      setDirty(false);
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
    setManualSplits([]); // 区間が変わるので手動分割点はリセット
    setDirty(false);
  }

  function timeFromClientX(clientX) {
    const canvas = canvasRef.current;
    if (!canvas || !duration) return 0;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return ratio * duration;
  }

  function handleCanvasClick(e) {
    const t = timeFromClientX(e.clientX);
    if (editMode === 'preview') {
      seekPreview(t);
      return;
    }
    // 分割モード: 演奏区間内かどうか確認
    const inPlaySeg = playSegs.some((s) => t > s.start + 0.05 && t < s.end - 0.05);
    if (!inPlaySeg) return;

    const nearThreshold = Math.max(0.15, duration * 0.006);
    const nearExisting = manualSplits.find((m) => Math.abs(m - t) < nearThreshold);
    if (nearExisting !== undefined) {
      setManualSplits((prev) => prev.filter((m) => m !== nearExisting));
    } else {
      setManualSplits((prev) => [...prev, t].sort((a, b) => a - b));
    }
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

  function updateTitle(index, title) {
    setTitles((prev) => ({ ...prev, [index]: title }));
  }

  async function handleSave() {
    setStage('saving');
    try {
      const band = await getOrCreateDefaultBand();
      const session = await createSession({ bandId: band.id, date, memo });
      for (let i = 0; i < finalSegs.length; i++) {
        const seg = finalSegs[i];
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
              onClick={() => setEditMode('preview')}
            >
              プレビュー
            </button>
            <button
              className={`mode-toggle-btn ${editMode === 'split' ? 'is-active' : ''}`}
              onClick={() => setEditMode('split')}
            >
              分割点を編集
            </button>
          </div>

          <div className="waveform-wrap" ref={waveWrapRef}>
            <canvas ref={canvasRef} className="waveform" onClick={handleCanvasClick} />
            {duration > 0 && (
              <div className="playhead-line" style={{ left: `${(playhead / duration) * 100}%` }} />
            )}
            {manualSplits.map((t, i) => (
              <div key={i} className="manual-split-marker" style={{ left: `${(t / duration) * 100}%` }} />
            ))}
          </div>

          <p style={{ fontSize: 11, color: 'var(--color-ink-soft)', marginTop: 6 }}>
            {editMode === 'preview'
              ? '波形をタップした位置から再生します(再生ヘッドは薄いオレンジの縦線)'
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
                onTimeUpdate={(e) => setPlayhead(e.target.currentTime)}
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
              この設定で再判定(手動分割点はリセットされます)
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

          <div className="section-title">検出された曲 ({finalSegs.length})</div>
          <div className="card">
            {finalSegs.length === 0 && (
              <p style={{ fontSize: 13, color: 'var(--color-ink-soft)' }}>
                演奏区間が検出されませんでした。閾値を調整してみてください。
              </p>
            )}
            {finalSegs.map((seg, i) => (
              <div key={i} className="track-row" style={{ flexWrap: 'wrap' }}>
                <input
                  className="field"
                  style={{ flex: 1 }}
                  value={titles[i] || `Song ${i + 1}`}
                  onChange={(e) => updateTitle(i, e.target.value)}
                />
                <div className="track-row-meta" style={{ marginLeft: 8 }}>
                  {formatTime(seg.start)} - {formatTime(seg.end)}
                </div>
              </div>
            ))}
          </div>

          <button
            className="btn btn-block"
            style={{ marginTop: 20 }}
            onClick={handleSave}
            disabled={stage === 'saving' || finalSegs.length === 0}
          >
            {stage === 'saving' ? '保存中...' : 'このセッションを保存'}
          </button>
        </>
      )}
    </div>
  );
}
