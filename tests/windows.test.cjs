// Windowed generation: how a long video is split, and how the parts are run.
//
// The ordering test is the important one. Parts now finish in whatever order
// the network returns them, while the joined summary has to be in the video's
// order — a mistake there produces a summary that validates fine and reads as
// nonsense.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// The service worker registers chrome listeners at import time.
const noop = () => {};
globalThis.chrome = globalThis.chrome || {
  runtime: { onInstalled: { addListener: noop }, onStartup: { addListener: noop },
             onMessage: { addListener: noop }, getURL: (p) => p, lastError: null },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener: noop } },
  tabs: { create: noop, sendMessage: async () => {}, onUpdated: { addListener: noop }, onRemoved: { addListener: noop } },
  webNavigation: { onHistoryStateUpdated: { addListener: noop } }
};

const load = (rel) => import(path.join(__dirname, rel));

function buildTranscript(spanSeconds, step = 3) {
  const label = (t) => {
    const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = String(t % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${String(m).padStart(2, '0')}:${s}`;
  };
  const lines = [];
  for (let t = 0; t <= spanSeconds; t += step) lines.push(`[${label(t)}] words at ${t}`);
  return lines.join('\n') + '\n';
}

test('a video under the threshold stays a single request', async () => {
  const { planWindows } = await load('../scripts/transcript-windows.js');
  const { parseTranscriptCues } = await load('../scripts/summary-validator.js');
  const transcript = buildTranscript(60 * 60);
  assert.deepEqual(planWindows(transcript, parseTranscriptCues(transcript)), []);
});

test('a long video splits into ordered, disjoint windows covering every cue', async () => {
  const { planWindows } = await load('../scripts/transcript-windows.js');
  const { parseTranscriptCues } = await load('../scripts/summary-validator.js');

  const transcript = buildTranscript(5 * 3600 + 4 * 60);
  const cues = parseTranscriptCues(transcript);
  const windows = planWindows(transcript, cues);

  assert.ok(windows.length >= 6, `expected several windows, got ${windows.length}`);

  const seen = windows.flatMap((w) => parseTranscriptCues(w.transcript));
  assert.equal(seen.length, cues.length, 'no cue may be lost between windows');
  assert.equal(seen[0].seconds, cues[0].seconds);
  assert.equal(seen.at(-1).seconds, cues.at(-1).seconds);
  for (let i = 1; i < seen.length; i++) {
    assert.ok(seen[i].seconds > seen[i - 1].seconds, 'windows must not overlap or reorder');
  }
});

test('parts are joined in video order even when they finish out of order', async () => {
  const { generateWindowed } = await load('../background/service-worker.js');

  const windows = [1, 2, 3, 4, 5, 6, 7].map((n) => ({
    index: n, count: 7, transcript: `part ${n}`, durationMinutes: 43
  }));

  // Later parts return first, which is what an unordered append would expose.
  const client = {
    callAPI: async (_key, transcript) => {
      const n = Number(transcript.split(' ')[1]);
      await new Promise((r) => setTimeout(r, (8 - n) * 12));
      return { text: '```\n#Part ' + n + '\n[00:0' + n + '] - T: d.\n```', finishReason: 'stop' };
    }
  };

  const result = await generateWindowed(client, 'k', windows, {}, async () => {}, () => false);
  const order = [...result.text.matchAll(/#Part (\d)/g)].map((m) => Number(m[1]));
  assert.deepEqual(order, [1, 2, 3, 4, 5, 6, 7]);
  assert.ok(!result.text.includes('```'), 'per-part fences must be stripped before joining');
});

test('no more than four window requests are in flight at once', async () => {
  const { generateWindowed } = await load('../background/service-worker.js');

  let inFlight = 0;
  let peak = 0;
  const client = {
    callAPI: async () => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight--;
      return { text: '[00:01] - T: d.', finishReason: 'stop' };
    }
  };

  const windows = Array.from({ length: 9 }, (_, i) => ({
    index: i + 1, count: 9, transcript: `part ${i}`, durationMinutes: 43
  }));

  await generateWindowed(client, 'k', windows, {}, async () => {}, () => false);
  assert.ok(peak > 1, 'parts should run in parallel, not one at a time');
  assert.ok(peak <= 4, `concurrency should stay bounded, peaked at ${peak}`);
});

test('a rate-limited part is retried; a rejected key is not', async () => {
  const { generateWindowed } = await load('../background/service-worker.js');
  const { apiError, ERROR_CODES } = await load('../scripts/errors.js');

  let attempts = 0;
  const flaky = {
    callAPI: async () => {
      if (++attempts === 1) throw apiError(ERROR_CODES.RATE_LIMIT, 'slow down', 429);
      return { text: '[00:01] - T: d.', finishReason: 'stop' };
    }
  };
  const windows = [{ index: 1, count: 2, transcript: 'a', durationMinutes: 43 },
                   { index: 2, count: 2, transcript: 'b', durationMinutes: 43 }];

  const ok = await generateWindowed(flaky, 'k', windows, {}, async () => {}, () => false);
  assert.ok(ok.text.includes('T: d.'));
  assert.equal(attempts, 3, 'one retry plus the two successful calls');

  let authAttempts = 0;
  const rejected = {
    callAPI: async () => { authAttempts++; throw apiError(ERROR_CODES.AUTH, 'bad key', 401); }
  };
  await assert.rejects(
    () => generateWindowed(rejected, 'k', windows, {}, async () => {}, () => false),
    /bad key/
  );
  assert.ok(authAttempts <= windows.length, 'a rejected key must not be retried');
});

test('a truncated part fails the run rather than joining in half-written', async () => {
  const { generateWindowed } = await load('../background/service-worker.js');
  const client = {
    callAPI: async (_k, transcript) => ({
      text: '[00:01] - T: d.',
      finishReason: transcript === 'b' ? 'length' : 'stop'
    })
  };
  const windows = [{ index: 1, count: 2, transcript: 'a', durationMinutes: 43 },
                   { index: 2, count: 2, transcript: 'b', durationMinutes: 43 }];

  await assert.rejects(
    () => generateWindowed(client, 'k', windows, {}, async () => {}, () => false),
    /output limit/
  );
});

test('progress counts completed parts', async () => {
  const { generateWindowed } = await load('../background/service-worker.js');
  const seen = [];
  const client = { callAPI: async () => ({ text: '[00:01] - T: d.', finishReason: 'stop' }) };
  const windows = [1, 2, 3].map((n) => ({ index: n, count: 3, transcript: `p${n}`, durationMinutes: 43 }));

  await generateWindowed(client, 'k', windows, {}, async (m) => seen.push(m), () => false);
  assert.equal(seen[0], 'Generating summary... 0/3 parts');
  assert.equal(seen.at(-1), 'Generating summary... 3/3 parts');
});
