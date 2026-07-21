// Public, non-sensitive health probe suitable for an uptime monitor. It
// exposes timestamps and worker state only: never user ids, post counts, or
// provider errors.
import { getLatestAutopilotRuns } from './_db.js';
import { publicAutopilotHealth } from './_autopilot-health.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Cache-Control', 'no-store');
  try {
    const autopilot = publicAutopilotHealth(await getLatestAutopilotRuns());
    return res.status(autopilot.ok ? 200 : 503).json({ ok: autopilot.ok, autopilot });
  } catch (error) {
    console.error(JSON.stringify({ service: 'health', event: 'health_check_failed', message: String(error?.message || error).substring(0, 300) }));
    return res.status(503).json({ ok: false, autopilot: { ok: false, reason: 'not_initialized_or_unavailable' } });
  }
}
