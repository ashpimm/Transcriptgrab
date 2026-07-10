-- Purge already-mined hooks whose title/hook text is non-Latin script
-- (Hindi etc. slipped through before the isMostlyLatin filter existed).
-- Run once in Neon SQL editor. Miner refills English hooks on next run.

DELETE FROM hooks
WHERE hook_verbatim ~ '[ऀ-ॿ]'   -- Devanagari
   OR video_title  ~ '[ऀ-ॿ]'
   OR hook_verbatim ~ '[一-鿿]'  -- CJK
   OR video_title  ~ '[一-鿿]'
   OR hook_verbatim ~ '[؀-ۿ]'   -- Arabic
   OR video_title  ~ '[؀-ۿ]'
   OR hook_verbatim ~ '[Ѐ-ӿ]'   -- Cyrillic
   OR video_title  ~ '[Ѐ-ӿ]';
