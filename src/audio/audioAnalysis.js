// 音声解析ユーティリティ
//
// rehearsal-rec-splitter.html (build: 2026-07-10) の実コードから
// RMS計算・無音区間検出・WAV書き出しロジックをそのまま移植したもの。
// 閾値は「絶対dBFS基準」(グローバル最大振幅基準ではない点に注意)。

export const ANALYSIS_INTERVAL_SEC = 0.2; // RMS解析の時間刻み(元ツールと同じ固定値)

export const DEFAULT_ANALYSIS_OPTIONS = {
  minSilenceSec: 60, // 無音判定時間(秒) スライダー範囲: 10-600, step10
  silenceDb: -30, // 無音判定閾値(dB) スライダー範囲: -60〜-10, step1
  minPlaySec: 3, // 最小演奏時間(秒) スライダー範囲: 0-180, step5
};

export async function decodeAudioFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const audioCtx = new AudioContextClass();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  return audioBuffer;
}

// dB(dBFS) → RMS振幅(0dBFS = RMS 1.0とする)
function dbToRms(db) {
  return Math.pow(10, db / 20);
}

/**
 * 全チャンネルをまとめてRMSを計算する(元ツールと同じ:チャンネルをミックスダウンせず、
 * 全チャンネルのサンプルをまとめて二乗平均する)。重い処理なのでonProgressで進捗を通知できる。
 */
export function computeRMS(audioBuffer, intervalSec = ANALYSIS_INTERVAL_SEC, onProgress) {
  const sampleRate = audioBuffer.sampleRate;
  const channelCount = audioBuffer.numberOfChannels;
  const frameSize = Math.max(1, Math.floor(intervalSec * sampleRate));
  const totalFrames = audioBuffer.length;
  const numWindows = Math.ceil(totalFrames / frameSize);
  const rms = new Float32Array(numWindows);

  const channels = [];
  for (let c = 0; c < channelCount; c++) {
    channels.push(audioBuffer.getChannelData(c));
  }

  for (let w = 0; w < numWindows; w++) {
    const start = w * frameSize;
    const end = Math.min(start + frameSize, totalFrames);
    let sumSq = 0;
    let count = 0;
    for (let c = 0; c < channelCount; c++) {
      const data = channels[c];
      for (let i = start; i < end; i++) {
        const v = data[i];
        sumSq += v * v;
        count++;
      }
    }
    rms[w] = count > 0 ? Math.sqrt(sumSq / count) : 0;
    if (onProgress && w % 200 === 0) onProgress(w / numWindows);
  }
  if (onProgress) onProgress(1);
  return rms;
}

/**
 * RMS配列から演奏区間/無音区間を判定する(元ツールのdetectSegmentsと同じロジック)。
 * 戻り値は [{ type: 'play'|'silence', start, end }] (時間・秒)。
 */
export function detectSegments(rms, intervalSec, totalDuration, options = {}) {
  const { minSilenceSec, silenceDb, minPlaySec } = {
    ...DEFAULT_ANALYSIS_OPTIONS,
    ...options,
  };
  const thresholdRms = dbToRms(silenceDb);
  const minSilenceWindows = Math.ceil(minSilenceSec / intervalSec);

  const isSilent = new Uint8Array(rms.length);
  for (let i = 0; i < rms.length; i++) {
    isSilent[i] = rms[i] <= thresholdRms ? 1 : 0;
  }

  const segs = [];
  let i = 0;
  while (i < isSilent.length) {
    const startI = i;
    const val = isSilent[i];
    while (i < isSilent.length && isSilent[i] === val) i++;
    const endI = i;
    const lengthWindows = endI - startI;
    const isLongSilence = val === 1 && lengthWindows >= minSilenceWindows;
    segs.push({ type: isLongSilence ? 'silence' : 'play', startI, endI });
  }

  const merged = [];
  for (const s of segs) {
    if (merged.length && merged[merged.length - 1].type === s.type) {
      merged[merged.length - 1].endI = s.endI;
    } else {
      merged.push({ ...s });
    }
  }

  // 最小演奏時間未満の'play'区間は'silence'として扱う(短い誤検出の除去)
  const minPlayWindows = Math.ceil(minPlaySec / intervalSec);
  for (const s of merged) {
    if (s.type === 'play' && s.endI - s.startI < minPlayWindows) {
      s.type = 'silence';
    }
  }

  const remerged = [];
  for (const s of merged) {
    if (remerged.length && remerged[remerged.length - 1].type === s.type) {
      remerged[remerged.length - 1].endI = s.endI;
    } else {
      remerged.push({ ...s });
    }
  }

  return remerged
    .map((s) => ({
      type: s.type,
      start: Math.min(s.startI * intervalSec, totalDuration),
      end: Math.min(s.endI * intervalSec, totalDuration),
    }))
    .filter((s) => s.end - s.start > 0.05);
}

/** 演奏区間(type==='play')だけを抜き出す */
export function playSegmentsOnly(segments) {
  return segments.filter((s) => s.type === 'play');
}

/**
 * 演奏区間を、ユーザーが手動で追加した分割点(秒の配列)でさらに分割する。
 * 各分割点は、それが含まれる演奏区間の中でのみ有効。
 */
export function splitPlaySegments(playSegments, manualSplitTimes) {
  if (!manualSplitTimes || manualSplitTimes.length === 0) return playSegments;
  const sorted = [...manualSplitTimes].sort((a, b) => a - b);
  const result = [];
  for (const seg of playSegments) {
    const pointsInSeg = sorted.filter((t) => t > seg.start + 0.05 && t < seg.end - 0.05);
    if (pointsInSeg.length === 0) {
      result.push(seg);
      continue;
    }
    let prev = seg.start;
    for (const t of pointsInSeg) {
      result.push({ type: 'play', start: prev, end: t });
      prev = t;
    }
    result.push({ type: 'play', start: prev, end: seg.end });
  }
  return result;
}

function writeAsciiString(view, offset, str) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

// dB → リニアゲイン(音量調整・プレビュー再生の両方で使う)
export function dbToLinear(db) {
  return Math.pow(10, db / 20);
}

/** AudioBufferの一部区間を16bit PCM WAVのBlobとして書き出す(元ツールと同じロジック)。gainは1.0が等倍 */
export function sliceAudioBufferToWavBlob(audioBuffer, startTime, endTime, gain = 1) {
  const sampleRate = audioBuffer.sampleRate;
  const numChannels = audioBuffer.numberOfChannels;
  const startFrame = Math.max(0, Math.floor(startTime * sampleRate));
  const endFrame = Math.min(audioBuffer.length, Math.ceil(endTime * sampleRate));
  const frameCount = Math.max(0, endFrame - startFrame);

  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = frameCount * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAsciiString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAsciiString(view, 8, 'WAVE');
  writeAsciiString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeAsciiString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  const channels = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(audioBuffer.getChannelData(c));
  }

  let offset = 44;
  for (let i = 0; i < frameCount; i++) {
    for (let c = 0; c < numChannels; c++) {
      let sample = (channels[c][startFrame + i] || 0) * gain;
      sample = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/** 波形描画用に、全体をnumBuckets個のピーク(絶対値の最大)に間引く(元ツールと同じ) */
export function computePeaks(audioBuffer, numBuckets = 600) {
  const data = audioBuffer.getChannelData(0);
  const len = data.length;
  const bucketSize = Math.floor(len / numBuckets) || 1;
  const peaks = new Float32Array(numBuckets);
  for (let b = 0; b < numBuckets; b++) {
    const start = b * bucketSize;
    const end = Math.min(start + bucketSize, len);
    let max = 0;
    for (let i = start; i < end; i++) {
      const v = Math.abs(data[i]);
      if (v > max) max = v;
    }
    peaks[b] = max;
  }
  return peaks;
}

/** 指定した時間範囲(startSec〜endSec)だけを対象にピークを計算する(ズーム表示・曲単位プレビュー用) */
export function computePeaksForRange(audioBuffer, startSec, endSec, numBuckets = 500) {
  const data = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const startSample = Math.max(0, Math.floor(startSec * sampleRate));
  const endSample = Math.min(data.length, Math.floor(endSec * sampleRate));
  const len = Math.max(1, endSample - startSample);
  const bucketSize = Math.floor(len / numBuckets) || 1;
  const peaks = new Float32Array(numBuckets);
  for (let b = 0; b < numBuckets; b++) {
    const s = startSample + b * bucketSize;
    const e = Math.min(s + bucketSize, endSample);
    let max = 0;
    for (let i = s; i < e; i++) {
      const v = Math.abs(data[i] || 0);
      if (v > max) max = v;
    }
    peaks[b] = max;
  }
  return peaks;
}

/**
 * 波形+無音帯+区間境界線をcanvasに描画する。
 * viewRangeを渡すと、その範囲({start,end}秒)だけを拡大表示する(ズーム表示・曲単位プレビュー用)。
 * 省略時は全体表示。
 */
export function drawWaveform(canvas, audioBuffer, segments = [], viewRange = null) {
  if (!canvas || !audioBuffer) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = rect.width || canvas.parentElement?.clientWidth || 300;
  const h = 120;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const viewStart = viewRange ? viewRange.start : 0;
  const viewEnd = viewRange ? viewRange.end : audioBuffer.duration;
  const viewDur = Math.max(0.001, viewEnd - viewStart);
  const mid = h / 2;
  const timeToX = (t) => ((t - viewStart) / viewDur) * w;

  ctx.fillStyle = '#e2ddd0';
  segments
    .filter((s) => s.type === 'silence' && s.end > viewStart && s.start < viewEnd)
    .forEach((s) => {
      const x1 = timeToX(Math.max(s.start, viewStart));
      const x2 = timeToX(Math.min(s.end, viewEnd));
      ctx.fillRect(x1, 0, Math.max(1, x2 - x1), h);
    });

  const peaks = viewRange
    ? computePeaksForRange(audioBuffer, viewStart, viewEnd, 500)
    : computePeaks(audioBuffer, 600);
  const n = peaks.length;
  ctx.fillStyle = '#211f1b';
  const barW = w / n;
  for (let i = 0; i < n; i++) {
    const amp = peaks[i];
    const barH = Math.max(1, amp * (h * 0.85));
    const x = i * barW;
    ctx.fillRect(x, mid - barH / 2, Math.max(1, barW * 0.7), barH);
  }

  ctx.strokeStyle = '#b6ae9c';
  ctx.lineWidth = 1;
  segments
    .filter((s) => s.start >= viewStart && s.start <= viewEnd)
    .forEach((s) => {
      const x = timeToX(s.start);
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, h);
      ctx.stroke();
    });
}

export function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
