import lamejs from 'lamejs';

function floatTo16BitPCM(float32Array) {
  const output = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return output;
}

/**
 * AudioBufferの一部区間をMP3としてエンコードする。
 * 共有(R2アップロード)時のみ使用し、非圧縮WAVより大幅に
 * ファイルサイズを削減する目的。ローカル保存(IndexedDB)は
 * 引き続きWAVのままでよい。
 */
export function encodeAudioBufferToMp3Blob(audioBuffer, startTime, endTime, bitrateKbps = 128) {
  const sampleRate = audioBuffer.sampleRate;
  const startSample = Math.max(0, Math.floor(startTime * sampleRate));
  const endSample = Math.min(Math.floor(endTime * sampleRate), audioBuffer.length);
  const numChannels = Math.min(2, audioBuffer.numberOfChannels);

  const left = floatTo16BitPCM(audioBuffer.getChannelData(0).subarray(startSample, endSample));
  const right =
    numChannels === 2
      ? floatTo16BitPCM(audioBuffer.getChannelData(1).subarray(startSample, endSample))
      : null;

  const encoder = new lamejs.Mp3Encoder(numChannels, sampleRate, bitrateKbps);
  const blockSize = 1152;
  const chunks = [];

  for (let i = 0; i < left.length; i += blockSize) {
    const leftChunk = left.subarray(i, i + blockSize);
    let mp3buf;
    if (numChannels === 2) {
      const rightChunk = right.subarray(i, i + blockSize);
      mp3buf = encoder.encodeBuffer(leftChunk, rightChunk);
    } else {
      mp3buf = encoder.encodeBuffer(leftChunk);
    }
    if (mp3buf.length > 0) chunks.push(mp3buf);
  }
  const tail = encoder.flush();
  if (tail.length > 0) chunks.push(tail);

  return new Blob(chunks, { type: 'audio/mpeg' });
}

/**
 * ローカル保存されているWAV Blob(トラック単位)をMP3 Blobに変換する。
 * 共有ボタンを押したタイミングでのみ呼び出す。
 */
export async function convertWavBlobToMp3Blob(wavBlob, bitrateKbps = 128) {
  const arrayBuffer = await wavBlob.arrayBuffer();
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const audioCtx = new AudioContextClass();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  const blob = encodeAudioBufferToMp3Blob(audioBuffer, 0, audioBuffer.duration, bitrateKbps);
  audioCtx.close();
  return blob;
}
