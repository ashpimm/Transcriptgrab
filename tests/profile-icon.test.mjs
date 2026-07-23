import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { extractProductIcon, isPrivateAddress, isSafeUrl } from '../api/profile.js';

test('product icon prefers store artwork and resolves it against the final page URL', () => {
  const html = `
    <html><head>
      <meta property="og:image" content="/artwork/icon-512.png">
      <link rel="icon" href="/generic-favicon.ico">
    </head></html>
  `;
  assert.equal(
    extractProductIcon(html, 'https://apps.apple.com/au/app/example/id123'),
    'https://apps.apple.com/artwork/icon-512.png',
  );
});

test('product icon prefers a generic site touch icon over JSON-LD artwork', () => {
  const html = `
    <html><head>
      <script type="application/ld+json">
        {"@type":"SoftwareApplication","image":"https://example.com/social-card.png"}
      </script>
      <link sizes="180x180" href="/apple-touch-icon.png" rel="apple-touch-icon">
      <link rel="icon" sizes="32x32" href="/favicon.png">
    </head></html>
  `;
  assert.equal(
    extractProductIcon(html, 'https://example.com/product'),
    'https://example.com/apple-touch-icon.png',
  );
});

test('product icon accepts app artwork nested in JSON-LD objects', () => {
  const html = `
    <script type="application/ld+json">
      {"@graph":[{"@type":"SoftwareApplication","image":{"contentUrl":"https://cdn.example.com/app.png"}}]}
    </script>
  `;
  assert.equal(
    extractProductIcon(html, 'https://play.google.com/store/apps/details?id=example'),
    'https://cdn.example.com/app.png',
  );
});

test('App Store social artwork is normalized to the square app-icon variant', () => {
  const html = `
    <script type="application/ld+json">
      {
        "@type":"SoftwareApplication",
        "image":"https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/example/1200x630wa.png"
      }
    </script>
  `;
  assert.equal(
    extractProductIcon(html, 'https://apps.apple.com/us/app/example/id123'),
    'https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/example/512x512bb.png',
  );
});

test('product icon rejects unsafe and credentialed URLs', () => {
  assert.equal(
    extractProductIcon('<link rel="icon" href="javascript:alert(1)">', 'https://example.com'),
    '',
  );
  assert.equal(
    extractProductIcon('<link rel="icon" href="https://user:pass@example.com/icon.png">', 'https://example.com'),
    '',
  );
  assert.equal(
    extractProductIcon('<link rel="icon" href="http://127.0.0.1/icon.png">', 'https://example.com'),
    '',
  );
  assert.equal(
    extractProductIcon('<link rel="icon" href="http://public.example.com/icon.png">', 'https://example.com'),
    '',
  );
});

test('generic icon extraction falls through when the highest-priority icon is unsafe', () => {
  const html = `
    <link rel="apple-touch-icon" sizes="180x180" href="http://example.com/touch.png">
    <link rel="icon" sizes="32x32" href="https://example.com/favicon.png">
  `;
  assert.equal(extractProductIcon(html, 'https://example.com'), 'https://example.com/favicon.png');
});

test('profile URL checks reject private, reserved, credentialed, and intranet targets', () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.1.3', '::1', 'fc00::1', '2001:db8::1']) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  assert.equal(isPrivateAddress('8.8.8.8'), false);
  assert.equal(isPrivateAddress('2606:4700:4700::1111'), false);
  assert.equal(isSafeUrl('https://user:pass@example.com/app'), false);
  assert.equal(isSafeUrl('https://service.internal/app'), false);
  assert.equal(isSafeUrl('https://example.com/app'), true);
});

test('Create preserves and renders the imported product icon with a fallback', () => {
  const source = fs.readFileSync(new URL('../create.html', import.meta.url), 'utf8');
  assert.match(source, /icon_url:\s*usesImportedProfile/);
  assert.match(source, /function renderProductIcon\(p\)/);
  assert.match(source, /id="ps-icon"/);
  assert.match(source, /id="ps-icon-fallback"/);
  assert.match(source, /ratio < \.65 \|\| ratio > 1\.55/);
  assert.match(source, /action:\s*'refresh_icon'/);
});

test('legacy icon backfill patches only the matching unchanged profile', () => {
  const source = fs.readFileSync(new URL('../api/_db.js', import.meta.url), 'utf8');
  assert.match(source, /export async function updateProfileIcon/);
  assert.match(source, /profile->>'app_url' = \$\{expectedAppUrl\}/);
  assert.match(source, /COALESCE\(profile->>'icon_checked', 'false'\) <> 'true'/);
});

test('deployment policy permits imported HTTPS icons while scripts stay restricted', () => {
  const config = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const csp = config.headers[0].headers.find((header) => header.key === 'Content-Security-Policy').value;
  assert.match(csp, /img-src 'self' https: data:/);
  assert.match(csp, /script-src 'self' 'unsafe-inline' https:\/\/cdnjs\.cloudflare\.com https:\/\/cdn\.jsdelivr\.net/);
});
