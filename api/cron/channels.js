// api/cron/channels.js — Hourly cron: auto-generate content for linked channels
//
// For each enabled Pro channel:
//   1. Resolve current video IDs from YouTube
//   2. Diff against known_video_ids to find new uploads
//   3. For each new video (max 5 per channel per run):
//      - Check usage limits
//      - Fetch transcript via Supadata
//      - Generate content via Gemini
//      - Save as auto-generated
//   4. Update known_video_ids

import { getSQL, getAllEnabledChannels, markChannelChecked, saveAutoGeneration, canGenerate, consumeCredit, getUserById, refreshUsage } from '../_db.js';
import { resolveChannel } from '../_resolve.js';
import { FORMAT_PROMPTS } from '../_prompts.js';
import { callGemini } from '../_shared.js';

export const config = { maxDuration: 300 };

const SUPADATA_KEY = process.env.SUPADATA_API_KEY || '';
const MAX_NEW_PER_CHANNEL = 5;

export default async function handler(req, res) {
  // Verify cron auth
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && process.env.NODE_ENV === 'production') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const stats = { channels: 0, newVideos: 0, generated: 0, errors: 0 };

  try {
    const channels = await getAllEnabledChannels();
    stats.channels = channels.length;

    for (const ch of channels) {
      try {
        await processChannel(ch, stats);
      } catch (e) {
        console.error(`Channel ${ch.id} error:`, e.message);
        stats.errors++;
      }
    }

    console.log(`Cron channels: ${stats.channels} checked, ${stats.newVideos} new, ${stats.generated} generated, ${stats.errors} errors`);
    return res.status(200).json({ ok: true, ...stats });

  } catch (e) {
    console.error('Cron channels error:', e);
    return res.status(500).json({ error: 'Cron failed' });
  }
}


async function processChannel(ch, stats) {
  // Build channel videos URL
  const url = ch.channel_url;
  const channelMatch = url.match(/youtube\.com\/channel\/(UC[a-zA-Z0-9_-]+)/);
  const handleMatch = url.match(/youtube\.com\/@([a-zA-Z0-9_.-]+)/);
  const userMatch = url.match(/youtube\.com\/user\/([a-zA-Z0-9_.-]+)/);

  const channelUrl = channelMatch
    ? `https://www.youtube.com/channel/${channelMatch[1]}/videos`
    : handleMatch
      ? `https://www.youtube.com/@${handleMatch[1]}/videos`
      : userMatch
        ? `https://www.youtube.com/user/${userMatch[1]}/videos`
        : null;

  if (!channelUrl) {
    await markChannelChecked(ch.id, ch.known_video_ids || []);
    return;
  }

  // Resolve current videos
  const currentVideos = await resolveChannel(channelUrl);
  const currentIds = currentVideos.map(v => v.videoId);
  const knownSet = new Set(ch.known_video_ids || []);

  // Find new video IDs (not in known set)
  const newVideos = currentVideos.filter(v => !knownSet.has(v.videoId));
  stats.newVideos += newVideos.length;

  // Process up to MAX_NEW_PER_CHANNEL new videos
  const toProcess = newVideos.slice(0, MAX_NEW_PER_CHANNEL);

  for (const video of toProcess) {
    // Refresh user state for each video (usage may have changed)
    let user = await getUserById(ch.user_id);
    if (!user || user.tier !== 'pro') break;
    user = await refreshUsage(user);

    // Check generation limit
    const check = canGenerate(user);
    if (!check.allowed) {
      console.log(`Channel ${ch.id}: user ${ch.user_id} hit limit, stopping`);
      break;
    }

    try {
      // Fetch transcript
      const transcript = await fetchTranscript(video.videoId);
      if (!transcript) {
        console.log(`Channel ${ch.id}: no transcript for ${video.videoId}, skipping`);
        knownSet.add(video.videoId); // Mark as known to avoid retrying
        continue;
      }

      // Build AI prompt from user's default formats
      const formats = ch.default_formats || ['twitter', 'linkedin'];
      const promptParts = formats.map(f => FORMAT_PROMPTS[f]?.prompt).filter(Boolean);
      const schemaParts = formats.map(f => FORMAT_PROMPTS[f]?.schema).filter(Boolean);

      if (promptParts.length === 0) {
        knownSet.add(video.videoId);
        continue;
      }

      const prompt = `You are an expert content repurposer. Given a video transcript, generate ready-to-post content for the following platform(s).

${promptParts.join('\n\n')}

Return JSON with this exact structure:
{
  ${schemaParts.join(',\n  ')}
}`;

      // Generate content
      const result = await callGemini(prompt, transcript, 0.7);

      // Save as auto-generated (ON CONFLICT DO NOTHING — won't overwrite manual)
      const thumb = `https://img.youtube.com/vi/${video.videoId}/mqdefault.jpg`;
      const saved = await saveAutoGeneration(
        ch.user_id, video.videoId, video.title || '', thumb, formats, result
      );

      if (saved) {
        await consumeCredit(user);
        stats.generated++;
        console.log(`Channel ${ch.id}: generated ${video.videoId}`);
      }

      knownSet.add(video.videoId);

      // Rate limit delay between videos
      await new Promise(r => setTimeout(r, 500));

    } catch (e) {
      console.error(`Channel ${ch.id}: video ${video.videoId} failed:`, e.message);
      stats.errors++;
      knownSet.add(video.videoId); // Don't retry failed videos
    }
  }

  // Update known IDs (merge current + any newly processed)
  const allKnown = [...new Set([...currentIds, ...knownSet])];
  await markChannelChecked(ch.id, allKnown);
}


async function fetchTranscript(videoId) {
  if (!SUPADATA_KEY) return null;

  try {
    const res = await fetch(
      `https://api.supadata.ai/v1/transcript?url=https://www.youtube.com/watch?v=${videoId}`,
      { headers: { 'x-api-key': SUPADATA_KEY } }
    );

    if (!res.ok) return null;

    const data = await res.json();
    const content = data?.content || data;
    const rawSegments = Array.isArray(content) ? content : content?.segments || content?.transcript || [];

    if (!rawSegments.length) return null;

    // Join all segments into plain text
    return rawSegments
      .filter(s => s.text?.trim())
      .map(s => s.text.trim())
      .join(' ');

  } catch {
    return null;
  }
}
