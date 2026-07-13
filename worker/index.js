// Cloudflare Workers エントリーポイント。
// run_worker_first(wrangler.toml)により /api/* だけがここに届く。
// それ以外のパス(画面のURLなど)は Workers Static Assets が自動的に処理する
// (not_found_handling: "single-page-application" によりSPAのフォールバックも自動)。

function jsonResponse(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
}

function generateId(length) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = '';
  for (let i = 0; i < length; i++) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

function toPublicRecord(record, shareId) {
  // editToken・R2内部キーはクライアントに絶対返さない
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
      { id: c.id, trackId: c.trackId, time: c.time, text: c.text, createdAt: new Date().toISOString() },
    ];
  }

  if (patch.deleteCommentId) {
    updated.comments = (updated.comments || []).filter((c) => c.id !== patch.deleteCommentId);
  }

  return updated;
}

async function handleShare(request, env) {
  if (!env.BUCKET) {
    return jsonResponse(
      { error: 'R2 bucket is not bound. wrangler.toml の [[r2_buckets]] 設定と、Cloudflare上のバケット作成を確認してください。' },
      { status: 500 }
    );
  }

  const formData = await request.formData();
  const metaRaw = formData.get('meta');
  if (!metaRaw) {
    return jsonResponse({ error: 'meta is required' }, { status: 400 });
  }
  const meta = JSON.parse(metaRaw);

  // 既に共有済みのSessionを「再共有(上書き更新)」する場合は、
  // 既存のshareId/editTokenを検証のうえ再利用する(リンクを変えないため)。
  const existingShareId = formData.get('existingShareId');
  const existingEditToken = formData.get('existingEditToken');
  let shareId = null;
  let editToken = null;

  if (existingShareId && existingEditToken) {
    const existingObj = await env.BUCKET.get(`shares/${existingShareId}/meta.json`);
    if (existingObj) {
      const existingRecord = await existingObj.json();
      if (existingRecord.editToken === existingEditToken) {
        shareId = existingShareId;
        editToken = existingEditToken;
      }
    }
  }

  if (!shareId) {
    shareId = generateId(10);
    editToken = generateId(32);
  }

  const audioKeys = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith('audio_') && value && typeof value.arrayBuffer === 'function') {
      const trackId = key.slice('audio_'.length);
      const objectKey = `shares/${shareId}/audio/${trackId}.mp3`;
      await env.BUCKET.put(objectKey, await value.arrayBuffer(), {
        httpMetadata: { contentType: 'audio/mpeg' },
      });
      audioKeys[trackId] = objectKey;
    }
  }

  const record = {
    ...meta,
    shareId,
    editToken,
    audioKeys,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await env.BUCKET.put(`shares/${shareId}/meta.json`, JSON.stringify(record), {
    httpMetadata: { contentType: 'application/json' },
  });

  const url = new URL(request.url);
  const origin = `${url.protocol}//${url.host}`;

  return jsonResponse({
    shareId,
    editToken,
    viewUrl: `${origin}/r/${shareId}`,
    editUrl: `${origin}/r/${shareId}?token=${editToken}`,
  });
}

async function handleGetShare(env, shareId) {
  const obj = await env.BUCKET.get(`shares/${shareId}/meta.json`);
  if (!obj) {
    return jsonResponse({ error: 'not-found' }, { status: 404 });
  }
  const record = await obj.json();
  return jsonResponse(toPublicRecord(record, shareId));
}

async function handlePutShare(request, env, shareId) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  const obj = await env.BUCKET.get(`shares/${shareId}/meta.json`);
  if (!obj) {
    return jsonResponse({ error: 'not-found' }, { status: 404 });
  }
  const record = await obj.json();

  if (!token || token !== record.editToken) {
    return jsonResponse({ error: 'forbidden' }, { status: 403 });
  }

  const patch = await request.json();
  const updated = applyPatch(record, patch);
  updated.updatedAt = new Date().toISOString();

  await env.BUCKET.put(`shares/${shareId}/meta.json`, JSON.stringify(updated), {
    httpMetadata: { contentType: 'application/json' },
  });

  return jsonResponse(toPublicRecord(updated, shareId));
}

async function handleGetAudio(env, shareId, trackId) {
  const obj = await env.BUCKET.get(`shares/${shareId}/audio/${trackId}.mp3`);
  if (!obj) {
    return new Response('Not found', { status: 404 });
  }
  return new Response(obj.body, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (path === '/api/share' && method === 'POST') {
      return handleShare(request, env);
    }

    const audioMatch = path.match(/^\/api\/r\/([^/]+)\/audio\/([^/]+)$/);
    if (audioMatch && method === 'GET') {
      return handleGetAudio(env, audioMatch[1], audioMatch[2]);
    }

    const shareMatch = path.match(/^\/api\/r\/([^/]+)$/);
    if (shareMatch) {
      if (method === 'GET') return handleGetShare(env, shareMatch[1]);
      if (method === 'PUT') return handlePutShare(request, env, shareMatch[1]);
    }

    return jsonResponse({ error: 'not-found' }, { status: 404 });
  },
};
