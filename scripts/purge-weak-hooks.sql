-- purge-weak-hooks.sql — one-time cleanup after the miner quality overhaul
-- Deletes mined hooks below the current absolute-reach floor. Curated patterns
-- are kept. This does not certify older rows against the new transcript gate.
--
-- Run in Neon SQL editor. Safe to re-run.

DELETE FROM hooks
WHERE curated = FALSE
  AND views < 250000;

-- Optional: also clear mined hooks so the next cron re-mines everything fresh
-- under the new rules (transcript-verified, 120-day window). Uncomment to use.
-- DELETE FROM hooks WHERE curated = FALSE;
-- UPDATE niches SET last_mined_at = NULL;
