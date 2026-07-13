// POST /api/share
// ローカルのSession一式(メタデータ+圧縮済み音声)を受け取り、R2に保存して
// 共有ID・編集トークンを発行する。

function generateId(length) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = '';
  for (let i = 0; i < length; i++) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.BUCKET) {
    return new Response(
      JSON.stringify({ error: 'R2 bucket is not bound. Cloudflare Pages の Settings > Bindings で BUCKET を設定してください。' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const formData = await request.formData();
  const metaRaw = formData.get('meta');
  if (!metaRaw) {
    return new Response(JSON.stringify({ error: 'meta is required' }), { status: 400 });
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

  return new Response(
    JSON.stringify({
      shareId,
      editToken,
      viewUrl: `${origin}/r/${shareId}`,
      editUrl: `${origin}/r/${shareId}?token=${editToken}`,
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}
