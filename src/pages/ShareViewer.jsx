import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { nanoid } from 'nanoid';
import {
  fetchSharedSession,
  getSharedAudioUrl,
  updateSharedSession,
} from '../repository/remoteRepository.js';
import StarRating from '../components/StarRating.jsx';
import CommentTimeline from '../components/CommentTimeline.jsx';
import NicknameField from '../components/NicknameField.jsx';

export default function ShareViewer() {
  const { shareId } = useParams();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const canEdit = Boolean(token);

  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [selectedTrackId, setSelectedTrackId] = useState(null);
  const [newComment, setNewComment] = useState('');
  const [nickname, setNickname] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const result = await fetchSharedSession(shareId);
        setData(result);
      } catch (err) {
        setError(err.message === 'not-found' ? 'このリンクは見つかりませんでした。' : '読み込みに失敗しました。');
      }
    })();
  }, [shareId]);

  async function applyPatch(patch) {
    if (!canEdit) return;
    try {
      const updated = await updateSharedSession(shareId, token, patch);
      setData(updated);
    } catch (err) {
      console.error(err);
    }
  }

  async function handleFavorite(trackId, value) {
    await applyPatch({ tracks: [{ id: trackId, favorite: value }] });
  }

  async function handleTitleChange(trackId, title) {
    await applyPatch({ tracks: [{ id: trackId, title }] });
  }

  async function handleAddComment(trackId, time) {
    if (!newComment.trim()) return;
    await applyPatch({
      addComment: { id: nanoid(10), trackId, time, text: newComment.trim(), author: nickname },
    });
    setNewComment('');
  }

  async function handleDeleteComment(commentId) {
    await applyPatch({ deleteCommentId: commentId });
  }

  if (error) {
    return <div className="empty-state">{error}</div>;
  }

  if (!data) {
    return <p style={{ color: 'var(--color-ink-soft)' }}>読み込み中...</p>;
  }

  const tracks = [...data.tracks].sort((a, b) => a.order - b.order);
  const selectedTrack = tracks.find((t) => t.id === selectedTrackId) || null;
  const selectedComments = selectedTrack
    ? data.comments.filter((c) => c.trackId === selectedTrack.id).sort((a, b) => a.time - b.time)
    : [];

  return (
    <div>
      <div className="top-bar">
        <h1>{data.session.memo || data.session.date}</h1>
      </div>
      <p style={{ fontSize: 12, color: 'var(--color-ink-soft)', marginTop: -8 }}>
        {data.band?.name} ・ {data.session.date} ・ {canEdit ? '閲覧・編集可' : '閲覧のみ'}
      </p>

      {!selectedTrack && (
        <div className="card" style={{ marginTop: 12 }}>
          {tracks.map((t) => (
            <button
              key={t.id}
              className="track-row"
              style={{ width: '100%', border: 'none', background: 'none', textAlign: 'left' }}
              onClick={() => setSelectedTrackId(t.id)}
            >
              <div>
                <div className="track-row-title">{t.title}</div>
                <div className="track-row-meta">
                  {data.comments.filter((c) => c.trackId === t.id).length}件のコメント
                </div>
              </div>
              <StarRating value={t.favorite} readOnly />
            </button>
          ))}
        </div>
      )}

      {selectedTrack && (
        <div style={{ marginTop: 12 }}>
          <button className="back-link" onClick={() => setSelectedTrackId(null)}>
            ← トラック一覧へ
          </button>

          {canEdit ? (
            <input
              className="field"
              style={{ fontSize: 16, fontWeight: 700, margin: '10px 0' }}
              defaultValue={selectedTrack.title}
              onBlur={(e) => handleTitleChange(selectedTrack.id, e.target.value)}
            />
          ) : (
            <h2 style={{ fontSize: 16, margin: '10px 0' }}>{selectedTrack.title}</h2>
          )}

          <StarRating
            value={selectedTrack.favorite}
            readOnly={!canEdit}
            onChange={(v) => handleFavorite(selectedTrack.id, v)}
          />

          <audio
            src={getSharedAudioUrl(shareId, selectedTrack.id)}
            controls
            style={{ width: '100%', marginTop: 10 }}
            id={`audio-${selectedTrack.id}`}
          />

          <div className="section-title">コメント</div>
          <CommentTimeline
            comments={selectedComments}
            onSeek={(time) => {
              const el = document.getElementById(`audio-${selectedTrack.id}`);
              if (el) {
                el.currentTime = time;
                el.play();
              }
            }}
            onDelete={canEdit ? handleDeleteComment : undefined}
            readOnly={!canEdit}
          />

          {canEdit && (
            <>
              <NicknameField onChange={setNickname} />
              <div className="link-row" style={{ marginTop: 10 }}>
                <input
                  className="field"
                  placeholder="コメントを追加(現在の再生位置)"
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                />
                <button
                  className="btn"
                  onClick={() => {
                    const el = document.getElementById(`audio-${selectedTrack.id}`);
                    handleAddComment(selectedTrack.id, el ? el.currentTime : 0);
                  }}
                >
                  追加
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
