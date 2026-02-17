// api/channel.js — CRUD for linked YouTube channel (Pro-only)
// GET    /api/channel — Return user's linked channel or null
// POST   /api/channel — Link a channel (resolve + snapshot known video IDs)
// PUT    /api/channel — Update default_formats and/or enabled
// DELETE /api/channel — Unlink channel

import { getSession, getLinkedChannel, createLinkedChannel, updateLinkedChannel, deleteLinkedChannel } from './_db.js';
import { resolveChannel } from './_resolve.js';
import { VALID_FORMATS } from './_prompts.js';

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  // CORS
  const origin = req.headers.origin || '';
  const host = req.headers.host || '';
  const allowed = !origin || (() => { try { return new URL(origin).host === host; } catch { return false; } })();
  res.setHeader('Access-Control-Allow-Origin', allowed ? origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Auth
  const user = await getSession(req);
  if (!user) return res.status(401).json({ error: 'Sign in required.' });
  if (user.tier !== 'pro') return res.status(402).json({ error: 'Pro subscription required.', upgrade: true });

  try {
    // ===== GET =====
    if (req.method === 'GET') {
      const channel = await getLinkedChannel(user.id);
      return res.status(200).json({ channel: channel ? {
        channel_url: channel.channel_url,
        channel_name: channel.channel_name,
        default_formats: channel.default_formats,
        enabled: channel.enabled,
        video_count: channel.known_video_ids?.length || 0,
        last_checked_at: channel.last_checked_at,
      } : null });
    }

    // ===== POST =====
    if (req.method === 'POST') {
      const { url, formats } = req.body || {};

      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'Channel URL is required.' });
      }

      // Validate URL pattern
      const channelMatch = url.match(/youtube\.com\/channel\/(UC[a-zA-Z0-9_-]+)/);
      const handleMatch = url.match(/youtube\.com\/@([a-zA-Z0-9_.-]+)/);
      const userMatch = url.match(/youtube\.com\/user\/([a-zA-Z0-9_.-]+)/);

      if (!channelMatch && !handleMatch && !userMatch) {
        return res.status(400).json({ error: 'Must be a YouTube channel or @handle URL.' });
      }

      // Validate formats
      const selectedFormats = Array.isArray(formats)
        ? formats.filter(f => VALID_FORMATS.includes(f))
        : ['twitter', 'linkedin'];
      if (selectedFormats.length === 0) {
        return res.status(400).json({ error: 'Select at least one format.' });
      }

      // Resolve channel to get video IDs snapshot
      const channelUrl = channelMatch
        ? `https://www.youtube.com/channel/${channelMatch[1]}/videos`
        : handleMatch
          ? `https://www.youtube.com/@${handleMatch[1]}/videos`
          : `https://www.youtube.com/user/${userMatch[1]}/videos`;

      const videos = await resolveChannel(channelUrl);
      const knownIds = videos.map(v => v.videoId);

      // Extract channel name from URL
      const channelName = handleMatch
        ? `@${handleMatch[1]}`
        : userMatch
          ? userMatch[1]
          : channelMatch[1];

      const channel = await createLinkedChannel(user.id, url.trim(), channelName, selectedFormats, knownIds);

      return res.status(200).json({
        channel: {
          channel_url: channel.channel_url,
          channel_name: channel.channel_name,
          default_formats: channel.default_formats,
          enabled: channel.enabled,
          video_count: knownIds.length,
          last_checked_at: channel.last_checked_at,
        },
      });
    }

    // ===== PUT =====
    if (req.method === 'PUT') {
      const { formats, enabled } = req.body || {};

      const existing = await getLinkedChannel(user.id);
      if (!existing) return res.status(404).json({ error: 'No channel linked.' });

      const fields = {};
      if (Array.isArray(formats)) {
        const validated = formats.filter(f => VALID_FORMATS.includes(f));
        if (validated.length === 0) return res.status(400).json({ error: 'Select at least one format.' });
        fields.default_formats = validated;
      }
      if (typeof enabled === 'boolean') {
        fields.enabled = enabled;
      }

      if (Object.keys(fields).length === 0) {
        return res.status(400).json({ error: 'Nothing to update.' });
      }

      await updateLinkedChannel(user.id, fields);

      const updated = await getLinkedChannel(user.id);
      return res.status(200).json({
        channel: {
          channel_url: updated.channel_url,
          channel_name: updated.channel_name,
          default_formats: updated.default_formats,
          enabled: updated.enabled,
          video_count: updated.known_video_ids?.length || 0,
          last_checked_at: updated.last_checked_at,
        },
      });
    }

    // ===== DELETE =====
    if (req.method === 'DELETE') {
      await deleteLinkedChannel(user.id);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed.' });

  } catch (e) {
    console.error('Channel error:', e);
    return res.status(500).json({ error: 'Failed to process request.' });
  }
}
