const ACTIVE_STATES = new Set(['queued', 'fetching', 'preprocessing', 'rendering', 'saving']);
const EFFECTS = ['zoomInSlow', 'slideLeftSlow', 'zoomOutSlow', 'slideRightSlow'];

function config() {
  const apiKey = process.env.SHOTSTACK_API_KEY || '';
  const environment = process.env.SHOTSTACK_ENV || 'stage';
  if (!['stage', 'v1'].includes(environment)) throw new Error('SHOTSTACK_ENV must be stage or v1.');
  return { apiKey, base: `https://api.shotstack.io/edit/${environment}` };
}

export function shotstackEnabled() {
  return !!process.env.SHOTSTACK_API_KEY;
}

export function reelSceneLength(index, count) {
  if (index === 0) return 1.8;
  if (index === count - 1) return 2.8;
  return 2.2;
}

export function buildReelEdit(assetUrls) {
  let start = 0;
  const clips = assetUrls.map((src, index) => {
    const length = reelSceneLength(index, assetUrls.length);
    const clip = {
      asset: { type: 'image', src },
      start: Number(start.toFixed(2)),
      length,
      fit: 'cover',
      effect: EFFECTS[index % EFFECTS.length],
      transition: { in: 'fade', out: 'fade' },
    };
    start += length;
    return clip;
  });
  return {
    timeline: {
      background: '#0B0D10',
      tracks: [{ clips }],
      cache: false,
    },
    output: {
      format: 'mp4',
      resolution: '1080',
      aspectRatio: '9:16',
      fps: 25,
      quality: 'high',
      mute: true,
      poster: { capture: 0.5 },
      destinations: [{ provider: 'shotstack', exclude: false }],
    },
  };
}

async function call(path, options = {}) {
  const { apiKey, base } = config();
  if (!apiKey) throw new Error('Reel rendering is not configured yet.');
  const response = await fetch(base + path, {
    ...options,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(12_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    const detail = data?.response?.error || data?.message || `HTTP ${response.status}`;
    throw new Error(`Shotstack render error: ${String(detail).substring(0, 300)}`);
  }
  return data;
}

export async function submitReel(assetUrls) {
  const data = await call('/render', { method: 'POST', body: JSON.stringify(buildReelEdit(assetUrls)) });
  const id = data?.response?.id;
  if (!id) throw new Error('Shotstack returned no render id.');
  return { id };
}

export async function getReelRender(id) {
  const data = await call(`/render/${encodeURIComponent(id)}?data=false`, { method: 'GET' });
  const result = data?.response || {};
  const status = String(result.status || '').toLowerCase();
  if (status === 'done' && result.url) {
    return { state: 'ready', url: result.url, poster: result.poster || '', duration: result.duration || null };
  }
  if (status === 'failed') return { state: 'failed', error: result.error || 'Video render failed.' };
  return { state: ACTIVE_STATES.has(status) ? 'rendering' : 'rendering' };
}
