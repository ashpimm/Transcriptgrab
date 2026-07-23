import test from 'node:test';
import assert from 'node:assert/strict';

// The module reads SUPADATA_API_KEY into a const at load, so set it before import.
process.env.SUPADATA_API_KEY = 'test-key';
const { fetchTranscript, transcriptRetryDelayMs } = await import('../api/_transcript.js');

const noSleep = async () => {};
const jsonResponse = (body) => new Response(JSON.stringify(body), { status: 200 });

test('backoff grows exponentially and honours a Retry-After header', () => {
  assert.equal(transcriptRetryDelayMs(1), 500);
  assert.equal(transcriptRetryDelayMs(2), 1000);
  assert.equal(transcriptRetryDelayMs(3), 2000);
  assert.equal(transcriptRetryDelayMs(1, '4'), 4000);
  assert.equal(transcriptRetryDelayMs(2, 'garbage'), 1000);
});

test('a 429 is retried with backoff and then succeeds', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls < 3) return new Response('', { status: 429 });
    return jsonResponse({ content: [{ text: 'hello world' }] });
  };
  const result = await fetchTranscript('https://youtu.be/x', { fetchImpl, sleep: noSleep, maxAttempts: 3 });
  assert.equal(result.text, 'hello world');
  assert.equal(calls, 3);
});

test('a persistent 429 gives up after maxAttempts', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response('', { status: 429 });
  };
  await assert.rejects(
    fetchTranscript('https://youtu.be/x', { fetchImpl, sleep: noSleep, maxAttempts: 3 }),
    /429/,
  );
  assert.equal(calls, 3);
});

test('a non-429 error is not retried', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response('', { status: 500 });
  };
  await assert.rejects(
    fetchTranscript('https://youtu.be/x', { fetchImpl, sleep: noSleep, maxAttempts: 3 }),
    /500/,
  );
  assert.equal(calls, 1);
});
