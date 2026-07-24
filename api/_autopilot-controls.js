// User-facing Autopilot controls: the allowed posting slots and validation for
// manual queue edits. Slots are the exact vercel.json publish cron fire times
// (UTC "HH:MM") — free-form times are impossible on Hobby crons, so the UI
// offers these four and the promise "posts at X" stays exact.

export const PUBLISH_SLOTS = ['20:30', '02:30', '08:30', '14:30'];
export const DEFAULT_SLOT = '20:30';

export function isAllowedSlot(slot) {
  return PUBLISH_SLOTS.includes(slot);
}

// Posts are scheduled 30 minutes before their slot's cron fires, so
// claimDuePosts (scheduled_at <= NOW) picks them up on the intended fire and
// never on the one before. All slots are :30, so this is always hh:00.
export function scheduledTimeForSlot(slot) {
  const fire = isAllowedSlot(slot) ? slot : DEFAULT_SLOT;
  const h = parseInt(fire.substring(0, 2), 10);
  return { h, m: 0 };
}

const LIMITS = { heading: 120, body: 500, cta: 120, caption: 2200 };
const MAX_SLIDES = 10;

// Control characters (all C0 except newline, plus DEL) get stripped from user
// edits. Built with fromCharCode so the ranges survive any source re-encoding.
const CTRL_CHARS = new RegExp(
  '[' + String.fromCharCode(0) + '-' + String.fromCharCode(9) +
        String.fromCharCode(11) + '-' + String.fromCharCode(31) +
        String.fromCharCode(127) + ']',
  'g',
);

function cleanText(v, cap) {
  return String(v == null ? '' : v).replace(CTRL_CHARS, '').trim().substring(0, cap);
}

function rawLen(v) {
  return String(v == null ? '' : v).length;
}

// Validates a manual edit of a queued post. Returns { slides, caption } with
// cleaned values, or { error } describing the first problem found.
export function validatePostEdit(body) {
  const rawSlides = body ? body.slides : null;
  if (!Array.isArray(rawSlides) || rawSlides.length === 0) {
    return { error: 'Post needs at least one slide.' };
  }
  if (rawSlides.length > MAX_SLIDES) {
    return { error: `A post can have at most ${MAX_SLIDES} slides.` };
  }

  const slides = [];
  for (let i = 0; i < rawSlides.length; i++) {
    const raw = rawSlides[i] || {};
    for (const key of ['heading', 'body', 'cta']) {
      if (rawLen(raw[key]) > LIMITS[key]) {
        return { error: `Slide ${i + 1} ${key} is too long (max ${LIMITS[key]} characters).` };
      }
    }
    const slide = {
      heading: cleanText(raw.heading, LIMITS.heading),
      body: cleanText(raw.body, LIMITS.body),
      cta: cleanText(raw.cta, LIMITS.cta),
    };
    if (!slide.heading) return { error: `Slide ${i + 1} needs a heading.` };
    slides.push(slide);
  }

  if (rawLen(body.caption) > LIMITS.caption) {
    return { error: `Caption is too long (max ${LIMITS.caption} characters).` };
  }
  return { slides, caption: cleanText(body.caption, LIMITS.caption) };
}
