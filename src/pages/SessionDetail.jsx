import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  getSession,
  listTracks,
  listComments,
  updateSession,
} from '../repository/localRepository.js';
import StarRating from '../components/StarRating.jsx';
import ShareModal from '../components/ShareModal.jsx';

export default function SessionDetail() {
  const { sessionId } = useParams();
  const [session, setSession] = useState(null);
  const [tracks, setTracks] = useState([]);
  const [commentCounts, setCommentCounts] = useState({});
  const [allComments, setAllComments] = useState([]);
  const [showShare, setShowShare] = useState(false);
  const [memoDraft, setMemoDraft] = useState('');

  async function load() {
    const s = await getSession(sessionId);
    setSession(s);
    setMemoDraft(s ? s.memo : '');
    const trackList = await listTracks(sessionId);
    setTracks(trackList);
    const counts = {};
    const comments = [];
    for (const t of trackList) {
      const cs = await listComments(t.id);
      counts[t.id] = cs.length;
      comments.push(...cs);
    }
    setCommentCounts(counts);
    setAllComments(comments);
  }

  useEffect(() => {
    load();
  }, [sessionId]);

  async function handleMemoBlur() {
    if (session && memoDraft !== session.memo) {
      const updated = await updateSession(sessionId, { memo: memoDraft });
      setSession(updated);
    }
  }

  if (!session) {
    return <p style={{ color: 'var(--color-ink-soft)' }}>読み込み中...</p>;
  }

  return (
    <div>
      <div className="top-bar">
        <Link to="/" className="back-link">
          ← 戻る
        </Link>
        <h1>{session.date}</h1>
      </div>

      <input
        className="field"
        placeholder="このセッションのメモ"
        value={memoDraft}
        onChange={(e) => setMemoDraft(e.target.value)}
        onBlur={handleMemoBlur}
      />

      <div className="section-title">トラック ({tracks.length})</div>
      <div className="card">
        {tracks.length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--color-ink-soft)' }}>トラックがありません</p>
        )}
        {tracks.map((t) => (
          <Link key={t.id} to={`/session/${sessionId}/track/${t.id}`} className="track-row">
            <div>
              <div className="track-row-title">{t.title}</div>
              <div className="track-row-meta">
                コメント{commentCounts[t.id] ?? 0}件
              </div>
            </div>
            <StarRating value={t.favorite} readOnly />
          </Link>
        ))}
      </div>

      <button className="btn btn-block" style={{ marginTop: 20 }} onClick={() => setShowShare(true)}>
        {session.syncStatus === 'shared' ? '共有リンクを表示' : 'このセッションを共有'}
      </button>

      {showShare && (
        <ShareModal
          session={session}
          tracks={tracks}
          comments={allComments}
          onClose={() => setShowShare(false)}
          onShared={load}
        />
      )}
    </div>
  );
}
