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

// ---------------------------------------------------------------------------
// Audio Enhancement(ダイナミクス補正)と簡易EQ
//
// プレビュー再生(AudioContext)と保存時の書き出し(OfflineAudioContext)で
// パラメータがズレないよう、**定義元はこのファイルだけ**に置く。
// チェーンの組み立ても createEnhancementChain() に集約してあるので、
// 音を変えたいときはこの節だけを直せばプレビュー・保存・共有の全部に反映される。
// ---------------------------------------------------------------------------

/** ダイナミクス補正のプリセット。バンド練習音源(音量差が大きい)向けの設定。 */
export const ENHANCEMENT_PRESETS = {
  off: {
    label: 'なし',
    hint: '録音そのまま',
    compressor: null,
    makeupGainDb: 0,
    limiter: null,
  },
  light: {
    label: '軽く整える',
    hint: '音量差をゆるやかにならす',
    // 旧 COMPRESSOR_PRESET と同じ値。従来の「コンプON」がこれに相当する。
    compressor: { threshold: -24, knee: 30, ratio: 3, attack: 0.02, release: 0.25 },
    makeupGainDb: 2,
    limiter: { threshold: -2, knee: 0, ratio: 20, attack: 0.001, release: 0.1 },
  },
  strong: {
    label: 'しっかり整える',
    hint: '小さい音も聴こえるまで持ち上げる',
    compressor: { threshold: -30, knee: 20, ratio: 6, attack: 0.01, release: 0.18 },
    makeupGainDb: 5,
    limiter: { threshold: -2, knee: 0, ratio: 20, attack: 0.001, release: 0.1 },
  },
};

/** 簡易EQプリセット。シェルビングで高域/低域を軽く持ち上げるだけの2種類。 */
export const EQ_PRESETS = {
  off: { label: 'なし', hint: '補正しない', filter: null },
  bright: { label: 'ハイを上げる', hint: 'シャリっとさせる', filter: { type: 'highshelf', frequency: 3200, gain: 4 } },
  warm: { label: 'ローを上げる', hint: '厚みを足す', filter: { type: 'lowshelf', frequency: 220, gain: 4 } },
};

// バイパス時の値(ノードを外さず、無変化になる設定を入れて素通しさせる)
const BYPASS_COMPRESSOR = { threshold: 0, knee: 0, ratio: 1, attack: 0.003, release: 0.25 };
const BYPASS_FILTER = { type: 'peaking', frequency: 1000, gain: 0 };

// ソフトクリッパーの曲線。
// DynamicsCompressorNode は平均レベルを抑える仕組みなので、波形のピーク
// (クレストファクター)はそのまま通過してしまい、それだけでは 0dBFS 超えを防げない。
// そこで最終段に、しきい値までは素通し・それ以上はなだらかに 1.0 へ漸近する
// 曲線を置いて、確実に振り切らないようにする。
const SOFT_CLIP_KNEE = 0.75; // これ以下の振幅は一切変えない
const CURVE_SIZE = 2048;

function makeSoftClipCurve() {
  const curve = new Float32Array(CURVE_SIZE);
  for (let i = 0; i < CURVE_SIZE; i++) {
    const x = (i / (CURVE_SIZE - 1)) * 2 - 1; // -1 〜 1
    const a = Math.abs(x);
    const shaped =
      a <= SOFT_CLIP_KNEE
        ? a
        : SOFT_CLIP_KNEE + (1 - SOFT_CLIP_KNEE) * Math.tanh((a - SOFT_CLIP_KNEE) / (1 - SOFT_CLIP_KNEE));
    curve[i] = Math.sign(x) * shaped;
  }
  return curve;
}

function makeLinearCurve() {
  const curve = new Float32Array(CURVE_SIZE);
  for (let i = 0; i < CURVE_SIZE; i++) {
    curve[i] = (i / (CURVE_SIZE - 1)) * 2 - 1;
  }
  return curve;
}

const SOFT_CLIP_CURVE = makeSoftClipCurve();
const LINEAR_CURVE = makeLinearCurve();

// プリセット切替時の追従時間(秒)。直接代入するとプチノイズが出るため setTargetAtTime を使う。
const SMOOTHING_TIME = 0.02;

export function isEnhancementActive({ enhancement = 'off', eq = 'off' } = {}) {
  return enhancement !== 'off' || eq !== 'off';
}

/**
 * チェーンのパラメータを設定する。
 * smooth=true(プレビュー中の切替)のときは setTargetAtTime で滑らかに変化させ、
 * false(書き出し時、チェーンを作った直後)のときは直接代入する。
 */
export function applyEnhancement(nodes, options = {}, { smooth = false, ctx = null } = {}) {
  const { enhancement = 'off', eq = 'off', gainDb = 0 } = options;
  const preset = ENHANCEMENT_PRESETS[enhancement] || ENHANCEMENT_PRESETS.off;
  const eqPreset = EQ_PRESETS[eq] || EQ_PRESETS.off;

  const set = (param, value) => {
    if (smooth && ctx) {
      param.setTargetAtTime(value, ctx.currentTime, SMOOTHING_TIME);
    } else {
      param.value = value;
    }
  };
  const setCompressor = (node, cfg) => {
    set(node.threshold, cfg.threshold);
    set(node.knee, cfg.knee);
    set(node.ratio, cfg.ratio);
    set(node.attack, cfg.attack);
    set(node.release, cfg.release);
  };

  // EQ(type は AudioParam ではないので常に直接代入)
  const filter = eqPreset.filter || BYPASS_FILTER;
  nodes.eq.type = filter.type;
  set(nodes.eq.frequency, filter.frequency);
  set(nodes.eq.gain, filter.gain);

  setCompressor(nodes.compressor, preset.compressor || BYPASS_COMPRESSOR);
  set(nodes.makeup.gain, dbToLinear(preset.makeupGainDb || 0));
  set(nodes.userGain.gain, dbToLinear(gainDb));
  setCompressor(nodes.limiter, preset.limiter || BYPASS_COMPRESSOR);

  // 補正なしのときは素通し(従来どおり、音量を上げれば波形どおりクリップする)
  nodes.softClip.curve = preset.limiter ? SOFT_CLIP_CURVE : LINEAR_CURVE;
}

/**
 * エフェクトチェーンを組み立てて { input, output, nodes } を返す。
 * プレビュー用(AudioContext)と書き出し用(OfflineAudioContext)の両方から呼ぶ。
 *
 *   Source → EQ → Compressor → Makeup Gain → 手動音量調整 → Limiter → SoftClip → Destination
 *
 * **Limiterは必ず最終段に置く。** 手動音量調整より前に置くと、
 * ユーザーが音量を上げた分がクリッピング防止の対象から漏れてしまう。
 */
export function createEnhancementChain(ctx, options = {}) {
  const nodes = {
    eq: ctx.createBiquadFilter(),
    compressor: ctx.createDynamicsCompressor(),
    makeup: ctx.createGain(),
    userGain: ctx.createGain(),
    limiter: ctx.createDynamicsCompressor(),
    softClip: ctx.createWaveShaper(),
  };

  const order = [nodes.eq, nodes.compressor, nodes.makeup, nodes.userGain, nodes.limiter, nodes.softClip];
  for (let i = 0; i < order.length - 1; i++) {
    order[i].connect(order[i + 1]);
  }

  applyEnhancement(nodes, options, { smooth: false });

  return {
    input: order[0],
    output: order[order.length - 1],
    nodes,
    disconnect: () => order.forEach((n) => n.disconnect()),
  };
}

function encodeWavFromChannels(channelsData, frameCount, numChannels, sampleRate) {
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

  let offset = 44;
  for (let i = 0; i < frameCount; i++) {
    for (let c = 0; c < numChannels; c++) {
      let sample = channelsData[c][i] || 0;
      sample = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/** AudioBufferの一部区間を16bit PCM WAVのBlobとして書き出す(元ツールと同じロジック)。gainは1.0が等倍 */
export function sliceAudioBufferToWavBlob(audioBuffer, startTime, endTime, gain = 1) {
  const sampleRate = audioBuffer.sampleRate;
  const numChannels = audioBuffer.numberOfChannels;
  const startFrame = Math.max(0, Math.floor(startTime * sampleRate));
  const endFrame = Math.min(audioBuffer.length, Math.ceil(endTime * sampleRate));
  const frameCount = Math.max(0, endFrame - startFrame);

  const channels = [];
  for (let c = 0; c < numChannels; c++) {
    const src = audioBuffer.getChannelData(c);
    const out = new Float32Array(frameCount);
    for (let i = 0; i < frameCount; i++) {
      out[i] = (src[startFrame + i] || 0) * gain;
    }
    channels.push(out);
  }

  return encodeWavFromChannels(channels, frameCount, numChannels, sampleRate);
}

/**
 * 区間を Audio Enhancement(ダイナミクス補正・EQ・音量調整)適用済みでWAV Blobとして書き出す。
 * コンプ/リミッターは時間方向の処理が必要なため、OfflineAudioContextで非リアルタイムレンダリングする。
 * optionsは { enhancement, eq, gainDb } で、プレビュー再生と同じものを渡すこと。
 */
export async function sliceAudioBufferToWavBlobWithEnhancement(audioBuffer, startTime, endTime, options = {}) {
  const sampleRate = audioBuffer.sampleRate;
  const numChannels = audioBuffer.numberOfChannels;
  const startFrame = Math.max(0, Math.floor(startTime * sampleRate));
  const endFrame = Math.min(audioBuffer.length, Math.ceil(endTime * sampleRate));
  const frameCount = Math.max(1, endFrame - startFrame);

  const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const offlineCtx = new OfflineCtx(numChannels, frameCount, sampleRate);

  const slice = offlineCtx.createBuffer(numChannels, frameCount, sampleRate);
  for (let c = 0; c < numChannels; c++) {
    const src = audioBuffer.getChannelData(c).subarray(startFrame, startFrame + frameCount);
    slice.copyToChannel(src, c);
  }

  const source = offlineCtx.createBufferSource();
  source.buffer = slice;

  const chain = createEnhancementChain(offlineCtx, options);
  source.connect(chain.input);
  chain.output.connect(offlineCtx.destination);

  source.start();
  const rendered = await offlineCtx.startRendering();

  const channels = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(rendered.getChannelData(c));
  }
  return encodeWavFromChannels(channels, frameCount, numChannels, sampleRate);
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
 * gain(リニア倍率、既定1)を渡すと、その音量調整を波形の見た目にも反映し、
 * クリップする(音が割れる)部分は警告色で描画する。
 */
export function drawWaveform(canvas, audioBuffer, segments = [], viewRange = null, gain = 1) {
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
  const barW = w / n;
  for (let i = 0; i < n; i++) {
    const raw = peaks[i] * gain;
    const isClipping = raw > 1;
    const amp = Math.min(1, raw);
    const barH = Math.max(1, amp * (h * 0.85));
    const x = i * barW;
    ctx.fillStyle = isClipping ? '#b0503f' : '#211f1b';
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
