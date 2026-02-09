// api/debug.js — TEMPORARY debug endpoint to diagnose YouTube responses
// DELETE THIS FILE after debugging is complete

export default async function handler(req, res) {
  const videoId = req.query.v || 'ojttMNOW6zM';
  const results = {};

  // Test 1: get_transcript
  try {
    const innerBytes = Buffer.from(`\x0a\x0b${videoId}`);
    const params = Buffer.concat([
      Buffer.from([0x0a, innerBytes.length]),
      innerBytes
    ]).toString('base64');

    const r = await fetch('https://www.youtube.com/youtubei/v1/get_transcript', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      body: JSON.stringify({
        context: { client: { clientName: 'WEB', clientVersion: '2.20250101.00.00', hl: 'en', gl: 'US' } },
        params,
      }),
    });
    const text = await r.text();
    results.get_transcript = {
      status: r.status,
      size: text.length,
      snippet: text.substring(0, 500),
      hasActions: text.includes('actions'),
      hasCueGroups: text.includes('cueGroups'),
    };
  } catch (e) {
    results.get_transcript = { error: e.message };
  }

  // Test 2: Innertube player (ANDROID)
  try {
    const r = await fetch('https://www.youtube.com/youtubei/v1/player', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.android.youtube/19.09.37 (Linux; U; Android 12)',
      },
      body: JSON.stringify({
        videoId,
        context: { client: { clientName: 'ANDROID', clientVersion: '19.09.37', androidSdkVersion: 31, hl: 'en', gl: 'US' } },
        contentCheckOk: true, racyCheckOk: true,
      }),
    });
    const data = await r.json();
    results.innertube_android = {
      status: r.status,
      hasVideoDetails: !!data?.videoDetails,
      title: data?.videoDetails?.title?.substring(0, 60),
      hasCaptions: !!data?.captions,
      captionTrackCount: data?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length || 0,
      playabilityStatus: data?.playabilityStatus?.status,
    };
  } catch (e) {
    results.innertube_android = { error: e.message };
  }

  // Test 3: Innertube player (WEB)
  try {
    const r = await fetch('https://www.youtube.com/youtubei/v1/player', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      body: JSON.stringify({
        videoId,
        context: { client: { clientName: 'WEB', clientVersion: '2.20250101.00.00', hl: 'en', gl: 'US' } },
      }),
    });
    const data = await r.json();
    results.innertube_web = {
      status: r.status,
      hasVideoDetails: !!data?.videoDetails,
      title: data?.videoDetails?.title?.substring(0, 60),
      hasCaptions: !!data?.captions,
      captionTrackCount: data?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length || 0,
      playabilityStatus: data?.playabilityStatus?.status,
      playabilityReason: data?.playabilityStatus?.reason?.substring(0, 100),
    };
  } catch (e) {
    results.innertube_web = { error: e.message };
  }

  // Test 4: Watch page scrape
  try {
    const r = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });
    const html = await r.text();
    results.scrape = {
      status: r.status,
      pageSize: html.length,
      title: html.match(/<title>(.*?)<\/title>/)?.[1]?.substring(0, 60),
      hasCaptionTracks: html.includes('captionTracks'),
      hasPlayerResponse: html.includes('playerResponse'),
      hasConsentPage: html.includes('consent.youtube.com') || html.includes('Before you continue'),
      hasSignInPage: html.includes('accounts.google.com'),
    };
  } catch (e) {
    results.scrape = { error: e.message };
  }

  // Test 5: Timedtext list
  try {
    const r = await fetch(`https://www.youtube.com/api/timedtext?v=${videoId}&type=list`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    const text = await r.text();
    results.timedtext = {
      status: r.status,
      size: text.length,
      content: text.substring(0, 500),
    };
  } catch (e) {
    results.timedtext = { error: e.message };
  }

  return res.status(200).json(results);
}
