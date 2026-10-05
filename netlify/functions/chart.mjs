// Netlify function (v2): GET /api/chart?country=us
import { appleChart } from '../../server/charts.mjs';

export default async (req) => {
  try {
    return Response.json(await appleChart(new URL(req.url).searchParams.get('country') ?? 'us'), { headers: { 'Cache-Control': 'public, max-age=600' } });
  } catch (e) {
    return Response.json({ error: `Could not load the chart (${e.message}).` }, { status: /country/.test(e.message) ? 400 : 502 });
  }
};

export const config = { path: '/api/chart' };
