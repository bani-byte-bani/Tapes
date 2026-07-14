import { formatTime } from '../audio/audioAnalysis.js';

export default function CommentTimeline({ comments, onSeek, onDelete, readOnly = false }) {
  if (!comments || comments.length === 0) {
    return <p style={{ fontSize: 13, color: 'var(--color-ink-soft)' }}>まだコメントはありません</p>;
  }
  return (
    <div>
      {comments.map((c) => (
        <div className="comment-item" key={c.id}>
          <button className="comment-time" onClick={() => onSeek && onSeek(c.time)}>
            {formatTime(c.time)}
          </button>
          <div className="comment-text" style={{ flex: 1 }}>
            {c.author && <span className="comment-author">{c.author}</span>}
            {c.text}
          </div>
          {!readOnly && onDelete && (
            <button
              className="btn btn-secondary"
              style={{ padding: '2px 8px', fontSize: 12 }}
              onClick={() => onDelete(c.id)}
            >
              削除
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
