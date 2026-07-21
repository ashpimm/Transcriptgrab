import crypto from 'node:crypto';

function signingSecret(override) {
  const secret = override || process.env.REEL_SIGNING_SECRET || process.env.CRON_SECRET || process.env.ADMIN_SECRET;
  if (!secret) throw new Error('Reel asset signing is not configured.');
  return secret;
}

function signaturePayload(carouselId, index, expires) {
  return `${carouselId}:${index}:${expires}`;
}

export function signReelAsset({ carouselId, index, expires }, secretOverride) {
  return crypto.createHmac('sha256', signingSecret(secretOverride))
    .update(signaturePayload(carouselId, index, expires))
    .digest('base64url');
}

export function verifyReelAsset({ carouselId, index, expires, signature }, secretOverride, nowMs = Date.now()) {
  if (!Number.isInteger(carouselId) || carouselId <= 0) return false;
  if (!Number.isInteger(index) || index < 0 || index > 20) return false;
  if (!Number.isFinite(expires) || expires * 1000 <= nowMs) return false;
  if (typeof signature !== 'string' || !signature) return false;
  const expected = signReelAsset({ carouselId, index, expires }, secretOverride);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function reelAssetUrl({ baseUrl, carouselId, index, expires, secret }) {
  const url = new URL('/api/carousel', baseUrl);
  url.searchParams.set('asset', 'reel-slide');
  url.searchParams.set('carouselId', String(carouselId));
  url.searchParams.set('index', String(index));
  url.searchParams.set('expires', String(expires));
  url.searchParams.set('signature', signReelAsset({ carouselId, index, expires }, secret));
  return url.toString();
}

export function publicBaseUrl(req) {
  if (process.env.REEL_PUBLIC_BASE_URL) return new URL(process.env.REEL_PUBLIC_BASE_URL).origin;
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (!host || !/^https?$/.test(proto)) throw new Error('Could not determine the public Reel asset URL.');
  return `${proto}://${host}`;
}
