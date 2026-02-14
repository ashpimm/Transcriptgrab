// api/_resolve.js — Shared YouTube resolve helpers
// Vercel ignores _-prefixed files in api/ as endpoints.

export async function resolvePlaylist(playlistId) {
  const url = `https://www.youtube.com/playlist?list=${playlistId}`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch playlist page');
  }

  const html = await response.text();

  const titleMatch = html.match(/<title>(.*?)<\/title>/);
  const playlistTitle = titleMatch
    ? titleMatch[1].replace(' - YouTube', '').trim()
    : '';

  const videos = extractVideoIdsFromHTML(html);

  return videos.map(v => ({
    videoId: v.id,
    title: v.title,
    url: `https://www.youtube.com/watch?v=${v.id}`,
  }));
}


export async function resolveChannel(channelUrl) {
  const response = await fetch(channelUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch channel page');
  }

  const html = await response.text();
  const videos = extractVideoIdsFromHTML(html);

  return videos.map(v => ({
    videoId: v.id,
    title: v.title,
    url: `https://www.youtube.com/watch?v=${v.id}`,
  }));
}


export function extractVideoIdsFromHTML(html) {
  const videos = new Map();

  const dataMatch = html.match(/var ytInitialData\s*=\s*(\{.*?\});\s*<\/script>/s);
  if (dataMatch) {
    try {
      const data = JSON.parse(dataMatch[1]);
      findVideoIds(data, videos);
    } catch (e) {
      // JSON parse failed, try other strategies
    }
  }

  const videoIdPattern = /"videoId"\s*:\s*"([a-zA-Z0-9_-]{11})"/g;
  let match;
  while ((match = videoIdPattern.exec(html)) !== null) {
    if (!videos.has(match[1])) {
      videos.set(match[1], { id: match[1], title: '' });
    }
  }

  const titlePattern = /"title"\s*:\s*\{\s*"runs"\s*:\s*\[\s*\{\s*"text"\s*:\s*"([^"]+)"\s*\}\s*\]\s*\}/g;
  const titles = [];
  while ((match = titlePattern.exec(html)) !== null) {
    titles.push(match[1]);
  }

  const videoIdList = /"videoId"\s*:\s*"([a-zA-Z0-9_-]{11})"/g;
  const ids = [];
  while ((match = videoIdList.exec(html)) !== null) {
    ids.push(match[1]);
  }

  const uniqueIds = [...new Set(ids)];
  for (let i = 0; i < uniqueIds.length; i++) {
    const id = uniqueIds[i];
    const existing = videos.get(id);
    if (existing && !existing.title && titles[i]) {
      existing.title = decodeHTMLEntities(titles[i]);
    } else if (!existing) {
      videos.set(id, { id, title: titles[i] ? decodeHTMLEntities(titles[i]) : '' });
    }
  }

  return Array.from(videos.values());
}


export function findVideoIds(obj, videos, depth = 0) {
  if (depth > 15 || !obj || typeof obj !== 'object') return;

  if (obj.videoId && typeof obj.videoId === 'string' && obj.videoId.length === 11) {
    const id = obj.videoId;
    if (!videos.has(id)) {
      let title = '';
      if (obj.title) {
        if (typeof obj.title === 'string') title = obj.title;
        else if (obj.title.runs) title = obj.title.runs.map(r => r.text).join('');
        else if (obj.title.simpleText) title = obj.title.simpleText;
      }
      videos.set(id, { id, title: decodeHTMLEntities(title) });
    }
  }

  if (Array.isArray(obj)) {
    for (const item of obj) findVideoIds(item, videos, depth + 1);
  } else {
    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === 'object') {
        findVideoIds(obj[key], videos, depth + 1);
      }
    }
  }
}


export function decodeHTMLEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\\u0026/g, '&')
    .replace(/\\"/g, '"');
}
