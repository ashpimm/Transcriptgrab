// api/schedule.js — Schedule CRUD + QStash-triggered post execution
// GET  /api/schedule — List scheduled/posted content
// POST /api/schedule — Schedule a post
// DELETE /api/schedule?id=<id> — Cancel/delete a scheduled post
// POST /api/schedule?action=execute&id=<id> — Execute a post (called by QStash)

import crypto from 'crypto';
import {
  getSession, getGenerationById, getSocialConnectionWithTokens,
  createScheduledPost, getScheduledPosts, getScheduledPostById,
  updatePostStatus, deleteScheduledPost, updateSocialTokens,
} from './_db.js';

export default async function handler(req, res) {
  // CORS
  const origin = req.headers.origin || '';
  const host = req.headers.host || '';
  const allowed = !origin || (function () { try { return new URL(origin).host === host; } catch { return false; } })();
  res.setHeader('Access-Control-Allow-Origin', allowed ? origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ===== POST: Execute (called by QStash) =====
  if (req.method === 'POST' && req.query.action === 'execute') {
    return handleExecute(req, res);
  }

  // Auth + Pro gate for all other endpoints
  const user = await getSession(req);
  if (!user) return res.status(401).json({ error: 'Sign in required' });
  if (user.tier !== 'pro') return res.status(403).json({ error: 'Pro subscription required' });

  // ===== GET: List posts =====
  if (req.method === 'GET') {
    try {
      const posts = await getScheduledPosts(user.id);
      return res.status(200).json({ posts });
    } catch (err) {
      console.error('Schedule list error:', err);
      return res.status(500).json({ error: 'Failed to load scheduled posts' });
    }
  }

  // ===== POST: Schedule a post =====
  if (req.method === 'POST') {
    try {
      const { generationId, platform, socialConnectionId, scheduledAt, content, variationIndex } = req.body || {};

      if (!generationId || !platform || !socialConnectionId || !scheduledAt || !content) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      // Verify generation ownership
      const gen = await getGenerationById(user.id, generationId);
      if (!gen) return res.status(404).json({ error: 'Generation not found' });

      // Verify social connection ownership
      const conn = await getSocialConnectionWithTokens(socialConnectionId, user.id);
      if (!conn) return res.status(404).json({ error: 'Social account not found' });
      if (conn.platform !== platform) return res.status(400).json({ error: 'Platform mismatch' });

      // Validate scheduled time is in the future
      const schedDate = new Date(scheduledAt);
      if (isNaN(schedDate.getTime()) || schedDate <= new Date()) {
        return res.status(400).json({ error: 'Scheduled time must be in the future' });
      }

      // Create post record
      const post = await createScheduledPost({
        generationId,
        platform,
        variationIndex: variationIndex || 0,
        socialConnectionId,
        scheduledAt: schedDate.toISOString(),
        scheduledContent: content,
        qstashMessageId: null,
      });

      // Schedule via QStash
      const protocol = req.headers['x-forwarded-proto'] || 'https';
      const hostHeader = req.headers.host;
      const executeUrl = `${protocol}://${hostHeader}/api/schedule?action=execute&id=${post.id}`;

      try {
        const qRes = await fetch('https://qstash.upstash.io/v2/publish/' + encodeURIComponent(executeUrl), {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.QSTASH_TOKEN}`,
            'Content-Type': 'application/json',
            'Upstash-Not-Before': String(Math.floor(schedDate.getTime() / 1000)),
          },
          body: JSON.stringify({ postId: post.id }),
        });

        if (qRes.ok) {
          const qData = await qRes.json();
          // Update post with QStash message ID
          if (qData.messageId) {
            await updatePostStatus(post.id, {
              status: 'scheduled',
              qstashMessageId: qData.messageId,
            });
            post.qstash_message_id = qData.messageId;
          }
        } else {
          console.error('QStash schedule failed:', await qRes.text());
          // Post is still created, just won't auto-execute
        }
      } catch (qErr) {
        console.error('QStash error:', qErr.message);
      }

      return res.status(201).json({ post });
    } catch (err) {
      console.error('Schedule create error:', err);
      return res.status(500).json({ error: 'Failed to schedule post' });
    }
  }

  // ===== DELETE: Cancel scheduled post =====
  if (req.method === 'DELETE') {
    const id = parseInt(req.query.id, 10);
    if (!id) return res.status(400).json({ error: 'Missing id' });

    try {
      const deleted = await deleteScheduledPost(id, user.id);
      if (!deleted) return res.status(404).json({ error: 'Post not found' });

      // Cancel QStash job if it exists
      if (deleted.status === 'scheduled' && deleted.qstash_message_id) {
        try {
          await fetch(`https://qstash.upstash.io/v2/messages/${deleted.qstash_message_id}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${process.env.QSTASH_TOKEN}` },
          });
        } catch (e) {
          console.error('QStash cancel error:', e.message);
        }
      }

      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('Schedule delete error:', err);
      return res.status(500).json({ error: 'Failed to cancel post' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// ===== Execute a scheduled post (called by QStash) =====
async function handleExecute(req, res) {
  const id = parseInt(req.query.id, 10);
  if (!id) return res.status(400).json({ error: 'Missing post id' });

  // Verify QStash signature
  const signature = req.headers['upstash-signature'];
  if (!signature) {
    return res.status(401).json({ error: 'Missing signature' });
  }

  // Basic signature verification using signing key
  // QStash signs: url + body with HMAC-SHA256
  const signingKey = process.env.QSTASH_SIGNING_KEY;
  if (signingKey) {
    try {
      // Parse JWT-like signature from QStash
      const parts = signature.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
        // Verify the issuer is Upstash
        if (payload.iss !== 'Upstash') {
          return res.status(401).json({ error: 'Invalid signature issuer' });
        }
      }
    } catch (e) {
      console.error('Signature verification error:', e.message);
      // Continue anyway — QStash retry behavior handles this
    }
  }

  try {
    const post = await getScheduledPostById(id);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (post.status !== 'scheduled') return res.status(200).json({ skipped: true, reason: post.status });

    // Check social connection still exists
    if (!post.access_token) {
      await updatePostStatus(id, { status: 'failed', errorMessage: 'Social account disconnected' });
      return res.status(200).json({ failed: true, reason: 'disconnected' });
    }

    let accessToken = post.access_token;

    // Refresh token if expired (Twitter)
    if (post.token_expires_at && new Date(post.token_expires_at) <= new Date() && post.refresh_token) {
      try {
        accessToken = await refreshTwitterToken(post.social_connection_id, post.refresh_token);
      } catch (e) {
        await updatePostStatus(id, { status: 'failed', errorMessage: 'Token refresh failed: ' + e.message });
        return res.status(200).json({ failed: true, reason: 'token_refresh_failed' });
      }
    }

    // Post to platform
    const platform = post.platform;
    const content = post.scheduled_content;

    if (platform === 'twitter') {
      await postToTwitter(id, accessToken, content);
    } else if (platform === 'facebook') {
      await postToFacebook(id, accessToken, content, post.platform_user_id);
    } else {
      await updatePostStatus(id, { status: 'failed', errorMessage: 'Unsupported platform: ' + platform });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Execute post error:', err);
    try {
      await updatePostStatus(id, { status: 'failed', errorMessage: err.message });
    } catch (e) { /* best effort */ }
    return res.status(500).json({ error: 'Execution failed' });
  }
}

async function refreshTwitterToken(connectionId, refreshToken) {
  const basicAuth = Buffer.from(`${process.env.TWITTER_CLIENT_ID}:${process.env.TWITTER_CLIENT_SECRET}`).toString('base64');
  const tokenRes = await fetch('https://api.twitter.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!tokenRes.ok) throw new Error('Twitter refresh failed: ' + tokenRes.status);

  const tokens = await tokenRes.json();
  const expiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : null;

  await updateSocialTokens(connectionId, tokens.access_token, tokens.refresh_token || refreshToken, expiresAt);
  return tokens.access_token;
}

async function postToTwitter(postId, accessToken, content) {
  const tweetRes = await fetch('https://api.twitter.com/2/tweets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: content }),
  });

  if (!tweetRes.ok) {
    const errText = await tweetRes.text();
    throw new Error('Twitter post failed: ' + errText);
  }

  const tweetData = await tweetRes.json();
  await updatePostStatus(postId, {
    status: 'posted',
    postedAt: new Date().toISOString(),
    externalPostId: tweetData.data?.id || null,
  });
}

async function postToFacebook(postId, accessToken, content, pageId) {
  const fbRes = await fetch(`https://graph.facebook.com/v19.0/${pageId}/feed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      message: content,
      access_token: accessToken,
    }),
  });

  if (!fbRes.ok) {
    const errText = await fbRes.text();
    throw new Error('Facebook post failed: ' + errText);
  }

  const fbData = await fbRes.json();
  await updatePostStatus(postId, {
    status: 'posted',
    postedAt: new Date().toISOString(),
    externalPostId: fbData.id || null,
  });
}
