// Regenerate the landing page's demo carousel (demo/slide-1..6.jpg) by running
// the REAL production pipeline — same hook pool, copy prompt, image calls and
// renderer a paying customer gets. The demo on / is output, not a mockup, so it
// has to be re-run whenever the renderer or prompts change.
//
//   npx vercel env pull .env.gemini --environment=production --yes
//   node --env-file=.env.gemini scripts/gen-demo.mjs            # auto-pick hook
//   node --env-file=.env.gemini scripts/gen-demo.mjs --hook=84  # pin a hook
//   node --env-file=.env.gemini scripts/gen-demo.mjs --dry      # copy only, no image spend
//   rm .env.gemini                                              # it holds prod secrets
//
// Costs ~$0.08 per non-dry run (one hero photo + one background).
// Prints the caption/hashtags and the source hook's view count — paste both into
// index.html, they are claims the page makes.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { generateCarouselPlan, backgroundPrompt, heroPrompt, cleanMotifs } from '../api/_generate.js';
import { renderSlidePngs } from '../api/_render.js';
import { callGeminiImageRetry } from '../api/_shared.js';

// The app we dogfood on. Same shape as users.profile.
const PROFILE = {
  app_url: 'https://gainlock.app',
  name: 'GainLock',
  what: 'A gym app that locks the apps you waste time on until you log your workout for the day.',
  who: 'People who keep restarting the gym and quit by week three',
  benefit: 'You actually show up, because skipping costs you your feed',
  tone: 'casual',
  color: '#00E07A',
  audience_niche: { name: 'Fitness', slug: 'fitness' },
};
const STYLE = 'bold';       // '' = let it roll one at random, as a real generate does
const THUMB_W = 432;        // 2x the strip's max display width, 4:5
const THUMB_H = 540;
const JPEG_QUALITY = 82;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEMO_DIR = join(ROOT, 'demo');
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const hookId = arg('hook') ? Number(arg('hook')) : null;
const dry = process.argv.includes('--dry');

const plan = await generateCarouselPlan({ profile: PROFILE, kind: 'value', hookId, styleOverride: STYLE });
console.log(`hook #${plan.hook.id} (${Number(plan.hook.views || 0).toLocaleString()} views): ${plan.hook.hook_verbatim || plan.hook.hook_template}`);
console.log(`style ${plan.style} · accent ${plan.accent}`);
for (const s of plan.slides) console.log(`  [${s.index}] ${s.heading}${s.body ? ' — ' + s.body : ''}${s.cta ? ' | ' + s.cta : ''}`);
console.log(`\ncaption:\n${plan.caption}\n`);
if (dry) process.exit(0);

const heroP = heroPrompt(plan.heroScene, PROFILE, plan.accent);
const [bgBase64, heroBase64] = await Promise.all([
  callGeminiImageRetry(backgroundPrompt(plan.style, PROFILE, cleanMotifs(plan.motifs), plan.accent)),
  // A dead hero call costs a cover photo, not the run — same as production.
  heroP ? callGeminiImageRetry(heroP).catch((e) => { console.error('hero failed:', e.message); return null; }) : null,
]);

const pngs = await renderSlidePngs({
  slides: plan.slides, style: plan.style, accent: plan.accent,
  bgBase64, heroBase64, watermark: false,
});

mkdirSync(DEMO_DIR, { recursive: true });
for (const [i, png] of pngs.entries()) {
  const img = await loadImage(png);
  const canvas = createCanvas(THUMB_W, THUMB_H);
  canvas.getContext('2d').drawImage(img, 0, 0, THUMB_W, THUMB_H);
  const jpg = canvas.toBuffer('image/jpeg', JPEG_QUALITY);
  writeFileSync(join(DEMO_DIR, `slide-${i + 1}.jpg`), jpg);
  console.log(`demo/slide-${i + 1}.jpg  ${Math.round(jpg.length / 1024)}KB`);
}
console.log('\nNow update index.html: slide alt text, the caption block, and the score chip.');
