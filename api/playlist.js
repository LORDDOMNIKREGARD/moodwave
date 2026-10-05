// Vercel serverless function: GET /api/playlist?url=...  (same contract as server.mjs)
import { importPlaylist, PlaylistError } from '../server/playlists.mjs';

export default async function handler(req, res) {
  try {
    const out = await importPlaylist(String(req.query?.url ?? ''));
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json(out);
  } catch (e) {
    const known = e instanceof PlaylistError;
    res.status(known ? 400 : 502).json({ error: known ? e.message : `Could not reach the site (${e.message}).` });
  }
}
