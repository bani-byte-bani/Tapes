// 共有されたSessionを扱うリポジトリ。
// データソースはIndexedDBではなく Cloudflare Pages Functions (/api/...) 経由のR2。

export async function fetchSharedSession(shareId) {
  const res = await fetch(`/api/r/${shareId}`);
  if (!res.ok) {
    throw new Error(res.status === 404 ? 'not-found' : 'fetch-failed');
  }
  return res.json();
}

export function getSharedAudioUrl(shareId, trackId) {
  return `/api/r/${shareId}/audio/${trackId}`;
}

export async function updateSharedSession(shareId, token, patch) {
  const res = await fetch(`/api/r/${shareId}?token=${encodeURIComponent(token)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    throw new Error(res.status === 403 ? 'forbidden' : 'update-failed');
  }
  return res.json();
}

/**
 * ローカルのSession/Track/Commentと、共有用に圧縮したMP3一式をアップロードし、
 * 共有ID・編集トークンを発行してもらう。
 */
export async function createShare({ band, session, tracks, comments, audioBlobs }) {
  const form = new FormData();
  form.append(
    'meta',
    JSON.stringify({
      band: { id: band.id, name: band.name },
      session: { id: session.id, date: session.date, memo: session.memo },
      tracks: tracks.map((t) => ({
        id: t.id,
        title: t.title,
        order: t.order,
        favorite: t.favorite,
        memo: t.memo,
      })),
      comments: comments.map((c) => ({ id: c.id, trackId: c.trackId, time: c.time, text: c.text, author: c.author || '' })),
    })
  );
  if (session.shareId && session.shareEditToken) {
    form.append('existingShareId', session.shareId);
    form.append('existingEditToken', session.shareEditToken);
  }

  for (const [trackId, blob] of Object.entries(audioBlobs)) {
    form.append(`audio_${trackId}`, blob, `${trackId}.mp3`);
  }

  const res = await fetch('/api/share', { method: 'POST', body: form });
  if (!res.ok) {
    throw new Error('share-failed');
  }
  return res.json(); // { shareId, viewUrl, editUrl }
}
