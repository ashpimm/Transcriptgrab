// api/generate.js — Script pack generation from library hooks.
//
// GET  /api/generate                -> { packs: [...] } (history)
// GET  /api/generate?packId=N       -> { pack } (full scripts)
// POST /api/generate {action:'pack', hookIds?, nicheSlug, size}
// POST /api/generate {action:'regen', packId, scriptIndex}
// POST /api/generate {action:'swap', packId, scriptIndex, hookId}

import {
  getSession, getHooks, getHooksByIds, getNicheBySlug, getProfile,
  saveScriptPack, getScriptPacks, getScriptPack, updateScriptPack,
  canGeneratePack, consumePack,
} from './_db.js';
import { callGemini } from './_shared.js';
import { SCRIPT_PACK_PROMPT } from './_prompts.js';

export const maxDuration = 60;

const SIZES = [3, 10, 20];

function cors(req, res) {
  const origin = req.headers.origin || '';
  const host = req.headers.host || '';
  const allowed = !origin || (function () { try { return new URL(origin).host === host; } catch { return false; } })();
  res.setHeader('Access-Control-Allow-Origin', allowed ? origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') { res.status(200).end(); return true; }
  return false;
}

function fmtCount(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1000) return Math.round(n / 1000) + 'K';
  return String(n);
}

function sourceStats(hook) {
  if (!hook || !hook.views || Number(hook.views) === 0) return 'Hooklab curated template';
  return `Hook from a video with ${fmtCount(Number(hook.views))} views (account: ${fmtCount(Number(hook.followers))} followers, ${Number(hook.outlier_score).toFixed(1)}x outlier)`;
}

function businessFromProfile(profile) {
  return {
    sells: profile.sells || '',
    audience: profile.audience || '',
    results: profile.results || [],
    tone: profile.tone || 'casual',
  };
}

async function writeScripts(business, hooks, storyCount) {
  const payload = {
    business,
    hooks: hooks.map((h, i) => ({
      i,
      template: h.hook_template,
      verbatim: h.hook_verbatim || '',
      topic: h.topic || '',
      format: h.format || 'talking_head',
    })),
    count: hooks.length,
    storyCount,
  };
  let out = await callGemini(SCRIPT_PACK_PROMPT, JSON.stringify(payload), 0.7);
  if (!Array.isArray(out)) {
    // one strict retry
    out = await callGemini(SCRIPT_PACK_PROMPT + '\n\nREMINDER: output must be a raw JSON array.', JSON.stringify(payload), 0.4);
  }
  if (!Array.isArray(out)) throw new Error('AI returned an invalid response. Please try again.');

  return hooks.map((h, i) => {
    const s = out.find((x) => x && x.i === i) || out[i] || {};
    return {
      hookId: h.id,
      hookTemplate: h.hook_template,
      sourceStats: sourceStats(h),
      kind: s.kind === 'story' ? 'story' : 'educational',
      notes: String(s.notes || '').substring(0, 1000),
      bullets: Array.isArray(s.bullets) ? s.bullets.map((b) => String(b).substring(0, 400)).slice(0, 12) : [],
      caption: String(s.caption || '').substring(0, 1000),
    };
  });
}

export default async function handler(req, res) {
  if (cors(req, res)) return;

  try {
    const user = await getSession(req).catch(() => null);
    if (!user) return res.status(401).json({ error: 'Sign in required.' });

    if (req.method === 'GET') {
      if (req.query.packId) {
        const pack = await getScriptPack(user.id, parseInt(req.query.packId, 10));
        if (!pack) return res.status(404).json({ error: 'Pack not found.' });
        return res.status(200).json({ pack });
      }
      const packs = await getScriptPacks(user.id);
      return res.status(200).json({ packs });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const action = body.action || '';

    const profile = await getProfile(user.id);
    if (!profile || !profile.sells) {
      return res.status(400).json({ error: 'Set up your business profile first so scripts have your substance.', needsProfile: true });
    }
    const business = businessFromProfile(profile);

    // ===== NEW PACK =====
    if (action === 'pack') {
      const size = SIZES.includes(body.size) ? body.size : 3;
      const gate = canGeneratePack(user, size);
      if (!gate.allowed) {
        const msg = gate.reason === 'monthly_limit'
          ? 'You have used all 10 script packs this month. They reset on your billing date.'
          : 'Script packs are a Pro feature. Your free sample pack is 3 scripts.';
        return res.status(402).json({ error: msg, reason: gate.reason, upgrade: gate.reason === 'upgrade' });
      }

      // Resolve hooks
      let hooks = [];
      if (Array.isArray(body.hookIds) && body.hookIds.length > 0) {
        const ids = body.hookIds.map((n) => parseInt(n, 10)).filter(Boolean).slice(0, size);
        hooks = await getHooksByIds(ids);
      } else {
        const nicheSlug = body.nicheSlug || profile.niche_slug || null;
        const result = await getHooks({ nicheSlug, limit: size, freeTier: false });
        hooks = result.hooks;
      }
      if (hooks.length === 0) {
        return res.status(400).json({ error: 'No hooks available for that selection. Pick hooks in the library first.' });
      }
      hooks = hooks.slice(0, size);

      const storyCount = hooks.length >= 10 ? Math.round(hooks.length * 0.2) : 0;
      const scripts = await writeScripts(business, hooks, storyCount);

      const niche = profile.niche_slug ? await getNicheBySlug(profile.niche_slug) : null;
      const title = `${scripts.length}-script pack`;
      const saved = await saveScriptPack(user.id, niche ? niche.id : null, title, scripts, !!gate.sample);
      await consumePack(user, !!gate.sample);

      return res.status(200).json({ packId: saved.id, scripts, sample: !!gate.sample });
    }

    // ===== REGEN / SWAP one script =====
    if (action === 'regen' || action === 'swap') {
      const pack = await getScriptPack(user.id, parseInt(body.packId, 10));
      if (!pack) return res.status(404).json({ error: 'Pack not found.' });
      const idx = parseInt(body.scriptIndex, 10);
      const scripts = pack.scripts;
      if (!Array.isArray(scripts) || !(idx >= 0 && idx < scripts.length)) {
        return res.status(400).json({ error: 'Script not found in that pack.' });
      }

      const hookId = action === 'swap' ? parseInt(body.hookId, 10) : scripts[idx].hookId;
      const hooks = await getHooksByIds([hookId]);
      if (hooks.length === 0) return res.status(400).json({ error: 'That hook no longer exists.' });

      const wasStory = scripts[idx].kind === 'story';
      const replacement = await writeScripts(business, hooks, wasStory ? 1 : 0);
      scripts[idx] = replacement[0];
      await updateScriptPack(user.id, pack.id, scripts);

      return res.status(200).json({ packId: pack.id, scriptIndex: idx, script: scripts[idx] });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    console.error('generate error:', e);
    return res.status(500).json({ error: e.message && e.message.startsWith('AI') ? e.message : 'Something went wrong. Please try again.' });
  }
}
