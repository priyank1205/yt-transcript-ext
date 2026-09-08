const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const readerSource = fs.readFileSync(path.join(__dirname, '../scripts/caption-reader.js'), 'utf8')
  .replace(/^export /gm, '');
const engineSource = fs.readFileSync(path.join(__dirname, '../scripts/transcript-engine.js'), 'utf8');
const id = 'fixture';
const track = (lang = 'en', extra = {}) => ({
  languageCode: lang, kind: 'asr', vssId: `a.${lang}`,
  baseUrl: `https://www.youtube.com/api/timedtext?v=${id}&lang=${lang}&signature=test`, ...extra
});
const payload = { events: [{ tStartMs: 1234, segs: [{ utf8: 'Hello ' }, { utf8: 'world' }] }] };
const reply = (body = payload, ok = true) => ({ ok, text: async () => typeof body === 'string' ? body : JSON.stringify(body) });

function setup({ tracks = [track()], resources = [], selected, video = id, initial, fetch, isLive = false } = {}) {
  const calls = [];
  const listeners = new Map();
  const response = {
    videoDetails: { videoId: video, isLive },
    captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks } }
  };
  const location = new URL(`https://www.youtube.com/watch?v=${id}`);
  const context = vm.createContext({
    URL, URLSearchParams, AbortController, setTimeout, clearTimeout, console, location,
    window: {
      location, ytInitialPlayerResponse: initial,
      addEventListener: (name, fn) => listeners.set(name, fn),
      removeEventListener: name => listeners.delete(name)
    },
    document: { getElementById: () => ({ getPlayerResponse: () => response, getOption: () => selected }) },
    performance: { getEntriesByType: () => resources.map(name => ({ name })) },
    fetch: async (...args) => { calls.push(args); return fetch ? fetch(...args) : reply(); }
  });
  vm.runInContext(readerSource, context);
  return { context, calls, listeners, response, read: () => context.readPlayerCaptions(id) };
}

test('ASR words become the existing timestamped transcript format without new permissions', async () => {
  const env = setup();
  const result = await env.read();
  assert.equal(result.data, '[0:01] Hello world\n');
  assert.equal(env.calls[0][1].credentials, 'include');
  assert.equal(env.calls[0][1].redirect, 'error');
  assert.equal(new URL(env.calls[0][0]).searchParams.get('signature'), 'test');
  assert.equal(env.listeners.size, 0);
});

test('sorts cues, ignores formatting/invalid events, preserves repetitions at different times and hour timestamps', async () => {
  const env = setup({ fetch: async () => reply({ events: [
    { tStartMs: 3661999, segs: [{ utf8: 'Again' }] },
    { tStartMs: 1000, segs: [{ utf8: 'Again' }] },
    { tStartMs: 1000, segs: [{ utf8: 'Again' }] },
    { tStartMs: 0, wpWinPosId: 1 },
    { tStartMs: 100, segs: [{ utf8: '\n' }] },
    { tStartMs: -1, segs: [{ utf8: 'invalid' }] },
    { segs: [{ utf8: 'missing timestamp' }] }
  ] }) });
  assert.equal((await env.read()).data, '[0:01] Again\n[1:01:01] Again\n');
});

test('replays a player caption URL with its session parameters intact', async () => {
  const url = `${track().baseUrl}&pot=session-token&potc=1&fmt=json3&c=WEB`;
  const env = setup({ resources: [url] });
  assert.equal((await env.read()).success, true);
  assert.equal(env.calls[0][0], url);
});

test('rejects other videos, other origins, non-caption URLs and segmented live resources', async () => {
  const env = setup({ tracks: [], resources: [
    'https://www.youtube.com/api/timedtext?v=other&lang=en',
    'https://example.com/api/timedtext?v=fixture',
    'https://www.youtube.com/api/player?v=fixture',
    `${track().baseUrl}&seq=3`, `${track().baseUrl}&sq=3`
  ] });
  assert.equal((await env.read()).success, false);
  assert.equal(env.calls.length, 0);
});

test('stale player metadata cannot provide a different video transcript', async () => {
  const env = setup({ video: 'previous' });
  assert.equal((await env.read()).success, false);
  assert.equal(env.calls.length, 0);
});

test('matching initial metadata works when the live player response is unavailable', async () => {
  const env = setup({ video: 'previous', initial: {
    videoDetails: { videoId: id }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [track()] } }
  } });
  assert.equal((await env.read()).success, true);
});

test('uses the selected caption language before other tracks', async () => {
  const env = setup({ tracks: [track('en'), track('hi')], selected: { vssId: 'a.hi' } });
  await env.read();
  assert.equal(new URL(env.calls[0][0]).searchParams.get('lang'), 'hi');
});

test('uses the default audio caption track when none is selected', async () => {
  const env = setup({ tracks: [track('en'), track('hi')] });
  env.response.captions.playerCaptionsTracklistRenderer.audioTracks = [{ defaultCaptionTrackIndex: 1 }];
  await env.read();
  assert.equal(new URL(env.calls[0][0]).searchParams.get('lang'), 'hi');
});

test('retries another track after an empty or blocked response', async () => {
  let attempts = 0;
  const env = setup({ tracks: [track('en'), track('hi'), track('de')], fetch: async () => {
    attempts++;
    if (attempts === 1) return reply('', false);
    if (attempts === 2) return reply({ events: [] });
    return reply();
  } });
  assert.equal((await env.read()).success, true);
  assert.equal(attempts, 3);
});

test('empty or malformed captions do not produce a successful empty summary', async () => {
  for (const body of ['{invalid', '{}', '{"events":[]}']) {
    const env = setup({ fetch: async () => reply(body) });
    const result = await env.read();
    assert.equal(result.success, false);
    assert.match(result.error, /refresh/i);
    assert.equal(env.listeners.size, 0);
  }
});

test('navigation while captions are loading discards the response and cleans up', async () => {
  const env = setup({ fetch: async () => {
    env.listeners.get('yt-navigate-start')();
    return reply();
  } });
  const result = await env.read();
  assert.equal(result.success, false);
  assert.match(result.error, /Video changed/);
  assert.equal(env.listeners.size, 0);
});

test('active live streams cannot masquerade as full-video captions', async () => {
  const env = setup({ isLive: true });
  assert.equal((await env.read()).success, false);
  assert.equal(env.calls.length, 0);
});

test('network timeout aborts requests and returns a retryable failure', async () => {
  const env = setup({ fetch: async (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('aborted')));
  }) });
  env.context.setTimeout = fn => setTimeout(fn, 1);
  assert.equal((await env.read()).success, false);
});

function captionsEnv(tabUrl = `https://www.youtube.com/watch?v=${id}`) {
  const env = setup();
  env.injection = null;
  env.context.chrome = {
    scripting: { executeScript: async spec => {
      env.injection = spec;
      return [{ result: { success: true, data: '[0:01] Hello\n' } }];
    } },
    tabs: { get: async tabId => {
      if (tabId !== 42) throw new Error('No tab with that id');
      return { id: 42, url: tabUrl };
    } }
  };
  return env;
}

test('service worker injects only into the requesting YouTube main frame', async () => {
  const env = captionsEnv();
  const sender = { tab: { id: 42 }, frameId: 0, url: `https://www.youtube.com/watch?v=${id}` };
  assert.equal((await env.context.getPlayerCaptions({ videoId: id, tabId: 999 }, sender)).success, true);
  assert.equal(env.injection.target.tabId, 42);
  assert.equal(env.injection.world, 'MAIN');
  assert.equal(env.injection.args[0], id);
  for (const invalid of [
    { ...sender, frameId: 1 }, { ...sender, tab: undefined },
    { ...sender, url: `https://youtube.com.evil.test/watch?v=${id}` },
    { ...sender, tab: { id: 7 } }
  ]) {
    env.injection = null;
    assert.equal((await env.context.getPlayerCaptions({ videoId: id }, invalid)).success, false);
    assert.equal(env.injection, null);
  }
});

test('the tab decides which video is current, not the message sender', async () => {
  // YouTube changes videos in the page, so sender.url still names the video the
  // tab was opened on. The request must be judged against the tab's real URL:
  // trusting sender.url refused every generation after an in-page navigation.
  const arrivedOn = { tab: { id: 42 }, frameId: 0, url: 'https://www.youtube.com/watch?v=arrived-on' };
  const current = captionsEnv();
  assert.equal((await current.context.getPlayerCaptions({ videoId: id }, arrivedOn)).success, true);
  assert.equal(current.injection.args[0], id);

  const movedOn = captionsEnv('https://www.youtube.com/watch?v=somewhere-else');
  assert.equal((await movedOn.context.getPlayerCaptions({ videoId: id }, arrivedOn)).code, 'video_changed');
  assert.equal(movedOn.injection, null);

  const offWatch = captionsEnv('https://www.youtube.com/feed/subscriptions');
  assert.equal((await offWatch.context.getPlayerCaptions({ videoId: id }, arrivedOn)).code, 'video_changed');
  assert.equal(offWatch.injection, null);
});

function engine() {
  const context = vm.createContext({ URLSearchParams, console, setTimeout, clearTimeout,
    window: { location: { search: '?v=fixture' } }, document: {
      querySelector: () => null, querySelectorAll: () => []
    }, chrome: { runtime: { sendMessage: async () => ({ success: true, data: '[0:01] Caption fallback\n' }) } }
  });
  vm.runInContext(engineSource, context);
  return context;
}

for (const type of ['new', 'old']) {
  test(`existing ${type} transcript extraction bypasses captions and preserves output`, async () => {
    const env = engine();
    const segment = { closest: () => null, parentElement: null, querySelector: selector => ({
      textContent: /Timestamp|timestamp/.test(selector) ? '2:34' : 'Original transcript'
    }) };
    env.document.querySelectorAll = selector => selector === (type === 'new'
      ? 'transcript-segment-view-model' : 'ytd-transcript-segment-renderer') ? [segment] : [];
    env.chrome.runtime.sendMessage = () => { assert.fail('Caption fallback must not run'); };
    assert.equal((await env.extractTranscript()).data, '[2:34] Original transcript\n');
  });
}

test('a missing transcript button uses caption fallback', async () => {
  const env = engine();
  let request;
  env.chrome.runtime.sendMessage = async message => {
    request = message;
    return { success: true, data: '[0:01] Captions\n' };
  };
  assert.equal((await env.extractTranscript()).data, '[0:01] Captions\n');
  assert.equal(request.action, 'GET_PLAYER_CAPTIONS');
  assert.equal(request.videoId, id);
});

test('an unparseable panel uses captions rather than silently returning empty text', async () => {
  const env = engine();
  env.document.querySelectorAll = selector => selector === 'transcript-segment-view-model'
    ? [{ closest: () => null, parentElement: null, querySelector: () => null }] : [];
  assert.equal((await env.extractTranscript()).data, '[0:01] Caption fallback\n');
});

test('a panel that opens but never populates is closed before caption fallback', async () => {
  const env = engine();
  const actions = [];
  env.findTranscriptButton = () => ({ click: () => actions.push('open') });
  env.waitForTranscriptSegments = async () => null;
  env.logPanelDiagnostics = () => {};
  env.closeTranscriptPanel = () => actions.push('close');
  env.chrome.runtime.sendMessage = async () => { actions.push('captions'); return { success: true, data: 'captions' }; };
  assert.equal((await env.extractTranscript()).success, true);
  assert.deepEqual(actions, ['open', 'close', 'captions']);
});

test('an extraction the page has moved on from stops without touching the panel', async () => {
  // Clicking through to another video mid-extraction leaves this run orphaned.
  // It must not go on to close the panel, because by then the panel on screen
  // is the one the *new* video's extraction just opened.
  const env = engine();
  const actions = [];
  env.findTranscriptButton = () => ({ click: () => {
    actions.push('open');
    env.window.location.search = '?v=next';
  } });
  env.closeTranscriptPanel = () => actions.push('close');
  env.chrome.runtime.sendMessage = async () => { actions.push('captions'); return { success: true, data: 'captions' }; };
  assert.match((await env.extractTranscript(id)).error, /Video changed/);
  assert.deepEqual(actions, ['open']);
});

test('navigation during fallback discards data before it reaches the summarizer', async () => {
  const env = engine();
  env.chrome.runtime.sendMessage = async () => {
    env.window.location.search = '?v=next';
    return { success: true, data: 'wrong video' };
  };
  assert.match((await env.extractTranscript()).error, /Video changed/);
});

test('uses captured player response even when every replay would fail', async () => {
  const env = setup({ fetch: async () => { assert.fail('Must use original response without refetching'); } });
  env.context.window[Symbol.for('yt-transcript-ext.caption-capture')] = {
    read: () => [{ videoId: id, languageCode: 'en', body: JSON.stringify(payload) }]
  };
  assert.equal((await env.read()).data, '[0:01] Hello world\n');
  assert.equal(env.calls.length, 0);
});

test('captured captions work without caption metadata or resource timing entries', async () => {
  const env = setup({ tracks: [] });
  env.context.window[Symbol.for('yt-transcript-ext.caption-capture')] = {
    read: () => [{ videoId: id, body: JSON.stringify(payload) }]
  };
  assert.equal((await env.read()).success, true);
  assert.equal(env.calls.length, 0);
});

test('ignores captured responses from other videos and malformed bodies', async () => {
  const env = setup();
  env.context.window[Symbol.for('yt-transcript-ext.caption-capture')] = {
    read: () => [{ videoId: 'other', body: JSON.stringify(payload) }, { videoId: id, body: '{invalid' }]
  };
  assert.equal((await env.read()).success, true);
  assert.equal(env.calls.length, 1);
});

test('uses captions arriving during failed URL requests', async () => {
  const entries = [];
  const env = setup({ fetch: async () => {
    entries.push({ videoId: id, body: JSON.stringify(payload) });
    return reply('', false);
  } });
  env.context.window[Symbol.for('yt-transcript-ext.caption-capture')] = { read: () => entries };
  assert.equal((await env.read()).success, true);
});
