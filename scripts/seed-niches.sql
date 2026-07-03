-- HOOKLAB SEED DATA — launch niches + curated starter hooks.
-- Run after migrate-hooklab.sql. Safe to re-run (ON CONFLICT DO NOTHING).

INSERT INTO niches (slug, name, keywords) VALUES
  ('fitness',  'Fitness Trainers',        '{"how to lose fat","personal trainer tips","gym mistakes beginners","build muscle beginner"}'),
  ('realtors', 'Real Estate Agents',      '{"first time home buyer tips","realtor tips","sell your house fast","real estate mistakes"}'),
  ('coaches',  'Coaches & Consultants',   '{"get coaching clients","online coaching business","high ticket offer","grow service business"}'),
  ('appdev',   'App Developers & SaaS',   '{"how I built my app","indie hacker","app marketing","saas growth strategy"}')
ON CONFLICT (slug) DO NOTHING;

-- Curated starter hooks (templates distilled from proven viral patterns).
-- curated=TRUE rows carry no live source link; the miner adds receipt-backed rows.
INSERT INTO hooks (niche_id, hook_template, hook_verbatim, topic, format, platform, video_url, video_title, views, followers, outlier_score, curated)
VALUES
  -- fitness
  ((SELECT id FROM niches WHERE slug='fitness'), 'How my client went from ___ to ___ in ___ (with photos)', 'How my client went from 150 to 130 lbs in 8 weeks', 'client transformation with proof', 'talking_head', 'youtube', 'curated://fitness/1', '', 0, 0, 0, TRUE),
  ((SELECT id FROM niches WHERE slug='fitness'), 'Not to flex, but I''m really good at ___. Here''s the exact process.', 'Not to flex, but I''m really good at fat loss coaching', 'authority hook with step-by-step value', 'talking_head', 'youtube', 'curated://fitness/2', '', 0, 0, 0, TRUE),
  ((SELECT id FROM niches WHERE slug='fitness'), 'Stop doing ___. Do this instead.', 'Stop doing endless cardio. Do this instead.', 'common mistake correction', 'talking_head', 'youtube', 'curated://fitness/3', '', 0, 0, 0, TRUE),
  ((SELECT id FROM niches WHERE slug='fitness'), 'The exact ___ I''d follow if I had to ___ in ___ days', 'The exact plan I''d follow to lose 10 lbs in 60 days', 'step-by-step protocol', 'whiteboard', 'youtube', 'curated://fitness/4', '', 0, 0, 0, TRUE),
  ((SELECT id FROM niches WHERE slug='fitness'), '___ things I wish I knew before ___', '5 things I wish I knew before my first cut', 'lessons list', 'talking_head', 'youtube', 'curated://fitness/5', '', 0, 0, 0, TRUE),
  -- realtors
  ((SELECT id FROM niches WHERE slug='realtors'), 'How much ___ actually costs in ___ (real numbers)', 'How much buying a house actually costs in Austin', 'transparent cost breakdown', 'talking_head', 'youtube', 'curated://realtors/1', '', 0, 0, 0, TRUE),
  ((SELECT id FROM niches WHERE slug='realtors'), '___ vs ___: which makes you more money?', 'Renting vs buying: which makes you more money?', 'comparison breakdown', 'whiteboard', 'youtube', 'curated://realtors/2', '', 0, 0, 0, TRUE),
  ((SELECT id FROM niches WHERE slug='realtors'), 'The ___ mistake that costs sellers ___', 'The pricing mistake that costs sellers $20k', 'costly mistake warning', 'talking_head', 'youtube', 'curated://realtors/3', '', 0, 0, 0, TRUE),
  ((SELECT id FROM niches WHERE slug='realtors'), 'I''ve sold ___ homes. Here''s what actually sells a house.', 'I''ve sold 300 homes. Here''s what actually sells a house.', 'experience-backed insight', 'talking_head', 'youtube', 'curated://realtors/4', '', 0, 0, 0, TRUE),
  ((SELECT id FROM niches WHERE slug='realtors'), 'Watch me ___ in real time', 'Watch me negotiate $15k off in real time', 'process demonstration', 'other', 'youtube', 'curated://realtors/5', '', 0, 0, 0, TRUE),
  -- coaches
  ((SELECT id FROM niches WHERE slug='coaches'), 'How I get ___ without ___', 'How I get coaching clients without paid ads', 'counter-intuitive method', 'talking_head', 'youtube', 'curated://coaches/1', '', 0, 0, 0, TRUE),
  ((SELECT id FROM niches WHERE slug='coaches'), 'My client paid ___ and made ___ back. Here''s what we did.', 'My client paid $3k and made $40k back', 'ROI case study', 'talking_head', 'youtube', 'curated://coaches/2', '', 0, 0, 0, TRUE),
  ((SELECT id FROM niches WHERE slug='coaches'), 'If I had to start over with ___ followers, here''s exactly what I''d do', 'If I had to start over with 0 followers', 'start-from-zero playbook', 'talking_head', 'youtube', 'curated://coaches/3', '', 0, 0, 0, TRUE),
  ((SELECT id FROM niches WHERE slug='coaches'), 'The ___ script I use to ___ (steal it)', 'The DM script I use to book calls', 'copy-paste asset', 'talking_head', 'youtube', 'curated://coaches/4', '', 0, 0, 0, TRUE),
  ((SELECT id FROM niches WHERE slug='coaches'), 'Why ___ isn''t working for you', 'Why your content isn''t getting you clients', 'diagnosis hook', 'talking_head', 'youtube', 'curated://coaches/5', '', 0, 0, 0, TRUE),
  -- appdev
  ((SELECT id FROM niches WHERE slug='appdev'), 'I built ___ in ___ days. Here''s the revenue.', 'I built this app in 30 days. Here''s the revenue.', 'build-in-public results', 'talking_head', 'youtube', 'curated://appdev/1', '', 0, 0, 0, TRUE),
  ((SELECT id FROM niches WHERE slug='appdev'), 'How ___ makes money (it''s not what you think)', 'How Duolingo makes money', 'business model breakdown', 'audio_broll', 'youtube', 'curated://appdev/2', '', 0, 0, 0, TRUE),
  ((SELECT id FROM niches WHERE slug='appdev'), 'This ___ feature took me ___ to build and nobody used it', 'This feature took me 3 months and nobody used it', 'vulnerable lesson', 'talking_head', 'youtube', 'curated://appdev/3', '', 0, 0, 0, TRUE),
  ((SELECT id FROM niches WHERE slug='appdev'), '___ vs ___: how much do the owners actually make?', 'App Store vs Play Store: how much developers make', 'comparison with real numbers', 'whiteboard', 'youtube', 'curated://appdev/4', '', 0, 0, 0, TRUE),
  ((SELECT id FROM niches WHERE slug='appdev'), 'The exact stack I''d use to build ___ today', 'The exact stack I''d use to build a SaaS today', 'tactical stack breakdown', 'talking_head', 'youtube', 'curated://appdev/5', '', 0, 0, 0, TRUE)
ON CONFLICT (video_url) DO NOTHING;
