// api/autopilot.js — The product. Daily cron:
//   Phase 1 (top-up): every connected Autopilot subscriber keeps 3 days of
//     posts queued, 75/25 value/showcase rotation.
//   Phase 2 (publish): render due posts server-side and push to TikTok +
//     Instagram via upload-post. One retry, then failed + surfaced.
// GET /api/autopilot?secret=$ADMIN_SECRET (or Vercel cron)

import {
  getAutopilotUsers, countFuturePosts, countAllPosts, createPost,
  getDuePosts, setPostStatus, consumeCarousel, canGenerateCarousel,
} from './_db.js';
import { generateCarouselPlan, postKind, backgroundPrompt, nextSlots, cleanMotifs } from './_generate.js';
import { renderSlidePngs } from './_render.js';
import { uploadPostEnabled, uploadPhotos } from './_uploadpost.js';
import { callGeminiImage } from './_shared.js';

export const maxDuration = 60;

const QUEUE_DAYS = 3;
const MAX_PUBLISH_PER_RUN = 5;
const MAX_TOPUP_USERS_PER_RUN = 6;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const isCron = !!req.headers['x-vercel-cron'];
  const secretOk = process.env.ADMIN_SECRET && req.query.secret === process.env.ADMIN_SECRET;
  if (!isCron && !secretOk) return res.status(401).json({ error: 'Unauthorized' });

  const errors = [];
  let toppedUp = 0, posted = 0, failed = 0;

  // ===== Phase 1: top up queues =====
  try {
    const users = (await getAutopilotUsers()).slice(0, MAX_TOPUP_USERS_PER_RUN);
    for (const user of users) {
      try {
        const gate = canGenerateCarousel(user);
        if (!gate.allowed) continue; // fair-use cap reached this month
        const { n, scheduledAts } = await countFuturePosts(user.id);
        if (n >= QUEUE_DAYS) continue;
        const slots = nextSlots(new Date().toISOString(), scheduledAts, QUEUE_DAYS - n);
        let total = await countAllPosts(user.id);
        for (const slot of slots) {
          if (!canGenerateCarousel(user).allowed) break; // re-check: loop mutates carousels_used
          const plan = await generateCarouselPlan({ profile: user.profile, kind: postKind(total) });
          await createPost({
            userId: user.id, scheduledAt: slot.toISOString(), kind: postKind(total),
            style: plan.style, slides: plan.slides, caption: plan.caption,
            accent: plan.accent, motifs: plan.motifs,
          });
          await consumeCarousel(user, 'pro');
          user.carousels_used = (user.carousels_used || 0) + 1;
          total++; toppedUp++;
        }
      } catch (e) { errors.push(`topup u${user.id}: ${e.message}`); }
    }
  } catch (e) { errors.push(`topup: ${e.message}`); }

  // ===== Phase 2: publish due posts =====
  if (uploadPostEnabled()) {
    const due = await getDuePosts(MAX_PUBLISH_PER_RUN).catch((e) => { errors.push(`due: ${e.message}`); return []; });
    for (const post of due) {
      try {
        const bgB64 = await callGeminiImage(
          backgroundPrompt(post.style, post.profile, cleanMotifs(post.motifs), post.accent)
        );
        const pngs = await renderSlidePngs({
          slides: post.slides, style: post.style, accent: post.accent,
          bgBase64: bgB64, watermark: false, // autopilot = paid = never watermarked
        });
        const result = await uploadPhotos({
          username: post.upload_post_username, photos: pngs,
          title: post.slides[0]?.heading || '', caption: post.caption,
          platforms: post.platforms || ['tiktok', 'instagram'],
        });
        await setPostStatus(post.id, 'posted', { externalIds: result });
        posted++;
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

  return res.status(200).json({ toppedUp, posted, failed, errors });
}
