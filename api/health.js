// Public, non-sensitive health probe suitable for an uptime monitor. It
// exposes timestamps and worker state only: never user ids, post counts, or
// provider errors.
//
// ?admin=1 + owner auth (Google session allowlist or ADMIN_SECRET bearer)
// returns the full owner dashboard payload instead. Unauthenticated ?admin=1
// gets the plain public probe — no 401 oracle that reveals the admin door.
import { getLatestAutopilotRuns } from './_db.js';
import { publicAutopilotHealth } from './_autopilot-health.js';
import { isAdminRequest, buildAdminPayload } from './_admin.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Cache-Control', 'no-store');

  if (req.query?.admin === '1' && await isAdminRequest(req)) {
    try {
      return res.status(200).json(await buildAdminPayload());
    } catch (error) {
      console.error(JSON.stringify({ service: 'health', event: 'admin_payload_failed', message: String(error?.message || error).substring(0, 300) }));
      return res.status(500).json({ ok: false, admin: true, error: 'dashboard unavailable' });
    }
  }

  try {
    const autopilot = publicAutopilotHealth(await getLatestAutopilotRuns());
    return res.status(autopilot.ok ? 200 : 503).json({ ok: autopilot.ok, autopilot });
  } catch (error) {
    console.error(JSON.stringify({ service: 'health', event: 'health_check_failed', message: String(error?.message || error).substring(0, 300) }));
    return res.status(503).json({ ok: false, autopilot: { ok: false, reason: 'not_initialized_or_unavailable' } });
  }
}
