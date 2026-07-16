// slide-render.mjs — THE slide renderer. Shared verbatim by the browser
// (create.html preview/download) and the server (api/_render.js autopilot
// posting) so the two can never drift. 2D-context calls only.

export const SLIDE_W = 1080;
export const SLIDE_H = 1350;

export const SLIDE_THEMES = {
  bold:     { overlay: 'rgba(13,16,20,0.62)',    ink: '#FFFFFF', sub: 'rgba(255,255,255,0.85)', mono: false, dark: true  },
  mono:     { overlay: 'rgba(250,250,247,0.88)', ink: '#141414', sub: 'rgba(20,20,20,0.72)',    mono: false, dark: false },
  notebook: { overlay: 'rgba(247,242,230,0.82)', ink: '#20232B', sub: 'rgba(32,35,43,0.75)',    mono: false, dark: false },
  stat:     { overlay: 'rgba(5,6,8,0.68)',       ink: '#F5F5F6', sub: 'rgba(245,245,246,0.72)', mono: true,  dark: true  },
};

// The hook slide is a PHOTOGRAPH, not a background. Every theme's flat wash
// would ruin it — the dark ones muddy the image, the paper ones erase it. So
// the hero gets a top-down scrim instead: opaque where the type sits, gone by
// the time it reaches the subject, with a little weight back at the bottom so
// the feed's crop fold never blows out. Ink is white regardless of style,
// because the photo is always dark. The accent bar is what carries the brand
// through to the text slides.
export const HERO_THEME = { ink: '#FFFFFF', sub: 'rgba(255,255,255,0.88)' };

// Sized from the type that was actually laid out, not from an assumed heading
// length: it holds full strength to just past the last line, then falls away
// fast so the photograph is seen. A guessed cutoff put long headings in white
// on bare photo. A little weight returns at the bottom to seat the subject.
function heroScrim(x, textBottom) {
  var end = Math.min(Math.max((textBottom + 40) / SLIDE_H, 0.34), 0.74);
  var fade = Math.min(end + 0.16, 0.94);
  var clear = Math.min(fade + 0.12, 0.98);
  var g = x.createLinearGradient(0, 0, 0, SLIDE_H);
  g.addColorStop(0.00, 'rgba(8,9,11,0.92)');
  g.addColorStop(end * 0.72, 'rgba(8,9,11,0.86)');
  g.addColorStop(end, 'rgba(8,9,11,0.72)');
  g.addColorStop(fade, 'rgba(8,9,11,0.16)');
  g.addColorStop(clear, 'rgba(8,9,11,0.02)');
  g.addColorStop(1.00, 'rgba(8,9,11,0.24)');
  return g;
}

function isHex(c) { return /^#[0-9a-fA-F]{6}$/.test(c || ''); }

// A brand color the theme's backdrop swallows is an invisible mark: charcoal
// on the dark overlays (first live IG post shipped a black-on-black CTA), or
// off-white on the paper washes. Pull it toward the readable end while keeping
// it recognisably their color. Dark backdrops lift, light backdrops sink.
function visibleAccent(hex, ink, dark) {
  if (!isHex(hex)) return ink;
  var r = parseInt(hex.substr(1, 2), 16) / 255;
  var g = parseInt(hex.substr(3, 2), 16) / 255;
  var b = parseInt(hex.substr(5, 2), 16) / 255;
  var lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (dark && lum < 0.35) {
    var lift = function (c) { return Math.round((c + (1 - c) * 0.55) * 255); };
    return 'rgb(' + lift(r) + ',' + lift(g) + ',' + lift(b) + ')';
  }
  if (!dark && lum > 0.62) {
    var sink = function (c) { return Math.round(c * 0.4 * 255); };
    return 'rgb(' + sink(r) + ',' + sink(g) + ',' + sink(b) + ')';
  }
  return hex;
}

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
  var hero = !!opts.hero;
  var theme = SLIDE_THEMES[style] || SLIDE_THEMES.bold;
  var ink = hero ? HERO_THEME.ink : theme.ink;
  var sub = hero ? HERO_THEME.sub : theme.sub;
  var fontSans = opts.fontSans || 'Geist, sans-serif';
  var fontMono = opts.fontMono || '"Geist Mono", monospace';
  var family = theme.mono ? fontMono : fontSans;
  var x = canvas.getContext('2d');

  // cover-fit background (naturalWidth in browsers, width on server images)
  var iw = bg.naturalWidth || bg.width, ih = bg.naturalHeight || bg.height;
  var scale = Math.max(SLIDE_W / iw, SLIDE_H / ih);
  x.drawImage(bg, (SLIDE_W - iw * scale) / 2, (SLIDE_H - ih * scale) / 2, iw * scale, ih * scale);

  var pad = 100, maxW = SLIDE_W - pad * 2;

  // Lay the type out BEFORE the overlay — the hero scrim is sized from where
  // the text actually ends. Measuring touches no pixels, so the text slides
  // render exactly as they always did.
  // The hero holds to 4 lines: a 6-line heading would bury the photograph.
  var maxLines = hero ? 4 : 6;
  var hSize = 92, hLines;
  do {
    x.font = '800 ' + hSize + 'px ' + family;
    hLines = wrapText(x, slide.heading, maxW);
    if (hLines.length <= maxLines) break;
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
  // Hero: pin the type to the top so the photo's subject owns the lower frame.
  // Text slides: centre the block as before.
  var top = hero ? pad + 56 : Math.max(pad + 120, (SLIDE_H - blockH) / 2);

  // legibility overlay
  x.fillStyle = hero ? heroScrim(x, top + blockH) : theme.overlay;
  x.fillRect(0, 0, SLIDE_W, SLIDE_H);

  // accent bar above the heading — the USER'S brand color, never Hooklab orange
  x.fillStyle = visibleAccent(accent, ink, hero || theme.dark);
  x.fillRect(pad, top - 56, 88, 12);

  x.textBaseline = 'top';
  x.fillStyle = ink;
  x.font = '800 ' + hSize + 'px ' + family;
  hLines.forEach(function (ln, i) { x.fillText(ln, pad, top + i * hLH); });

  if (bLines.length) {
    x.fillStyle = sub;
    x.font = '500 ' + bSize + 'px ' + family;
    var bTop = top + hLines.length * hLH + gap;
    bLines.forEach(function (ln, i) { x.fillText(ln, pad, bTop + i * bLH); });
  }

  // The ask. Carried on the slide object (last slide only — the generator puts
  // it nowhere else), so old carousels and the hook slide simply have none.
  // Sits under the type block in the brand color, with a short rule above it so
  // it reads as the arc's payoff rather than another body line. It gives the
  // free-tier watermark a wide berth: they share this slide's bottom edge.
  if (slide.cta && !hero) {
    // The watermark owns the bottom-right corner on free-tier slides; the CTA
    // gets the column to its left and shrinks, then wraps, to stay out of it.
    var cAvail = maxW - (opts.watermark ? 340 : 0);
    var cSize = 38, cLines;
    do {
      x.font = '700 ' + cSize + 'px ' + family;
      cLines = wrapText(x, slide.cta, cAvail);
      if (cLines.length <= 2) break;
      cSize -= 2;
    } while (cSize > 24);
    cLines = cLines.slice(0, 2);
    var cLH = Math.round(cSize * 1.28);
    var cW = Math.min(Math.max.apply(null, cLines.map(function (ln) { return x.measureText(ln).width; })), cAvail);
    var cTop = Math.min(top + blockH + 64, SLIDE_H - pad - 40 - cLines.length * cLH);

    x.fillStyle = visibleAccent(accent, ink, theme.dark);
    x.globalAlpha = 0.55;
    x.fillRect(pad, cTop - 26, cW, 3);
    x.globalAlpha = 1;
    x.textBaseline = 'top';
    cLines.forEach(function (ln, i) { x.fillText(ln, pad, cTop + i * cLH); });
  }

  // NO slide-index chip — deliberate (2026-07-13 spec).

  // Free-tier watermark: whisper, not a badge. Last slide only (caller decides).
  if (opts.watermark) {
    var wm = 'made with hooklab';
    x.globalAlpha = 0.35;
    x.fillStyle = ink;
    x.font = '500 26px ' + fontMono;
    x.textBaseline = 'alphabetic';
    x.fillText(wm, SLIDE_W - pad - x.measureText(wm).width, SLIDE_H - 52);
    x.globalAlpha = 1;
  }
}
