// Durable Autopilot workers. Queue generation and publishing are deliberately
// separate so slow content planning can never starve the paid deliverable.

import crypto from 'crypto';
import {
  acquireAutopilotLock, canGenerateCarousel, claimDuePosts, claimSubmittedPosts,
  consumeCarousel, countAllPosts, countFuturePosts, createPost,
  ensureAutopilotReliabilitySchema, finishAutopilotRun, getAutopilotUsers,
  recoverStalePostClaims, refreshUsage, releaseAutopilotLock, saveCarousel,
  saveCarouselBg, saveCarouselHero, setPostStatus, startAutopilotRun,
} from './_db.js';
import {
  backgroundPrompt, cleanMotifs, generateCarouselPlan, heroPrompt, nextSlots, postKind,
} from './_generate.js';
import { renderSlidePngs } from './_render.js';
import {
  effectivePlatforms, getLinkedPlatforms, getUploadStatus, uploadPhotos,
  uploadPostEnabled, uploadResponseState, uploadStatusState,
} from './_uploadpost.js';
import { callGeminiImageRetry, cronAuthOk } from './_shared.js';

const QUEUE_DAYS = 3;
const MAX_PUBLISH_PER_RUN = 5;
const MAX_VERIFY_PER_RUN = 5;
const MAX_TOPUP_USERS_PER_RUN = 6;
const MAX_TOPUP_POSTS_PER_RUN = 1;
const RUN_BUDGET_MS = 52_000;
const MIN_PUBLISH_START_MS = 24_000;
const MIN_TOPUP_START_MS = 10_000;

function cleanMessage(error) {
  const message = String(error?.message || error || 'Unknown error').replace(/\s+/g, ' ').trim();
  return message.substring(0, 500);
}

function log(level, event, data = {}) {
  const payload = JSON.stringify({ service: 'autopilot', event, ...data });
  (console[level] || console.log)(payload);
}

function triggerFor(req, scheduledTrigger) {
  return req.query?.secret ? 'manual' : scheduledTrigger;
}

function errorRecorder(runId, errors) {
  return (scope, error, extra = {}) => {
    const item = { scope, message: cleanMessage(error), ...extra };
    errors.push(item);
    log('error', 'operation_failed', { runId, ...item });
    return item.message;
  };
}

async function sendFailureAlert(summary) {
  const url = process.env.AUTOPILOT_ALERT_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `Promote.dev publishing worker ${summary.job} failed`, ...summary }),
      signal: AbortSignal.timeout(3000),
    });
  } catch (error) {
    log('error', 'alert_delivery_failed', { runId: summary.runId, message: cleanMessage(error) });
  }
}

async function trackedHandler(req, res, { job, scheduledTrigger, work }) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!cronAuthOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  res.setHeader('Cache-Control', 'no-store');

  const runId = crypto.randomUUID();
  const trigger = triggerFor(req, scheduledTrigger);
  const started = Date.now();
  const deadline = started + RUN_BUDGET_MS;
  const stats = {};
  const errors = [];
  const addError = errorRecorder(runId, errors);

  try {
    await ensureAutopilotReliabilitySchema();
    await startAutopilotRun({ id: runId, job, trigger });
  } catch (error) {
    const message = addError('schema_or_run_start', error);
    return res.status(503).json({ runId, job, status: 'failed', error: message });
  }

  log('log', 'run_started', { runId, job, trigger });
  try {
    await work({ runId, deadline, stats, errors, addError });
  } catch (error) {
    addError('unhandled', error);
  }

  const durationMs = Date.now() - started;
  let status = errors.length ? 'failed' : 'succeeded';
  try {
    await finishAutopilotRun(runId, { status, stats, errors, durationMs });
  } catch (error) {
    addError('run_finish', error);
    status = 'failed';
  }

  const summary = { runId, job, trigger, status, durationMs, stats, errors };
  log(status === 'succeeded' ? 'log' : 'error', 'run_finished', summary);
  if (status === 'failed') await sendFailureAlert(summary);
  return res.status(status === 'succeeded' ? 200 : 500).json(summary);
}

async function retryOrFail(post, error, ctx, scope = 'publish') {
  const message = ctx.addError(scope, error, { postId: post.id });
  if ((post.retries || 0) < 1) {
    await setPostStatus(post.id, 'queued', { error: message, retries: (post.retries || 0) + 1 });
    ctx.stats.requeued = (ctx.stats.requeued || 0) + 1;
  } else {
    await setPostStatus(post.id, 'failed', { error: message });
    ctx.stats.failed = (ctx.stats.failed || 0) + 1;
  }
}

async function verifySubmitted(ctx) {
  const submitted = await claimSubmittedPosts(ctx.runId, MAX_VERIFY_PER_RUN);
  ctx.stats.verifying = submitted.length;
  for (let index = 0; index < submitted.length; index++) {
    const post = submitted[index];
    // Status calls are bounded too: leave enough time for at least one paid
    // delivery, and release every pre-claimed row before stopping.
    if (ctx.deadline - Date.now() < MIN_PUBLISH_START_MS + 6000) {
      for (const remaining of submitted.slice(index)) {
        await setPostStatus(remaining.id, 'submitted', { error: remaining.error || '' });
        ctx.stats.verifyDeferred = (ctx.stats.verifyDeferred || 0) + 1;
      }
      break;
    }
    const requestId = post.external_ids?.request_id;
    if (!requestId) {
      const message = ctx.addError('verify', new Error('Submitted post has no provider tracking id; automatic retry was stopped to prevent a duplicate.'), { postId: post.id });
      await setPostStatus(post.id, 'failed', { error: message });
      ctx.stats.failed = (ctx.stats.failed || 0) + 1;
      continue;
    }
    try {
      const providerStatus = await getUploadStatus(requestId);
      const outcome = uploadStatusState(providerStatus);
      const externalIds = { ...(post.external_ids || {}), provider_status: providerStatus };
      if (outcome.state === 'succeeded') {
        await setPostStatus(post.id, 'posted', { error: '', externalIds });
        ctx.stats.posted = (ctx.stats.posted || 0) + 1;
      } else if (outcome.state === 'failed') {
        // The provider may have succeeded on one platform and failed on
        // another. Never resubmit a terminal provider job automatically: that
        // could duplicate the successful platform.
        const message = ctx.addError('verify', new Error(outcome.message || 'Upload provider reported failure.'), { postId: post.id });
        await setPostStatus(post.id, 'failed', { error: message, externalIds });
        ctx.stats.failed = (ctx.stats.failed || 0) + 1;
      } else {
        const ageMs = Date.now() - new Date(post.scheduled_at).getTime();
        if (Number.isFinite(ageMs) && ageMs > 6 * 60 * 60 * 1000) {
          const message = ctx.addError('verify_timeout', new Error('Upload provider still has not confirmed this post after six hours.'), { postId: post.id });
          await setPostStatus(post.id, 'failed', { error: message, externalIds });
          ctx.stats.failed = (ctx.stats.failed || 0) + 1;
        } else {
          await setPostStatus(post.id, 'submitted', { error: '', externalIds });
          ctx.stats.pending = (ctx.stats.pending || 0) + 1;
        }
      }
    } catch (error) {
      // A status lookup outage is not evidence the social upload failed. Keep
      // it submitted and let the recovery run check again without re-posting.
      await setPostStatus(post.id, 'submitted', { error: `Status check delayed: ${cleanMessage(error)}` });
      ctx.addError('verify_lookup', error, { postId: post.id });
      ctx.stats.pending = (ctx.stats.pending || 0) + 1;
    }
  }
}

async function publishDue(ctx) {
  if (!uploadPostEnabled()) {
    ctx.addError('configuration', new Error('UPLOAD_POST_API_KEY is not configured.'));
    return;
  }

  const due = await claimDuePosts(ctx.runId, MAX_PUBLISH_PER_RUN);
  ctx.stats.claimed = due.length;
  if (!due.length) ctx.stats.noDuePosts = true;
  const linkedCache = new Map();

  for (let index = 0; index < due.length; index++) {
    const post = due[index];
    if (ctx.deadline - Date.now() < MIN_PUBLISH_START_MS) {
      await setPostStatus(post.id, 'queued', { error: 'Deferred safely because this run was near its time limit.' });
      ctx.stats.deferred = (ctx.stats.deferred || 0) + 1;
      for (const remaining of due.slice(index + 1)) {
        await setPostStatus(remaining.id, 'queued', { error: 'Deferred safely because this run was near its time limit.' });
        ctx.stats.deferred++;
      }
      break;
    }

    try {
      if (post.tier !== 'pro') {
        await setPostStatus(post.id, 'skipped', { error: 'Subscription inactive when this post became due.' });
        ctx.stats.skipped = (ctx.stats.skipped || 0) + 1;
        continue;
      }
      if (!post.upload_post_username) {
        await setPostStatus(post.id, 'blocked', { error: 'Social account disconnected. Reconnect it in Account; this post will retry.' });
        ctx.stats.blocked = (ctx.stats.blocked || 0) + 1;
        continue;
      }

      if (!linkedCache.has(post.upload_post_username)) {
        try {
          linkedCache.set(post.upload_post_username, await getLinkedPlatforms(post.upload_post_username));
        } catch (error) {
          linkedCache.set(post.upload_post_username, null);
          log('warn', 'linked_platform_lookup_delayed', { runId: ctx.runId, postId: post.id, message: cleanMessage(error) });
        }
      }
      const platforms = effectivePlatforms(
        post.platforms || ['tiktok', 'instagram'],
        linkedCache.get(post.upload_post_username),
      );
      if (!platforms.length) {
        await setPostStatus(post.id, 'blocked', { error: 'No linked social account. Link Instagram in Account; this post will retry.' });
        ctx.stats.blocked = (ctx.stats.blocked || 0) + 1;
        continue;
      }

      const heroP = heroPrompt(post.hero_scene, post.profile, post.accent);
      const [bgB64, heroB64] = await Promise.all([
        callGeminiImageRetry(backgroundPrompt(post.style, post.profile, cleanMotifs(post.motifs), post.accent)),
        heroP ? callGeminiImageRetry(heroP).catch((error) => {
          log('warn', 'hero_image_degraded', { runId: ctx.runId, postId: post.id, message: cleanMessage(error) });
          return null;
        }) : Promise.resolve(null),
      ]);
      const pngs = await renderSlidePngs({
        slides: post.slides, style: post.style, accent: post.accent,
        bgBase64: bgB64, heroBase64: heroB64, watermark: false,
      });

      // Stable across retries. If our HTTP response is lost after upload-post
      // accepted it, the next run receives the same job instead of duplicating
      // the Instagram post.
      const requestId = `hooklab-post-${post.id}`;
      const providerResult = await uploadPhotos({
        username: post.upload_post_username, photos: pngs,
        title: post.slides[0]?.heading || '', caption: post.caption,
        platforms, requestId,
      });
      const outcome = uploadResponseState(providerResult);
      const externalIds = { ...providerResult, request_id: providerResult.request_id || requestId };
      if (outcome.state === 'failed') {
        const message = ctx.addError('provider_result', new Error(outcome.message || 'Upload provider reported failure.'), { postId: post.id });
        await setPostStatus(post.id, 'failed', { error: message, externalIds });
        ctx.stats.failed = (ctx.stats.failed || 0) + 1;
      } else if (outcome.state === 'succeeded') {
        await setPostStatus(post.id, 'posted', { error: '', externalIds });
        ctx.stats.posted = (ctx.stats.posted || 0) + 1;
      } else {
        await setPostStatus(post.id, 'submitted', { error: '', externalIds });
        ctx.stats.submitted = (ctx.stats.submitted || 0) + 1;
      }

      // Keep the generated carousel available for download even while an async
      // social upload is still being verified.
      try {
        if (ctx.deadline - Date.now() < 4000) throw new Error('Skipped history mirror near the worker time limit.');
        const mirrored = await saveCarousel(post.user_id, null, post.style, post.slides, post.caption, false, post.hero_scene);
        await saveCarouselBg(post.user_id, mirrored.id, bgB64);
        if (heroB64) await saveCarouselHero(post.user_id, mirrored.id, heroB64);
      } catch (error) {
        log('warn', 'history_mirror_failed', { runId: ctx.runId, postId: post.id, message: cleanMessage(error) });
      }
    } catch (error) {
      await retryOrFail(post, error, ctx);
    }
  }
}

export function handlePublish(req, res, scheduledTrigger) {
  return trackedHandler(req, res, {
    job: 'publish', scheduledTrigger,
    work: async (ctx) => {
      const recovered = await recoverStalePostClaims();
      ctx.stats.recovered = recovered.length;
      await verifySubmitted(ctx);
      await publishDue(ctx);
    },
  });
}

export function handleTopup(req, res, scheduledTrigger) {
  return trackedHandler(req, res, {
    job: 'topup', scheduledTrigger,
    work: async (ctx) => {
      const locked = await acquireAutopilotLock('topup', ctx.runId, 10);
      if (!locked) {
        ctx.stats.overlapSkipped = true;
        return;
      }
      try {
        const users = (await getAutopilotUsers()).slice(0, MAX_TOPUP_USERS_PER_RUN);
        ctx.stats.users = users.length;
        let postsCreatedThisRun = 0;
        for (const user of users) {
          if (postsCreatedThisRun >= MAX_TOPUP_POSTS_PER_RUN) {
            ctx.stats.postBudgetReached = true;
            break;
          }
          if (ctx.deadline - Date.now() < MIN_TOPUP_START_MS) {
            ctx.stats.deferredUsers = (ctx.stats.deferredUsers || 0) + 1;
            break;
          }
          try {
            await refreshUsage(user);
            const initialGate = canGenerateCarousel(user);
            if (!initialGate.allowed) {
              const key = initialGate.reason === 'monthly_limit' ? 'monthlyLimitUsers' : 'ineligibleUsers';
              ctx.stats[key] = (ctx.stats[key] || 0) + 1;
              continue;
            }
            const { n, scheduledAts } = await countFuturePosts(user.id);
            if (n >= QUEUE_DAYS) {
              ctx.stats.queueFullUsers = (ctx.stats.queueFullUsers || 0) + 1;
              continue;
            }
            const slots = nextSlots(new Date().toISOString(), scheduledAts, QUEUE_DAYS - n);
            let total = await countAllPosts(user.id);
            for (const slot of slots) {
              if (postsCreatedThisRun >= MAX_TOPUP_POSTS_PER_RUN) {
                ctx.stats.postBudgetReached = true;
                break;
              }
              if (ctx.deadline - Date.now() < MIN_TOPUP_START_MS) {
                ctx.stats.deferredSlots = (ctx.stats.deferredSlots || 0) + 1;
                break;
              }
              const gate = canGenerateCarousel(user);
              if (!gate.allowed) break;
              const kind = postKind(total);
              const plan = await generateCarouselPlan({ profile: user.profile, kind });
              const created = await createPost({
                userId: user.id, scheduledAt: slot.toISOString(), kind,
                style: plan.style, slides: plan.slides, caption: plan.caption,
                accent: plan.accent, motifs: plan.motifs, heroScene: plan.heroScene,
              });
              if (!created) {
                ctx.stats.duplicatesAvoided = (ctx.stats.duplicatesAvoided || 0) + 1;
                continue;
              }
              await consumeCarousel(user, gate.source);
              if (gate.source === 'credit') user.credits = (user.credits || 0) - 1;
              else user.carousels_used = (user.carousels_used || 0) + 1;
              total++;
              postsCreatedThisRun++;
              ctx.stats.toppedUp = (ctx.stats.toppedUp || 0) + 1;
            }
          } catch (error) {
            ctx.addError('topup_user', error, { userId: user.id });
          }
        }
      } finally {
        try {
          await releaseAutopilotLock('topup', ctx.runId);
        } catch (error) {
          ctx.addError('topup_lock_release', error);
        }
      }
    },
  });
}
