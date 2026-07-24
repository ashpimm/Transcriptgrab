import test from 'node:test';
import assert from 'node:assert';
import {
  PUBLISH_SLOTS, isAllowedSlot, scheduledTimeForSlot, validatePostEdit,
} from '../api/_autopilot-controls.js';

// ---- slots ----

test('exactly the four cron fire times are allowed', () => {
  assert.deepEqual(PUBLISH_SLOTS, ['20:30', '02:30', '08:30', '14:30']);
  for (const s of PUBLISH_SLOTS) assert.equal(isAllowedSlot(s), true);
  assert.equal(isAllowedSlot('21:30'), false);
  assert.equal(isAllowedSlot(''), false);
  assert.equal(isAllowedSlot(null), false);
  assert.equal(isAllowedSlot('20:30; DROP TABLE users'), false);
});

test('scheduledTimeForSlot is fire time minus 30 minutes', () => {
  assert.deepEqual(scheduledTimeForSlot('20:30'), { h: 20, m: 0 });
  assert.deepEqual(scheduledTimeForSlot('02:30'), { h: 2, m: 0 });
  assert.deepEqual(scheduledTimeForSlot('08:30'), { h: 8, m: 0 });
  assert.deepEqual(scheduledTimeForSlot('14:30'), { h: 14, m: 0 });
  // invalid input -> legacy default 20:00
  assert.deepEqual(scheduledTimeForSlot('nope'), { h: 20, m: 0 });
});

// ---- post edit validation ----

function goodEdit() {
  return {
    slides: [
      { heading: 'Hook line', body: 'Some body', cta: '' },
      { heading: 'Second', body: '', cta: 'Get the app' },
    ],
    caption: 'A caption #tag',
  };
}

test('accepts a sane edit and returns cleaned slides/caption', () => {
  const out = validatePostEdit(goodEdit());
  assert.equal(out.error, undefined);
  assert.equal(out.slides.length, 2);
  assert.equal(out.slides[0].heading, 'Hook line');
  assert.equal(out.caption, 'A caption #tag');
});

test('rejects non-array, empty, and oversized slide decks', () => {
  assert.ok(validatePostEdit({ slides: null, caption: '' }).error);
  assert.ok(validatePostEdit({ slides: [], caption: '' }).error);
  assert.ok(validatePostEdit({ slides: Array.from({ length: 11 }, () => ({ heading: 'x' })), caption: '' }).error);
});

test('rejects a slide with no heading text', () => {
  const e = goodEdit();
  e.slides[0].heading = '   ';
  assert.ok(validatePostEdit(e).error);
});

test('enforces length caps: heading 120, body 500, cta 120, caption 2200', () => {
  const e = goodEdit();
  e.slides[0].heading = 'x'.repeat(121);
  assert.ok(validatePostEdit(e).error);

  const e2 = goodEdit();
  e2.slides[0].body = 'x'.repeat(501);
  assert.ok(validatePostEdit(e2).error);

  const e3 = goodEdit();
  e3.slides[1].cta = 'x'.repeat(121);
  assert.ok(validatePostEdit(e3).error);

  const e4 = goodEdit();
  e4.caption = 'x'.repeat(2201);
  assert.ok(validatePostEdit(e4).error);
});

test('strips control characters but keeps newlines in body/caption', () => {
  const NL = String.fromCharCode(10), BELL = String.fromCharCode(7), NUL = String.fromCharCode(0);
  const e = goodEdit();
  e.slides[0].heading = 'He' + BELL + 'ading';
  e.slides[0].body = 'line one' + NL + 'line two' + NUL;
  e.caption = 'cap' + NL + 'tion';
  const out = validatePostEdit(e);
  assert.equal(out.error, undefined);
  assert.equal(out.slides[0].heading, 'Heading');
  assert.equal(out.slides[0].body, 'line one' + NL + 'line two');
  assert.equal(out.caption, 'cap' + NL + 'tion');
});

test('drops unknown slide keys (no payload smuggling into jsonb)', () => {
  const e = goodEdit();
  e.slides[0].evil = '<script>';
  const out = validatePostEdit(e);
  assert.equal(out.error, undefined);
  assert.deepEqual(Object.keys(out.slides[0]).sort(), ['body', 'cta', 'heading']);
});
