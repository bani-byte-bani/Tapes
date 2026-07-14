import { openDB } from 'idb';

const DB_NAME = 'band-practice-review';
const DB_VERSION = 2;

let dbPromise = null;

export function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('bands')) {
          db.createObjectStore('bands', { keyPath: 'id' });
        }

        if (!db.objectStoreNames.contains('sessions')) {
          const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
          sessions.createIndex('by-bandId', 'bandId');
        }

        if (!db.objectStoreNames.contains('tracks')) {
          const tracks = db.createObjectStore('tracks', { keyPath: 'id' });
          tracks.createIndex('by-sessionId', 'sessionId');
        }

        // 音声本体(Blob)はメタデータと別ストアに分離。
        // 一覧表示のたびに大きなBlobまで読み込まないようにするため。
        if (!db.objectStoreNames.contains('trackAudio')) {
          db.createObjectStore('trackAudio', { keyPath: 'trackId' });
        }

        if (!db.objectStoreNames.contains('comments')) {
          const comments = db.createObjectStore('comments', { keyPath: 'id' });
          comments.createIndex('by-trackId', 'trackId');
        }

        // v2: 表示名などブラウザごとの個人設定
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      },
    });
  }
  return dbPromise;
}
