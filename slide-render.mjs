// slide-render.mjs — THE slide renderer. Shared verbatim by the browser
// (create.html preview/download) and the server (api/_render.js autopilot
// posting) so the two can never drift. 2D-context calls only.

export const SLIDE_W = 1080;
export const SLIDE_H = 1350;

export const SLIDE_THEMES = {
  bold:     { overlay: 'rgba(13,16,20,0.62)',    ink: '#FFFFFF', sub: 'rgba(255,255,255,0.85)', mono: false },
  mono:     { overlay: 'rgba(250,250,247,0.88)', ink: '#141414', sub: 'rgba(20,20,20,0.72)',    mono: false },
  notebook: { overlay: 'rgba(247,242,230,0.82)', ink: '#20232B', sub: 'rgba(32,35,43,0.75)',    mono: false },
  stat:     { overlay: 'rgba(5,6,8,0.68)',       ink: '#F5F5F6', sub: 'rgba(245,245,246,0.72)', mono: true  },
};

function isHex(c) { return /^#[0-9a-fA-F]{6}$/.test(c || ''); }

function wrapText(x, text, maxWidth) {
  var words = String(text || '').split(/\s+/).filter(Boolean);
  var lines = [], line = '';
  words.forEach(function (w) {
    var probe = line ? line + ' ' + w : w;
    if (x.measureText(probe).width > maxWidth && line) { lines.push(line); line = w; }
    else line = probe;
  });
  if (line) lines.push(line);
  return lines;
}

export function drawSlideOn(canvas, bg, slide, count, style, accent, opts) {
  opts = opts || {};
  var theme = SLIDE_THEMES[style] || SLIDE_THEMES.bold;
  var fontSans = opts.fontSans || 'Geist, sans-serif';
  var fontMono = opts.fontMono || '"Geist Mono", monospace';
  var family = theme.mono ? fontMono : fontSans;
  var x = canvas.getContext('2d');

  // cover-fit background (naturalWidth in browsers, width on server images)
  var iw = bg.naturalWidth || bg.width, ih = bg.naturalHeight || bg.height;
  var scale = Math.max(SLIDE_W / iw, SLIDE_H / ih);
  x.drawImage(bg, (SLIDE_W - iw * scale) / 2, (SLIDE_H - ih * scale) / 2, iw * scale, ih * scale);

  // legibility overlay
  x.fillStyle = theme.overlay;
  x.fillRect(0, 0, SLIDE_W, SLIDE_H);

  var pad = 100, maxW = SLIDE_W - pad * 2;

  // heading — shrink until it fits 6 lines
  var hSize = 92, hLines;
  do {
    x.font = '800 ' + hSize + 'px ' + family;
    hLines = wrapText(x, slide.heading, maxW);
    if (hLines.length <= 6) break;
    hSize -= 8;
  } while (hSize > 48);
  var hLH = Math.round(hSize * 1.12);

  var bSize = 40, bLH = Math.round(bSize * 1.42), bLines = [];
  if (slide.body) {
    x.font = '500 ' + bSize + 'px ' + family;
    bLines = wrapText(x, slide.body, maxW);
  }

  var gap = slide.body ? 44 : 0;
  var blockH = hLines.length * hLH + gap + bLines.length * bLH;
  var top = Math.max(pad + 120, (SLIDE_H - blockH) / 2);

  // accent bar above the heading — the USER'S brand color, never Hooklab orange
  x.fillStyle = isHex(accent) ? accent : theme.ink;
  x.fillRect(pad, top - 56, 88, 12);

  x.textBaseline = 'top';
  x.fillStyle = theme.ink;
  x.font = '800 ' + hSize + 'px ' + family;
  hLines.forEach(function (ln, i) { x.fillText(ln, pad, top + i * hLH); });

  if (bLines.length) {
    x.fillStyle = theme.sub;
    x.font = '500 ' + bSize + 'px ' + family;
    var bTop = top + hLines.length * hLH + gap;
    bLines.forEach(function (ln, i) { x.fillText(ln, pad, bTop + i * bLH); });
  }

  // NO slide-index chip — deliberate (2026-07-13 spec).

  // Free-tier watermark: whisper, not a badge. Last slide only (caller decides).
  if (opts.watermark) {
    var wm = 'made with hooklab';
    x.globalAlpha = 0.35;
    x.fillStyle = theme.ink;
    x.font = '500 26px ' + fontMono;
    x.textBaseline = 'alphabetic';
    x.fillText(wm, SLIDE_W - pad - x.measureText(wm).width, SLIDE_H - 52);
    x.globalAlpha = 1;
  }
}
