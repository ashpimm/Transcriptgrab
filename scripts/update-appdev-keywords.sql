-- Retune appdev mining keywords toward indie hacker / build-in-public content.
-- The originals ("app marketing", "saas growth strategy") pulled loan-app spam
-- and Minecraft tutorials. Run once in Neon, then re-mine appdev.

UPDATE niches
SET keywords = '{"build in public","indie hacker app revenue","i built a saas","solo developer app launch"}'
WHERE slug = 'appdev';

-- Clear the junk already mined for appdev (curated:// rows survive;
-- swipe_file cascades, carousels.hook_id sets null — both safe).
DELETE FROM hooks
WHERE niche_id = (SELECT id FROM niches WHERE slug = 'appdev')
  AND video_url NOT LIKE 'curated://%';
