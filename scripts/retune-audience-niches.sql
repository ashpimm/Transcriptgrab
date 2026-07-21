-- Retune Hooklab away from builder/indie-hacker seed niches and toward
-- the product's buyer/audience niche.
--
-- Run once in Neon after deploy. It does not delete hooks or carousels;
-- it deactivates legacy default niches so they no longer appear in the feed,
-- miner rotation, or generation pools.

UPDATE niches
SET active = FALSE
WHERE slug IN ('appdev');

UPDATE niches
SET active = FALSE
WHERE slug IN ('realtors', 'coaches');

INSERT INTO niches (slug, name, keywords) VALUES
  ('fitness-weight-loss', 'Fitness & Weight Loss', '{"calorie deficit tips","how to lose weight fast","what i eat in a day","weight loss mistakes","macro tracking for beginners"}'),
  ('personal-finance', 'Personal Finance', '{"budgeting tips","save money fast","money mistakes","pay off debt","personal finance for beginners"}'),
  ('productivity-focus', 'Productivity & Focus', '{"productivity tips","stop procrastinating","deep work routine","focus hacks","time management tips"}'),
  ('dating-relationships', 'Dating & Relationships', '{"dating advice","relationship red flags","first date tips","healthy relationship advice","dating app profile tips"}'),
  ('mental-wellness', 'Mental Wellness', '{"anxiety coping skills","self care routine","therapy tips","stress relief techniques","mental health habits"}'),
  ('language-learning', 'Language Learning', '{"language learning tips","learn spanish fast","duolingo tips","study routine language","common language mistakes"}'),
  ('meal-planning', 'Meal Planning', '{"easy meal prep","healthy meal ideas","grocery haul budget","high protein meals","meal planning for beginners"}'),
  ('travel-planning', 'Travel Planning', '{"travel hacks","cheap flights tips","packing tips","travel itinerary","solo travel tips"}')
ON CONFLICT (slug) DO UPDATE SET
  active = TRUE,
  name = EXCLUDED.name,
  keywords = EXCLUDED.keywords;

UPDATE hooks
SET niche_id = (SELECT id FROM niches WHERE slug = 'fitness-weight-loss')
WHERE niche_id = (SELECT id FROM niches WHERE slug = 'fitness');

UPDATE niches
SET active = FALSE
WHERE slug = 'fitness';

INSERT INTO hooks (niche_id, hook_template, hook_verbatim, topic, format, platform, video_url, video_title, views, followers, outlier_score, curated)
VALUES
  ((SELECT id FROM niches WHERE slug='fitness-weight-loss'), 'Stop doing ___. Do this instead.', 'Stop doing endless cardio. Do this instead.', 'common mistake correction', 'talking_head', 'youtube', 'curated://fitness-weight-loss/2', '', 0, 0, 0, TRUE),
  ((SELECT id FROM niches WHERE slug='personal-finance'), 'If you make ___, here''s exactly how I''d budget it', 'If you make $3,000 a month, here''s exactly how I''d budget it', 'budget breakdown', 'whiteboard', 'youtube', 'curated://personal-finance/2', '', 0, 0, 0, TRUE),
  ((SELECT id FROM niches WHERE slug='productivity-focus'), 'I deleted ___ and finally got ___ back', 'I deleted TikTok and finally got my mornings back', 'behavior reset', 'talking_head', 'youtube', 'curated://productivity-focus/1', '', 0, 0, 0, TRUE),
  ((SELECT id FROM niches WHERE slug='dating-relationships'), 'If they do ___, pay attention', 'If they do this on the first date, pay attention', 'red flag advice', 'talking_head', 'youtube', 'curated://dating-relationships/1', '', 0, 0, 0, TRUE),
  ((SELECT id FROM niches WHERE slug='mental-wellness'), 'Try this when your ___ won''t stop', 'Try this when your mind won''t stop racing', 'coping technique', 'talking_head', 'youtube', 'curated://mental-wellness/1', '', 0, 0, 0, TRUE),
  ((SELECT id FROM niches WHERE slug='language-learning'), 'I studied ___ wrong for ___ years', 'I studied Spanish wrong for 3 years', 'learning mistake', 'talking_head', 'youtube', 'curated://language-learning/1', '', 0, 0, 0, TRUE),
  ((SELECT id FROM niches WHERE slug='meal-planning'), 'I made ___ meals for ___ dollars', 'I made 12 meals for 40 dollars', 'budget meal prep', 'talking_head', 'youtube', 'curated://meal-planning/1', '', 0, 0, 0, TRUE),
  ((SELECT id FROM niches WHERE slug='travel-planning'), 'I booked ___ for ___ less with this one change', 'I booked the same trip for $300 less with this one change', 'travel savings', 'talking_head', 'youtube', 'curated://travel-planning/1', '', 0, 0, 0, TRUE)
ON CONFLICT (video_url) DO NOTHING;
