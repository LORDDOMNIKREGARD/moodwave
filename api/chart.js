// Vercel serverless function: GET /api/chart?country=us
import { appleChart } from '../server/charts.mjs';

export default async function handler(req, res) {
  try {
    const out = await appleChart(String(req.query?.country ?? 'us'));
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1200');
    res.status(200).json(out);
  } catch (e) {
    res.status(/country/.test(e.message) ? 400 : 502).json({ error: `Could not load the chart (${e.message}).` });
  }
}
