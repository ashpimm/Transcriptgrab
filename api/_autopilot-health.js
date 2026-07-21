const MAX_AGE_MS = {
  publish: 30 * 60 * 60 * 1000,
  topup: 36 * 60 * 60 * 1000,
};
const RUNNING_GRACE_MS = 15 * 60 * 1000;

function oneRun(row, nowMs) {
  if (!row) return { state: 'unknown', ok: false, message: 'No completed run has been recorded yet.' };
  const timestamp = row.finished_at || row.started_at;
  const timestampMs = new Date(timestamp).getTime();
  const ageMs = Number.isFinite(timestampMs) ? Math.max(0, nowMs - timestampMs) : Infinity;
  const job = row.job || 'publish';

  let state = 'attention';
  let message = 'The last run failed. The recovery worker will retry automatically.';
  if (row.status === 'running' && ageMs <= RUNNING_GRACE_MS) {
    state = 'running';
    message = 'A worker is running now.';
  } else if (row.status === 'succeeded' && ageMs <= (MAX_AGE_MS[job] || MAX_AGE_MS.publish)) {
    state = 'healthy';
    message = 'The last worker run completed successfully.';
  } else if (row.status === 'succeeded') {
    state = 'stale';
    message = 'The scheduler has not checked in recently enough.';
  } else if (row.status === 'running') {
    state = 'stale';
    message = 'A worker appears to have been interrupted and will be recovered.';
  }

  return {
    state,
    ok: state === 'healthy' || state === 'running',
    message,
    status: row.status,
    trigger: row.trigger,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export function publicAutopilotHealth(rows = [], nowMs = Date.now()) {
  const byJob = Object.fromEntries(rows.map((row) => [row.job, row]));
  const publish = oneRun(byJob.publish, nowMs);
  const topup = oneRun(byJob.topup, nowMs);
  return { ok: publish.ok && topup.ok, publish, topup };
}
