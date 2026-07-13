// GET  /api/r/:shareId       -> 共有Sessionのメタデータ取得(閲覧・編集共通)
// PUT  /api/r/:shareId?token= -> コメント追加・お気に入り変更・タイトル編集(要トークン一致)

function toPublicRecord(record, shareId) {
  // editToken・R2の内部キーはクライアントに絶対返さない
  const { editToken, audioKeys, ...publicRecord } = record;
  publicRecord.tracks = (record.tracks || []).map((t) => ({
    ...t,
    audioUrl: `/api/r/${shareId}/audio/${t.id}`,
  }));
  return publicRecord;
}

function applyPatch(record, patch) {
  const updated = { ...record };

  if (patch.session && typeof patch.session.memo === 'string') {
    updated.session = { ...updated.session, memo: patch.session.memo };
  }

  if (Array.isArray(patch.tracks)) {
    const trackPatches = new Map(patch.tracks.map((t) => [t.id, t]));
    updated.tracks = (updated.tracks || []).map((t) => {
      const p = trackPatches.get(t.id);
      if (!p) return t;
      return {
        ...t,
        title: typeof p.title === 'string' ? p.title : t.title,
        favorite: typeof p.favorite === 'number' ? p.favorite : t.favorite,
        memo: typeof p.memo === 'string' ? p.memo : t.memo,
      };
    });
  }

  if (patch.addComment) {
    const c = patch.addComment;
    updated.comments = [
      ...(updated.comments || []),
      {
        id: c.id,
        trackId: c.trackId,
        time: c.time,
        text: c.text,
        createdAt: new Date().toISOString(),
      },
    ];
  }

  if (patch.deleteCommentId) {
    updated.comments = (updated.comments || []).filter((c) => c.id !== patch.deleteCommentId);
  }

  return updated;
}

export async function onRequestGet(context) {
  const { params, env } = context;
  const shareId = params.shareId;

  const obj = await env.BUCKET.get(`shares/${shareId}/meta.json`);
  if (!obj) {
    return new Response(JSON.stringify({ error: 'not-found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const record = await obj.json();
  return new Response(JSON.stringify(toPublicRecord(record, shareId)), {
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPut(context) {
  const { params, env, request } = context;
  const shareId = params.shareId;
  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  const obj = await env.BUCKET.get(`shares/${shareId}/meta.json`);
  if (!obj) {
    return new Response(JSON.stringify({ error: 'not-found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const record = await obj.json();

  if (!token || token !== record.editToken) {
    return new Response(JSON.stringify({ error: 'forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const patch = await request.json();
  const updated = applyPatch(record, patch);
  updated.updatedAt = new Date().toISOString();

  await env.BUCKET.put(`shares/${shareId}/meta.json`, JSON.stringify(updated), {
    httpMetadata: { contentType: 'application/json' },
  });

  return new Response(JSON.stringify(toPublicRecord(updated, shareId)), {
    headers: { 'Content-Type': 'application/json' },
  });
}
