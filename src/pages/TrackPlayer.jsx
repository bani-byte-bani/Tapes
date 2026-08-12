import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  getTrack,
  getTrackAudio,
  updateTrack,
  listComments,
  addComment,
  deleteComment,
  getSession,
} from '../repository/localRepository.js';
import { syncToShare, isSyncable } from '../repository/shareSync.js';
import { decodeAudioFile, drawWaveform, formatTime } from '../audio/audioAnalysis.js';
import StarRating from '../components/StarRating.jsx';
import CommentTimeline from '../components/CommentTimeline.jsx';
import NicknameField from '../components/NicknameField.jsx';
import SyncStatus from '../components/SyncStatus.jsx';

export default function TrackPlayer() {
  const { sessionId, trackId } = useParams();
  const [track, setTrack] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [titleDraft, setTitleDraft] = useState('');
  const [currentTime, setCurrentTime] = useState(0);
  const [nickname, setNicknameState] = useState('');
  const [session, setSession] = useState(null);
  const [syncState, setSyncState] = useState('idle'); // idle | syncing | done | error
  const audioRef = useRef(null);
  const canvasRef = useRef(null);

  async function loadComments() {
    setComments(await listComments(trackId));
  }

  useEffect(() => {
    (async () => {
      const t = await getTrack(trackId);
      setTrack(t);
      setSession(await getSession(sessionId));
      setTitleDraft(t ? t.title : '');
      const blob = await getTrackAudio(trackId);
      if (blob) {
        setAudioUrl(URL.createObjectURL(blob));
        try {
          const buffer = await decodeAudioFile(blob);
          if (canvasRef.current) drawWaveform(canvasRef.current, buffer);
        } catch (err) {
          console.error('波形の描画に失敗しました', err);
        }
      }
      await loadComments();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId]);

  // 共有済みSessionなら、ローカルの変更をR2にも反映する(後勝ち)
  async function pushToShare(patch) {
    if (!isSyncable(session)) return;
    setSyncState('syncing');
    const ok = await syncToShare(session, patch);
    setSyncState(ok ? 'done' : 'error');
  }

  async function handleFavorite(value) {
    const updated = await updateTrack(trackId, { favorite: value });
    setTrack(updated);
    await pushToShare({ tracks: [{ id: trackId, favorite: value }] });
  }

  async function handleTitleBlur() {
    if (track && titleDraft !== track.title && titleDraft.trim()) {
      const title = titleDraft.trim();
      const updated = await updateTrack(trackId, { title });
      setTrack(updated);
      await pushToShare({ tracks: [{ id: trackId, title }] });
    }
  }

  function seekTo(time) {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      audioRef.current.play();
    }
  }

  async function handleAddComment() {
    if (!newComment.trim()) return;
    const created = await addComment({ trackId, time: currentTime, text: newComment.trim(), author: nickname });
    setNewComment('');
    await loadComments();
    // ローカルと同じIDで送るので、共有側と対応が取れる
    await pushToShare({
      addComment: {
        id: created.id,
        trackId: created.trackId,
        time: created.time,
        text: created.text,
        author: created.author,
      },
    });
  }

  async function handleDeleteComment(commentId) {
    await deleteComment(commentId);
    await loadComments();
    await pushToShare({ deleteCommentId: commentId });
  }

  if (!track) {
    return <p style={{ color: 'var(--color-ink-soft)' }}>読み込み中...</p>;
  }

  return (
    <div>
      <div className="top-bar">
        <Link to={`/session/${sessionId}`} className="back-link">
          ← 戻る
        </Link>
      </div>

      <input
        className="field"
        style={{ fontSize: 17, fontWeight: 700, marginBottom: 10 }}
        value={titleDraft}
        onChange={(e) => setTitleDraft(e.target.value)}
        onBlur={handleTitleBlur}
      />

      <StarRating value={track.favorite} onChange={handleFavorite} />
      <SyncStatus state={syncState} />

      <canvas ref={canvasRef} className="waveform" style={{ marginTop: 12 }} />

      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          controls
          style={{ width: '100%', marginTop: 10 }}
          onTimeUpdate={(e) => setCurrentTime(e.target.currentTime)}
        />
      )}

      <div className="section-title">コメント</div>
      <NicknameField onChange={setNicknameState} />
      <CommentTimeline comments={comments} onSeek={seekTo} onDelete={handleDeleteComment} />

      <div className="link-row" style={{ marginTop: 10 }}>
        <input
          className="field"
          placeholder="今の再生位置にコメントを追加"
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAddComment()}
        />
        <button className="btn" onClick={handleAddComment}>
          追加
        </button>
      </div>
      <p style={{ fontSize: 11, color: 'var(--color-ink-soft)', marginTop: 4 }}>
        現在の再生位置({formatTime(currentTime)})にコメントが付きます
      </p>
    </div>
  );
}
