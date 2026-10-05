// Netlify function (v2): GET /api/playlist?url=...
import { importPlaylist, PlaylistError } from '../../server/playlists.mjs';

export default async (req) => {
  try {
    const out = await importPlaylist(new URL(req.url).searchParams.get('url') ?? '');
    return Response.json(out, { headers: { 'Cache-Control': 'public, max-age=300' } });
  } catch (e) {
    const known = e instanceof PlaylistError;
    return Response.json({ error: known ? e.message : `Could not reach the site (${e.message}).` }, { status: known ? 400 : 502 });
  }
};

export const config = { path: '/api/playlist' };
