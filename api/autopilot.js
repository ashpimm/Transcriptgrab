// api/autopilot.js — The product. Daily cron:
//   Phase 1 (top-up): every connected Autopilot subscriber keeps 3 days of
//     posts queued, 75/25 value/showcase rotation.
//   Phase 2 (publish): render due posts server-side and push to TikTok +
//     Instagram via upload-post. One retry, then failed + surfaced.
// GET /api/autopilot?secret=$ADMIN_SECRET (or Vercel cron)

import {
  getAutopilotUsers, countFuturePosts, countAllPosts, createPost,
  getDuePosts, setPostStatus, consumeCarousel, canGenerateCarousel, refreshUsage,
  saveCarousel, saveCarouselBg, saveCarouselHero,
} from './_db.js';
import {
  generateCarouselPlan, postKind, backgroundPrompt, heroPrompt, nextSlots, cleanMotifs,
} from './_generate.js';
import { renderSlidePngs } from './_render.js';
import { uploadPostEnabled, uploadPhotos, getLinkedPlatforms, effectivePlatforms } from './_uploadpost.js';
import { callGeminiImageRetry, cronAuthOk } from './_shared.js';

export const maxDuration = 60;

const QUEUE_DAYS = 3;
const MAX_PUBLISH_PER_RUN = 5;
const MAX_TOPUP_USERS_PER_RUN = 6;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!cronAuthOk(req)) return res.status(401).json({ error: 'Unauthorized' });

  const errors = [];
  let toppedUp = 0, posted = 0, failed = 0;

  // ===== Phase 1: publish due posts (the paid deliverable — must run first =====
  // so it isn't starved of the maxDuration=60 budget by top-up Gemini calls) =====
  if (uploadPostEnabled()) {
    const due = await getDuePosts(MAX_PUBLISH_PER_RUN).catch((e) => { errors.push(`due: ${e.message}`); return []; });
    const linkedCache = new Map(); // username -> platforms[] | null, one lookup per user per run
    for (const post of due) {
      try {
        if (post.tier !== 'pro' || !post.upload_post_username) {
          await setPostStatus(post.id, 'skipped', { error: 'subscription inactive or account disconnected' });
          continue;
        }
        // Never ask upload-post to publish to a platform the customer hasn't
        // linked — one unlinked platform would fail the whole upload call.
        if (!linkedCache.has(post.upload_post_username)) {
          linkedCache.set(post.upload_post_username,
            await getLinkedPlatforms(post.upload_post_username).catch((err) => {
              console.error('linked-platforms lookup failed:', err.message);
              return null; // unknown -> publish with the requested list as before
            }));
        }
        const platforms = effectivePlatforms(post.platforms || ['tiktok', 'instagram'], linkedCache.get(post.upload_post_username));
        if (!platforms.length) {
          await setPostStatus(post.id, 'skipped', { error: 'no linked social accounts for this post — connect one in Account' });
          continue;
        }
        // Hook slide gets a photograph of its subject; the rest share the
        // abstract background. Both retry — this subscriber never sees the post
        // before it goes live and cannot re-roll it. A hero that still fails
        // degrades to the background rather than costing them the day's post.
        const heroP = heroPrompt(post.hero_scene, post.profile, post.accent);
        const [bgB64, heroB64] = await Promise.all([
          callGeminiImageRetry(backgroundPrompt(post.style, post.profile, cleanMotifs(post.motifs), post.accent)),
          heroP
            ? callGeminiImageRetry(heroP).catch((err) => {
                console.error(`hero image failed (post ${post.id}):`, err.message);
                return null;
              })
            : Promise.resolve(null),
        ]);
        const pngs = await renderSlidePngs({
          slides: post.slides, style: post.style, accent: post.accent,
          bgBase64: bgB64, heroBase64: heroB64,
          watermark: false, // autopilot = paid = never watermarked
        });
        const result = await uploadPhotos({
          username: post.upload_post_username, photos: pngs,
          title: post.slides[0]?.heading || '', caption: post.caption,
          platforms,
        });
        await setPostStatus(post.id, 'posted', { externalIds: result });
        posted++;
        // Mirror into Past carousels (create page) so the subscriber can
        // reopen, download, and cross-post to platforms they haven't linked.
        // The post is already live — bookkeeping failure must not fail it.
        try {
          const mirrored = await saveCarousel(post.user_id, null, post.style, post.slides, post.caption, false, post.hero_scene);
          await saveCarouselBg(post.user_id, mirrored.id, bgB64);
          if (heroB64) await saveCarouselHero(post.user_id, mirrored.id, heroB64);
        } catch (e) {
          console.error(`history mirror failed (post ${post.id}):`, e.message);
        }
      } catch (e) {
        if ((post.retries || 0) < 1) {
          await setPostStatus(post.id, 'queued', { error: e.message, retries: (post.retries || 0) + 1 });
        } else {
          await setPostStatus(post.id, 'failed', { error: e.message });
          failed++;
        }
        errors.push(`post ${post.id}: ${e.message}`);
      }
    }
  }

  // ===== Phase 2: top up queues =====
  try {
    const users = (await getAutopilotUsers()).slice(0, MAX_TOPUP_USERS_PER_RUN);
    for (const user of users) {
      try {
        await refreshUsage(user); // reset monthly quota if usage_reset_at has passed
        const gate = canGenerateCarousel(user);
        if (!gate.allowed) continue; // fair-use cap reached this month
        const { n, scheduledAts } = await countFuturePosts(user.id);
        if (n >= QUEUE_DAYS) continue;
        const slots = nextSlots(new Date().toISOString(), scheduledAts, QUEUE_DAYS - n);
        let total = await countAllPosts(user.id);
        for (const slot of slots) {
          const slotGate = canGenerateCarousel(user);
          if (!slotGate.allowed) break; // re-check: loop mutates carousels_used/credits
          const plan = await generateCarouselPlan({ profile: user.profile, kind: postKind(total) });
          await createPost({
            userId: user.id, scheduledAt: slot.toISOString(), kind: postKind(total),
            style: plan.style, slides: plan.slides, caption: plan.caption,
            accent: plan.accent, motifs: plan.motifs, heroScene: plan.heroScene,
          });
          await consumeCarousel(user, slotGate.source);
          if (slotGate.source === 'credit') user.credits = (user.credits || 0) - 1;
          else user.carousels_used = (user.carousels_used || 0) + 1;
          total++; toppedUp++;
        }
      } catch (e) { errors.push(`topup u${user.id}: ${e.message}`); }
    }
  } catch (e) { errors.push(`topup: ${e.message}`); }

  return res.status(200).json({ toppedUp, posted, failed, errors });
}
