-- HOOKLAB SEED DATA - audience niches + curated starter hooks.
-- Run after migrate-hooklab.sql. Safe to re-run (ON CONFLICT DO NOTHING).
--
-- These are product-user content niches, not builder/indie-hacker niches.
-- A product's own profile should still derive a narrower niche when possible.

INSERT INTO niches (slug, name, keywords) VALUES
  ('fitness-weight-loss', 'Fitness & Weight Loss', '{"calorie deficit tips","how to lose weight fast","what i eat in a day","weight loss mistakes","macro tracking for beginners"}'),
  ('personal-finance', 'Personal Finance', '{"budgeting tips","save money fast","money mistakes","pay off debt","personal finance for beginners"}'),
  ('productivity-focus', 'Productivity & Focus', '{"productivity tips","stop procrastinating","deep work routine","focus hacks","time management tips"}'),
  ('dating-relationships', 'Dating & Relationships', '{"dating advice","relationship red flags","first date tips","healthy relationship advice","dating app profile tips"}'),
  ('mental-wellness', 'Mental Wellness', '{"anxiety coping skills","self care routine","therapy tips","stress relief techniques","mental health habits"}'),
  ('language-learning', 'Language Learning', '{"language learning tips","learn spanish fast","duolingo tips","study routine language","common language mistakes"}'),
  ('meal-planning', 'Meal Planning', '{"easy meal prep","healthy meal ideas","grocery haul budget","high protein meals","meal planning for beginners"}'),
  ('travel-planning', 'Travel Planning', '{"travel hacks","cheap flights tips","packing tips","travel itinerary","solo travel tips"}')
ON CONFLICT (slug) DO NOTHING;

-- Curated starter hooks (templates distilled from proven viral patterns).
-- curated=TRUE rows carry no live source link; the miner adds receipt-backed rows.
INSERT INTO hooks (niche_id, hook_template, hook_verbatim, topic, format, platform, video_url, video_title, views, followers, outlier_score, curated)
VALUES
  -- fitness & weight loss
  ((SELECT id FROM niches WHERE slug='fitness-weight-loss'), 'How my ___ went from ___ to ___ in ___', 'How my client went from 150 to 130 lbs in 8 weeks', 'transformation with proof', 'talking_head', 'youtube', 'curated://fitness-weight-loss/1', '', 0, 0, 0, TRUE),
  ((SELECT id FROM niches WHERE slug='fitness-weight-loss'), 'Stop doing ___. Do this instead.', 'Stop doing endless cardio. Do this instead.', 'common mistake correction', 'talking_head', 'youtube', 'curated://fitness-weight-loss/2', '', 0, 0, 0, TRUE),
  ((SELECT id FROM niches WHERE slug='fitness-weight-loss'), 'The exact ___ I''d follow if I had to ___ in ___ days', 'The exact plan I''d follow to lose 10 lbs in 60 days', 'step-by-step protocol', 'whiteboard', 'youtube', 'curated://fitness-weight-loss/3', '', 0, 0, 0, TRUE),
  ((SELECT id FROM niches WHERE slug='fitness-weight-loss'), '___ things I wish I knew before ___', '5 things I wish I knew before my first cut', 'lessons list', 'talking_head', 'youtube', 'curated://fitness-weight-loss/4', '', 0, 0, 0, TRUE),

  -- personal finance
  ((SELECT id FROM niches WHERE slug='personal-finance'), 'I wasted ___ on ___ so you don''t have to', 'I wasted $400 on budgeting mistakes so you don''t have to', 'costly mistake lesson', 'talking_head', 'youtube', 'curated://personal-finance/1', '', 0, 0, 0, TRUE),
  ((SELECT id FROM niches WHERE slug='personal-finance'), 'If you make ___, here''s exactly how I''d budget it', 'If you make $3,000 a month, here''s exactly how I''d budget it', 'budget breakdown', 'whiteboard', 'youtube', 'curated://personal-finance/2', '', 0, 0, 0, TRUE),
  ((SELECT id FROM niches WHERE slug='personal-finance'), 'The ___ mistake keeping you broke', 'The subscription mistake keeping you broke', 'money leak warning', 'talking_head', 'youtube', 'curated://personal-finance/3', '', 0, 0, 0, TRUE),
  ((SELECT id FROM niches WHERE slug='personal-finance'), 'I tried ___ for ___ days. Here''s what changed.', 'I tried cash stuffing for 30 days. Here''s what changed.', 'personal experiment', 'talking_head', 'youtube', 'curated://personal-finance/4', '', 0, 0, 0, TRUE),

  -- productivity & focus
  ((SELECT id FROM niches WHERE slug='productivity-focus'), 'I deleted ___ and finally got ___ back', 'I deleted TikTok and finally got my mornings back', 'behavior reset', 'talking_head', 'youtube', 'curated://productivity-focus/1', '', 0, 0, 0, TRUE),
  ((SELECT id FROM niches WHERE slug='productivity-focus'), 'The ___ rule that fixed my ___', 'The 10-minute rule that fixed my procrastination', 'simple rule', 'talking_head', 'youtube', 'curated://productivity-focus/2', '', 0, 0, 0, TRUE),
  ((SELECT id FROM niches WHERE slug='productivity-focus'), 'Your ___ isn''t the problem. This is.', 'Your to-do list isn''t the problem. This is.', 'diagnosis hook', 'whiteboard', 'youtube', 'curated://productivity-focus/3', '', 0, 0, 0, TRUE),
  ((SELECT id FROM niches WHERE slug='productivity-focus'), 'Do this before ___ and your day changes', 'Do this before checking your phone and your day changes', 'morning routine', 'talking_head', 'youtube', 'curated://productivity-focus/4', '', 0, 0, 0, TRUE),

  -- dating & relationships
  ((SELECT id FROM niches WHERE slug='dating-relationships'), 'If they do ___, pay attention', 'If they do this on the first date, pay attention', 'red flag advice', 'talking_head', 'youtube', 'curated://dating-relationships/1', '', 0, 0, 0, TRUE),
  ((SELECT id FROM niches WHERE slug='dating-relationships'), 'Stop saying ___ on ___', 'Stop saying this on dating apps', 'profile mistake', 'talking_head', 'youtube', 'curated://dating-relationships/2', '', 0, 0, 0, TRUE),
  ((SELECT id FROM niches WHERE slug='dating-relationships'), 'The ___ text that tells you everything', 'The follow-up text that tells you everything', 'communication cue', 'skit', 'youtube', 'curated://dating-relationships/3', '', 0, 0, 0, TRUE),
  ((SELECT id FROM niches WHERE slug='dating-relationships'), 'I wish I knew this before ___', 'I wish I knew this before my first real relationship', 'lesson learned', 'talking_head', 'youtube', 'curated://dating-relationships/4', '', 0, 0, 0, TRUE),

  -- mental wellness
  ((SELECT id FROM niches WHERE slug='mental-wellness'), 'Try this when your ___ won''t stop', 'Try this when your mind won''t stop racing', 'coping technique', 'talking_head', 'youtube', 'curated://mental-wellness/1', '', 0, 0, 0, TRUE),
  ((SELECT id FROM niches WHERE slug='mental-wellness'), 'I thought ___ was self-care. It wasn''t.', 'I thought cancelling everything was self-care. It wasn''t.', 'self-care reframe', 'talking_head', 'youtube', 'curated://mental-wellness/2', '', 0, 0, 0, TRUE),
  ((SELECT id FROM niches WHERE slug='mental-wellness'), 'The ___ habit that made my anxiety worse', 'The bedtime habit that made my anxiety worse', 'habit warning', 'talking_head', 'youtube', 'curated://mental-wellness/3', '', 0, 0, 0, TRUE),
  ((SELECT id FROM niches WHERE slug='mental-wellness'), 'Save this for the next time you feel ___', 'Save this for the next time you feel overwhelmed', 'saveable exercise', 'audio_broll', 'youtube', 'curated://mental-wellness/4', '', 0, 0, 0, TRUE),

  -- language learning
  ((SELECT id FROM niches WHERE slug='language-learning'), 'I studied ___ wrong for ___ years', 'I studied Spanish wrong for 3 years', 'learning mistake', 'talking_head', 'youtube', 'curated://language-learning/1', '', 0, 0, 0, TRUE),
  ((SELECT id FROM niches WHERE slug='language-learning'), 'Stop memorizing ___. Learn this instead.', 'Stop memorizing random words. Learn this instead.', 'study method', 'whiteboard', 'youtube', 'curated://language-learning/2', '', 0, 0, 0, TRUE),
  ((SELECT id FROM niches WHERE slug='language-learning'), 'The ___ trick native speakers actually use', 'The pronunciation trick native speakers actually use', 'practical fluency tip', 'talking_head', 'youtube', 'curated://language-learning/3', '', 0, 0, 0, TRUE),
  ((SELECT id FROM niches WHERE slug='language-learning'), 'Do this for ___ minutes a day', 'Do this for 10 minutes a day', 'daily practice routine', 'audio_broll', 'youtube', 'curated://language-learning/4', '', 0, 0, 0, TRUE),

  -- meal planning
  ((SELECT id FROM niches WHERE slug='meal-planning'), 'I made ___ meals for ___ dollars', 'I made 12 meals for 40 dollars', 'budget meal prep', 'talking_head', 'youtube', 'curated://meal-planning/1', '', 0, 0, 0, TRUE),
  ((SELECT id FROM niches WHERE slug='meal-planning'), 'Stop buying ___ before you meal prep', 'Stop buying groceries before you meal prep', 'planning mistake', 'talking_head', 'youtube', 'curated://meal-planning/2', '', 0, 0, 0, TRUE),
  ((SELECT id FROM niches WHERE slug='meal-planning'), 'The lazy ___ I make every week', 'The lazy high-protein dinner I make every week', 'repeatable meal', 'audio_broll', 'youtube', 'curated://meal-planning/3', '', 0, 0, 0, TRUE),
  ((SELECT id FROM niches WHERE slug='meal-planning'), 'Here''s how I turn ___ into ___', 'Here''s how I turn one grocery bag into five lunches', 'batching system', 'talking_head', 'youtube', 'curated://meal-planning/4', '', 0, 0, 0, TRUE),

  -- travel planning
  ((SELECT id FROM niches WHERE slug='travel-planning'), 'I booked ___ for ___ less with this one change', 'I booked the same trip for $300 less with this one change', 'travel savings', 'talking_head', 'youtube', 'curated://travel-planning/1', '', 0, 0, 0, TRUE),
  ((SELECT id FROM niches WHERE slug='travel-planning'), 'Don''t pack ___ until you check this', 'Don''t pack for Europe until you check this', 'packing checklist', 'talking_head', 'youtube', 'curated://travel-planning/2', '', 0, 0, 0, TRUE),
  ((SELECT id FROM niches WHERE slug='travel-planning'), 'The ___ mistake that ruins your first day', 'The flight mistake that ruins your first day', 'trip planning warning', 'talking_head', 'youtube', 'curated://travel-planning/3', '', 0, 0, 0, TRUE),
  ((SELECT id FROM niches WHERE slug='travel-planning'), 'How I plan ___ without overplanning', 'How I plan a 7-day trip without overplanning', 'itinerary method', 'whiteboard', 'youtube', 'curated://travel-planning/4', '', 0, 0, 0, TRUE)
ON CONFLICT (video_url) DO NOTHING;
