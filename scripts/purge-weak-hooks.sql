-- purge-weak-hooks.sql — one-time cleanup after the miner quality overhaul
-- (transcript gate + outlier floors). Deletes mined hooks that would no longer
-- qualify: micro-account noise with no real reach. Curated patterns are kept.
--
-- Run in Neon SQL editor. Safe to re-run.

DELETE FROM hooks
WHERE curated = FALSE
  AND (views < 10000 OR followers < 50);

-- Optional: also clear mined hooks so the next cron re-mines everything fresh
-- under the new rules (transcript-verified, 120-day window). Uncomment to use.
-- DELETE FROM hooks WHERE curated = FALSE;
-- UPDATE niches SET last_mined_at = NULL;
