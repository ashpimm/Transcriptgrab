// Local-only visual harness for Account UI states. It never uses production
// credentials or network calls: `node tests/account-ui-harness.mjs`.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.UI_HARNESS_PORT || 48173);

const user = {
  id: 1, name: 'Test Creator', email: 'creator@example.test', tier: 'pro',
  carouselsUsed: 8, carouselsLimit: 30, credits: 0,
};

function social(scenario) {
  const now = new Date();
  const recent = new Date(now.getTime() - 20 * 60 * 1000).toISOString();
  const failed = scenario === 'attention';
  return {
    enabled: true, connected: true, username: 'test-creator', linked: ['instagram'],
    health: {
      ok: !failed,
      publish: { state: failed ? 'attention' : 'healthy', status: failed ? 'failed' : 'succeeded', finishedAt: recent },
      topup: { state: 'healthy', status: 'succeeded', finishedAt: recent },
    },
    queue: failed
      ? { due: 1, future: 0, submitted: 0, blocked: 1, failed: 0, next_at: null }
      : { due: 0, future: 3, submitted: 0, blocked: 0, failed: 0, next_at: new Date(now + 3600000).toISOString() },
    posts: [
      { scheduled_at: now.toISOString(), kind: 'value', status: 'submitted', retries: 0, slides: [{ heading: 'A provider-confirmed workflow' }] },
      { scheduled_at: new Date(now.getTime() + 86400000).toISOString(), kind: 'showcase', status: 'queued', retries: 1, error: 'A transient image request failed; retry is queued.', slides: [{ heading: 'A retry customers can actually see' }] },
      { scheduled_at: new Date(now.getTime() - 86400000).toISOString(), kind: 'value', status: 'posted', slides: [{ heading: 'Yesterday posted successfully' }] },
    ],
  };
}

function accountPage() {
  const source = fs.readFileSync(path.join(root, 'account.html'), 'utf8');
  const bootstrap = `<script>
    window.TGUser = { ready: Promise.resolve(${JSON.stringify(user)}) };
    window.TGPro = { _checkout: function () {} };
    window.fetch = function (url) {
      if (String(url).indexOf('/api/social') === 0) {
        var scenario = new URLSearchParams(location.search).get('scenario') || 'healthy';
        return Promise.resolve(new Response(JSON.stringify(${social.toString()}(scenario)), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    };
  </script>`;
  return source
    .replace('<script src="/nav.js" defer></script>', '')
    .replace('<script src="/pro.js" defer></script>', bootstrap);
}

http.createServer((req, res) => {
  const pathname = new URL(req.url, `http://127.0.0.1:${port}`).pathname;
  if (pathname === '/' || pathname === '/account') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(accountPage());
  }
  if (pathname === '/hooklab.css') {
    res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
    return res.end(fs.readFileSync(path.join(root, 'hooklab.css')));
  }
  res.writeHead(404).end('Not found');
}).listen(port, '127.0.0.1', () => {
  console.log(`Account UI harness: http://127.0.0.1:${port}/account`);
});
