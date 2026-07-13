import { useState } from 'react';
import { convertWavBlobToMp3Blob } from '../audio/mp3Encoder.js';
import { createShare } from '../repository/remoteRepository.js';
import { getTrackAudio, markSessionShared, getOrCreateDefaultBand } from '../repository/localRepository.js';

const alreadyShared = (session) => session.syncStatus === 'shared' && session.shareId;

export default function ShareModal({ session, tracks, comments, onClose, onShared }) {
  const initiallyShared = alreadyShared(session);
  const [status, setStatus] = useState(initiallyShared ? 'done' : 'idle'); // idle | working | done | error
  const [progress, setProgress] = useState('');
  const [links, setLinks] = useState(
    initiallyShared
      ? {
          shareId: session.shareId,
          editToken: session.shareEditToken,
          viewUrl: `${window.location.origin}/r/${session.shareId}`,
          editUrl: `${window.location.origin}/r/${session.shareId}?token=${session.shareEditToken}`,
        }
      : null
  );

  async function handleShare() {
    setStatus('working');
    try {
      const band = await getOrCreateDefaultBand();
      const audioBlobs = {};
      for (let i = 0; i < tracks.length; i++) {
        const track = tracks[i];
        setProgress(`音声を圧縮しています... (${i + 1}/${tracks.length})`);
        const wavBlob = await getTrackAudio(track.id);
        if (wavBlob) {
          audioBlobs[track.id] = await convertWavBlobToMp3Blob(wavBlob);
        }
      }
      setProgress('アップロード中...');
      const result = await createShare({ band, session, tracks, comments, audioBlobs });
      await markSessionShared(session.id, {
        shareId: result.shareId,
        shareEditToken: result.editToken,
      });
      setLinks(result);
      setStatus('done');
      onShared && onShared(result);
    } catch (err) {
      console.error(err);
      setStatus('error');
    }
  }

  function copy(text) {
    navigator.clipboard?.writeText(text);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>このセッションを共有</h2>

        {status === 'idle' && (
          <>
            <p style={{ fontSize: 13, color: 'var(--color-ink-soft)' }}>
              音声を圧縮してアップロードします。リンクを知っている人だけが見られます。
            </p>
            <button className="btn btn-block" onClick={handleShare}>
              共有リンクを作成
            </button>
          </>
        )}

        {status === 'working' && <p style={{ fontSize: 13 }}>{progress}</p>}

        {status === 'error' && (
          <>
            <p style={{ fontSize: 13, color: 'var(--color-danger)' }}>
              共有に失敗しました。もう一度お試しください。
            </p>
            <button className="btn btn-block" onClick={handleShare}>
              再試行
            </button>
          </>
        )}

        {status === 'done' && links && (
          <>
            <div className="section-title" style={{ margin: '12px 0 4px' }}>
              閲覧用リンク
            </div>
            <div className="link-row">
              <input className="field" readOnly value={links.viewUrl} />
              <button className="btn btn-secondary" onClick={() => copy(links.viewUrl)}>
                コピー
              </button>
            </div>

            <div className="section-title" style={{ margin: '16px 0 4px' }}>
              編集用リンク(メンバーだけに共有してください)
            </div>
            <div className="link-row">
              <input className="field" readOnly value={links.editUrl} />
              <button className="btn btn-secondary" onClick={() => copy(links.editUrl)}>
                コピー
              </button>
            </div>

            <p style={{ fontSize: 11, color: 'var(--color-ink-soft)', marginTop: 14 }}>
              「更新をアップロード」を押すと、この端末の最新のタイトル・お気に入り・コメントで上書きされます(共有相手が追加した内容は上書きされる場合があります)。
            </p>
            <button className="btn btn-secondary btn-block" style={{ marginTop: 8 }} onClick={handleShare}>
              更新をアップロード
            </button>
            <button className="btn btn-block" style={{ marginTop: 8 }} onClick={onClose}>
              閉じる
            </button>
          </>
        )}

        {status !== 'done' && (
          <button className="btn btn-secondary btn-block" style={{ marginTop: 12 }} onClick={onClose}>
            キャンセル
          </button>
        )}
      </div>
    </div>
  );
}
