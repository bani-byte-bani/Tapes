import { openDB } from 'idb';

const DB_NAME = 'band-practice-review';
const DB_VERSION = 1;

let dbPromise = null;

export function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore('bands', { keyPath: 'id' });

        const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
        sessions.createIndex('by-bandId', 'bandId');

        const tracks = db.createObjectStore('tracks', { keyPath: 'id' });
        tracks.createIndex('by-sessionId', 'sessionId');

        // 音声本体(Blob)はメタデータと別ストアに分離。
        // 一覧表示のたびに大きなBlobまで読み込まないようにするため。
        db.createObjectStore('trackAudio', { keyPath: 'trackId' });

        const comments = db.createObjectStore('comments', { keyPath: 'id' });
        comments.createIndex('by-trackId', 'trackId');
      },
    });
  }
  return dbPromise;
}
