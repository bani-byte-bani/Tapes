import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  decodeAudioFile,
  computeRMS,
  detectSegments,
  playSegmentsOnly,
  sliceAudioBufferToWavBlob,
  drawWaveform,
  formatTime,
  ANALYSIS_INTERVAL_SEC,
  DEFAULT_ANALYSIS_OPTIONS,
} from '../audio/audioAnalysis.js';
import { getOrCreateDefaultBand, createSession, createTrack, saveTrackAudio } from '../repository/localRepository.js';

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

  const [stage, setStage] = useState('idle'); // idle | analyzing | review | saving
  const [isDragActive, setIsDragActive] = useState(false);
  const [progress, setProgress] = useState(0);
  const [audioBuffer, setAudioBuffer] = useState(null);
  const [rms, setRms] = useState(null);
  const [allSegments, setAllSegments] = useState([]); // play + silence
  const [titles, setTitles] = useState({}); // playIndex -> タイトル
  const [settings, setSettings] = useState(DEFAULT_ANALYSIS_OPTIONS);
  const [dirty, setDirty] = useState(false); // スライダーを動かしたが未反映
  const [date, setDate] = useState(todayStr());
  const [memo, setMemo] = useState('');
  const [error, setError] = useState('');

  const playSegs = playSegmentsOnly(allSegments);

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
      setDirty(false);
      recompute(settings, buffer, rmsData);
      setStage('review');
    } catch (err) {
      console.error(err);
      setError('音声ファイルを読み込めませんでした。対応形式(wav / mp3 / m4a など)かご確認ください。');
      setStage('idle');
    }
  }

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
    setDirty(false);
  }

  function updateTitle(index, title) {
    setTitles((prev) => ({ ...prev, [index]: title }));
  }

  async function handleSave() {
    setStage('saving');
    try {
      const band = await getOrCreateDefaultBand();
      const session = await createSession({ bandId: band.id, date, memo });
      for (let i = 0; i < playSegs.length; i++) {
        const seg = playSegs[i];
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
          <canvas ref={canvasRef} className="waveform" style={{ marginTop: 4 }} />
          <p style={{ fontSize: 11, color: 'var(--color-ink-soft)', marginTop: 6 }}>
            グレーの帯 = 無音と判定された区間({silenceCount}箇所)
          </p>

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
              この設定で再判定
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

          <div className="section-title">検出された曲 ({playSegs.length})</div>
          <div className="card">
            {playSegs.length === 0 && (
              <p style={{ fontSize: 13, color: 'var(--color-ink-soft)' }}>
                演奏区間が検出されませんでした。閾値を調整してみてください。
              </p>
            )}
            {playSegs.map((seg, i) => (
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
            disabled={stage === 'saving' || playSegs.length === 0}
          >
            {stage === 'saving' ? '保存中...' : 'このセッションを保存'}
          </button>
        </>
      )}
    </div>
  );
}
