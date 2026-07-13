import { nanoid } from 'nanoid';
import { getDB } from '../db/indexedDB.js';

const DEFAULT_BAND_ID = 'default-band';

// MVPでは「1ブラウザ = 1Band」に簡略化。
// 複数バンド対応が必要になったらここを拡張する。
export async function getOrCreateDefaultBand() {
  const db = await getDB();
  let band = await db.get('bands', DEFAULT_BAND_ID);
  if (!band) {
    band = {
      id: DEFAULT_BAND_ID,
      name: 'マイバンド',
      createdAt: new Date().toISOString(),
    };
    await db.put('bands', band);
  }
  return band;
}

export async function updateBandName(bandId, name) {
  const db = await getDB();
  const band = await db.get('bands', bandId);
  if (!band) return null;
  const updated = { ...band, name };
  await db.put('bands', updated);
  return updated;
}

export async function listSessions(bandId) {
  const db = await getDB();
  const sessions = await db.getAllFromIndex('sessions', 'by-bandId', bandId);
  return sessions.sort((a, b) => (a.date < b.date ? 1 : -1));
}

export async function getSession(sessionId) {
  const db = await getDB();
  return db.get('sessions', sessionId);
}

export async function createSession({ bandId, date, memo }) {
  const db = await getDB();
  const session = {
    id: nanoid(10),
    bandId,
    date,
    memo: memo || '',
    createdAt: new Date().toISOString(),
    shareId: null,
    shareEditToken: null,
    syncStatus: 'local',
  };
  await db.put('sessions', session);
  return session;
}

export async function updateSession(sessionId, patch) {
  const db = await getDB();
  const session = await db.get('sessions', sessionId);
  if (!session) return null;
  const updated = { ...session, ...patch };
  await db.put('sessions', updated);
  return updated;
}

export async function markSessionShared(sessionId, { shareId, shareEditToken }) {
  return updateSession(sessionId, { shareId, shareEditToken, syncStatus: 'shared' });
}

export async function deleteSession(sessionId) {
  const db = await getDB();
  const tracks = await listTracks(sessionId);
  const tx = db.transaction(['sessions', 'tracks', 'trackAudio', 'comments'], 'readwrite');
  await tx.objectStore('sessions').delete(sessionId);
  for (const track of tracks) {
    await tx.objectStore('tracks').delete(track.id);
    await tx.objectStore('trackAudio').delete(track.id);
    const comments = await tx.objectStore('comments').index('by-trackId').getAll(track.id);
    for (const c of comments) {
      await tx.objectStore('comments').delete(c.id);
    }
  }
  await tx.done;
}

export async function listTracks(sessionId) {
  const db = await getDB();
  const tracks = await db.getAllFromIndex('tracks', 'by-sessionId', sessionId);
  return tracks.sort((a, b) => a.order - b.order);
}

export async function getTrack(trackId) {
  const db = await getDB();
  return db.get('tracks', trackId);
}

export async function createTrack({ sessionId, title, order, startTime, endTime }) {
  const db = await getDB();
  const track = {
    id: nanoid(10),
    sessionId,
    title,
    order,
    startTime,
    endTime,
    favorite: 0,
    memo: '',
  };
  await db.put('tracks', track);
  return track;
}

export async function updateTrack(trackId, patch) {
  const db = await getDB();
  const track = await db.get('tracks', trackId);
  if (!track) return null;
  const updated = { ...track, ...patch };
  await db.put('tracks', updated);
  return updated;
}

export async function saveTrackAudio(trackId, blob) {
  const db = await getDB();
  await db.put('trackAudio', { trackId, blob });
}

export async function getTrackAudio(trackId) {
  const db = await getDB();
  const row = await db.get('trackAudio', trackId);
  return row ? row.blob : null;
}

export async function listComments(trackId) {
  const db = await getDB();
  const comments = await db.getAllFromIndex('comments', 'by-trackId', trackId);
  return comments.sort((a, b) => a.time - b.time);
}

export async function addComment({ trackId, time, text }) {
  const db = await getDB();
  const comment = {
    id: nanoid(10),
    trackId,
    time,
    text,
    createdAt: new Date().toISOString(),
  };
  await db.put('comments', comment);
  return comment;
}

export async function deleteComment(commentId) {
  const db = await getDB();
  await db.delete('comments', commentId);
}
