// One physical Vercel Function serves all Autopilot worker aliases. Keeping the
// top-up/recovery schedules as rewrites preserves isolation without exceeding
// the Hobby plan's serverless-function limit.
import { handlePublish, handleTopup } from './_autopilot-runner.js';

export const maxDuration = 60;

export default function handler(req, res) {
  const mode = req.query?.mode || 'publish';
  const scheduledTrigger = req.query?.scheduledTrigger || 'primary';
  if (mode === 'topup') return handleTopup(req, res, scheduledTrigger);
  if (mode === 'publish') return handlePublish(req, res, scheduledTrigger);
  return res.status(400).json({ error: 'Unknown Autopilot worker mode.' });
}
