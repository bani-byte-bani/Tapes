import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getOrCreateDefaultBand,
  listSessions,
  listTracks,
} from '../repository/localRepository.js';
import TapeDeckButton from '../components/TapeDeckButton.jsx';

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${y}/${m}/${d}`;
}

export default function SessionList() {
  const [band, setBand] = useState(null);
  const [sessions, setSessions] = useState(null);
  const [trackCounts, setTrackCounts] = useState({});

  useEffect(() => {
    (async () => {
      const b = await getOrCreateDefaultBand();
      setBand(b);
      const list = await listSessions(b.id);
      setSessions(list);
      const counts = {};
      for (const s of list) {
        const tracks = await listTracks(s.id);
        counts[s.id] = tracks.length;
      }
      setTrackCounts(counts);
    })();
  }, []);

  return (
    <div>
      <div className="top-bar">
        <h1>{band ? band.name : 'バンド練習レビュー'}</h1>
      </div>

      {sessions === null && <p style={{ color: 'var(--color-ink-soft)' }}>読み込み中...</p>}

      {sessions && sessions.length === 0 && (
        <div className="empty-state">
          まだ練習記録がありません。
          <br />
          右下のボタンから録音をアップロードしてみましょう。
        </div>
      )}

      {sessions &&
        sessions.map((s) => (
          <Link to={`/session/${s.id}`} className="card-link" key={s.id}>
            <div className="card">
              <div className="session-card-title">{s.memo || formatDate(s.date)}</div>
              <div className="session-card-meta">
                {formatDate(s.date)} ・ {trackCounts[s.id] ?? '…'}曲
                {s.syncStatus === 'shared' ? ' ・ 共有済み' : ''}
              </div>
            </div>
          </Link>
        ))}

      <TapeDeckButton />
    </div>
  );
}
