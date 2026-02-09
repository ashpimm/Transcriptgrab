// api/debug.js — TEMPORARY debug endpoint
// Tests cookie-based + embedded player approaches
// DELETE after debugging

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  const videoId = req.query.v || 'ojttMNOW6zM';
  const results = {};

  // Test 1: Cookie-based — visit YouTube first, get cookies, then use them
  try {
    // Step A: Visit YouTube homepage to get visitor cookies
    const homeRes = await fetch('https://www.youtube.com/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    const setCookies = homeRes.headers.getSetCookie?.() || [];
    const cookieStr = setCookies.map(c => c.split(';')[0]).join('; ');

    results.step1_cookies = {
      homeStatus: homeRes.status,
      cookieCount: setCookies.length,
      cookieNames: setCookies.map(c => c.split('=')[0]).join(', '),
      hasVisitorInfo: cookieStr.includes('VISITOR_INFO1_LIVE'),
    };

    // Step B: Use cookies with Innertube player API
    const playerRes = await fetch('https://www.youtube.com/youtubei/v1/player', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookieStr,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      body: JSON.stringify({
        videoId,
        context: { client: { clientName: 'WEB', clientVersion: '2.20250101.00.00', hl: 'en', gl: 'US' } },
      }),
    });
    const playerData = await playerRes.json();
    results.step2_cookie_player = {
      status: playerRes.status,
      hasVideoDetails: !!playerData?.videoDetails,
      title: playerData?.videoDetails?.title?.substring(0, 60),
      hasCaptions: !!playerData?.captions,
      captionTrackCount: playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length || 0,
      playabilityStatus: playerData?.playabilityStatus?.status,
      playabilityReason: playerData?.playabilityStatus?.reason?.substring(0, 100),
    };

    // Step C: Use cookies with get_transcript
    const innerBytes = Buffer.from(`\x0a\x0b${videoId}`);
    const params = Buffer.concat([Buffer.from([0x0a, innerBytes.length]), innerBytes]).toString('base64');

    const transcriptRes = await fetch('https://www.youtube.com/youtubei/v1/get_transcript', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookieStr,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      body: JSON.stringify({
        context: { client: { clientName: 'WEB', clientVersion: '2.20250101.00.00', hl: 'en', gl: 'US' } },
        params,
      }),
    });
    const transcriptText = await transcriptRes.text();
    results.step3_cookie_transcript = {
      status: transcriptRes.status,
      size: transcriptText.length,
      hasActions: transcriptText.includes('actions'),
      hasCueGroups: transcriptText.includes('cueGroups'),
      snippet: transcriptText.substring(0, 300),
    };

    // Step D: Use cookies to scrape watch page
    const watchRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'Cookie': cookieStr,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    const watchHtml = await watchRes.text();
    results.step4_cookie_scrape = {
      status: watchRes.status,
      pageSize: watchHtml.length,
      title: watchHtml.match(/<title>(.*?)<\/title>/)?.[1]?.substring(0, 60),
      hasCaptionTracks: watchHtml.includes('captionTracks'),
      hasSignInPage: watchHtml.includes('accounts.google.com'),
    };

  } catch (e) {
    results.cookie_error = e.message;
  }

  // Test 2: Embedded player clients
  try {
    const r = await fetch('https://www.youtube.com/youtubei/v1/player', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      body: JSON.stringify({
        videoId,
        context: {
          client: { clientName: 'WEB_EMBEDDED_PLAYER', clientVersion: '1.20250101.00.00', hl: 'en', gl: 'US' },
          thirdParty: { embedUrl: 'https://www.google.com' },
        },
      }),
    });
    const data = await r.json();
    results.embedded_player = {
      status: r.status,
      title: data?.videoDetails?.title?.substring(0, 60),
      hasCaptions: !!data?.captions,
      captionTrackCount: data?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length || 0,
      playabilityStatus: data?.playabilityStatus?.status,
      playabilityReason: data?.playabilityStatus?.reason?.substring(0, 100),
    };
  } catch (e) {
    results.embedded_player = { error: e.message };
  }

  // Test 3: TVHTML5 embedded
  try {
    const r = await fetch('https://www.youtube.com/youtubei/v1/player', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      body: JSON.stringify({
        videoId,
        context: {
          client: { clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER', clientVersion: '2.0', hl: 'en', gl: 'US' },
          thirdParty: { embedUrl: 'https://www.google.com' },
        },
      }),
    });
    const data = await r.json();
    results.tvhtml5 = {
      status: r.status,
      title: data?.videoDetails?.title?.substring(0, 60),
      hasCaptions: !!data?.captions,
      captionTrackCount: data?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length || 0,
      playabilityStatus: data?.playabilityStatus?.status,
    };
  } catch (e) {
    results.tvhtml5 = { error: e.message };
  }

  return res.status(200).json(results);
}
