// GET /api/r/:shareId/audio/:trackId -> R2から音声(MP3)を配信

export async function onRequestGet(context) {
  const { params, env } = context;
  const { shareId, trackId } = params;

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
