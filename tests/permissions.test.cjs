// The credential boundary, and the permissions a custom endpoint needs.
//
// Two things are being pinned here. First, that the panel — which runs inside
// YouTube's own page — can learn only what it renders: four display
// preferences and one boolean. A regression that widens this payload hands
// every provider key to the page. Second, that a custom endpoint is validated
// and scoped before it is saved, because it is the one address the manifest
// cannot declare in advance.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const noop = () => {};
const state = {};                 // stands in for chrome.storage.local
const messageListeners = [];
const storageListeners = [];
const sentToTabs = [];
let openTabs = [];
let accessLevel = null;
let badgeText = null;

globalThis.chrome = {
  runtime: {
    onInstalled: { addListener: noop },
    onStartup: { addListener: noop },
    onMessage: { addListener: (fn) => messageListeners.push(fn) },
    getURL: (p) => p,
    lastError: null
  },
  action: {
    setBadgeText: async ({ text }) => { badgeText = text; },
    setBadgeBackgroundColor: async () => {}
  },
  storage: {
    local: {
      get: async (keys) => {
        if (!keys) return { ...state };
        const wanted = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(wanted.filter((k) => k in state).map((k) => [k, state[k]]));
      },
      set: async (obj) => { Object.assign(state, obj); },
      setAccessLevel: async (options) => { accessLevel = options.accessLevel; }
    },
    onChanged: { addListener: (fn) => storageListeners.push(fn) }
  },
  tabs: {
    create: noop,
    query: async () => openTabs,
    get: async () => ({}),
    sendMessage: async (tabId, message) => { sentToTabs.push({ tabId, message }); },
    onUpdated: { addListener: noop },
    onRemoved: { addListener: noop }
  },
  permissions: { contains: async () => true }
};

const load = (rel) => import(path.join(__dirname, rel));
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const reset = () => {
  for (const key of Object.keys(state)) delete state[key];
  sentToTabs.length = 0;
  openTabs = [];
  badgeText = null;
};

// A message as Chrome delivers it from the panel: top frame of a YouTube tab.
const panelSender = { tab: { id: 7 }, frameId: 0, url: 'https://www.youtube.com/watch?v=abc' };

// Dispatch to the service worker's own onMessage listener and wait for whatever
// it answers. `undefined` means it declined to answer at all.
async function send(message, sender = panelSender) {
  await load('../background/service-worker.js');
  return new Promise((resolve) => {
    let answered = false;
    const respond = (value) => { answered = true; resolve(value); };
    const keepsPortOpen = messageListeners[0](message, sender, respond);
    if (keepsPortOpen !== true && !answered) resolve(undefined);
  });
}

test('the settings store is closed to page contexts', async () => {
  await load('../background/service-worker.js');
  await flush();
  assert.equal(accessLevel, 'TRUSTED_CONTEXTS');
});

test('the panel is told what it renders and nothing else', async () => {
  reset();
  Object.assign(state, {
    GEMINI_API_KEY: 'secret-gemini', ANTHROPIC_API_KEY: 'secret-anthropic',
    SUMMARY_LENGTH: 'brief', THEME_PREF: 'dark', PANEL_SKIN: 'classic',
    SELECTED_MODEL: 'anthropic'
  });

  const prefs = await send({ action: 'GET_PANEL_PREFS' });

  assert.deepEqual(Object.keys(prefs).sort(),
    ['providerReady', 'skin', 'summaryLength', 'theme']);
  assert.deepEqual(prefs, {
    summaryLength: 'brief', theme: 'dark', skin: 'classic', providerReady: true
  });
  // Which provider is configured is not the panel's business, and neither is
  // any key: no value anywhere in the payload is a stored secret.
  assert.ok(!JSON.stringify(prefs).includes('anthropic'));
  assert.ok(!JSON.stringify(prefs).includes('secret'));
});

test('provider readiness covers a keyless local custom provider', async () => {
  reset();
  assert.equal((await send({ action: 'GET_PANEL_PREFS' })).providerReady, false);

  Object.assign(state, {
    CUSTOM_PROVIDERS: [{
      id: 'custom_1', name: 'Local', isCustom: true,
      storageKey: 'CUSTOM_CUSTOM_1_API_KEY',
      endpoint: 'http://localhost:1234/v1/chat/completions'
    }],
    CUSTOM_CUSTOM_1_API_KEY: ''
  });
  assert.equal((await send({ action: 'GET_PANEL_PREFS' })).providerReady, true);
});

test('a page that is not the panel gets no answer', async () => {
  reset();
  state.GEMINI_API_KEY = 'secret';
  const senders = [
    { tab: { id: 7 }, frameId: 0, url: 'https://example.com/' },
    { tab: { id: 7 }, frameId: 3, url: 'https://www.youtube.com/watch?v=abc' },
    { frameId: 0, url: 'https://www.youtube.com/watch?v=abc' }
  ];
  for (const sender of senders) {
    assert.equal(await send({ action: 'GET_PANEL_PREFS' }, sender), undefined);
  }
});

test('the panel may write one preference, by name and by value', async () => {
  reset();

  await send({ action: 'SET_PANEL_PREF', name: 'summaryLength', value: 'detailed' });
  await flush();
  assert.equal(state.SUMMARY_LENGTH, 'detailed');

  // Not writable: another key entirely, a raw storage key, an unsupported value.
  await send({ action: 'SET_PANEL_PREF', name: 'GEMINI_API_KEY', value: 'injected' });
  await send({ action: 'SET_PANEL_PREF', name: 'SUMMARY_LENGTH', value: 'brief' });
  await send({ action: 'SET_PANEL_PREF', name: 'summaryLength', value: 'exhaustive' });
  await send({ action: 'SET_PANEL_PREF', name: 'summaryLength', value: { toString: () => 'brief' } });
  await send({ action: 'SET_PANEL_PREF', name: 'constructor', value: 'brief' });
  await send({ action: 'SET_PANEL_PREF', name: '__proto__', value: 'brief' });
  await flush();
  assert.equal(state.GEMINI_API_KEY, undefined);
  assert.equal(state.SUMMARY_LENGTH, 'detailed');

  // And not from the page next door.
  await send({ action: 'SET_PANEL_PREF', name: 'summaryLength', value: 'brief' },
    { tab: { id: 7 }, frameId: 0, url: 'https://example.com/' });
  await flush();
  assert.equal(state.SUMMARY_LENGTH, 'detailed');
});

test('saving a key elsewhere reaches open panels without carrying the key', async () => {
  reset();
  await load('../background/service-worker.js');
  openTabs = [{ id: 11 }, { id: 12 }];
  state.GEMINI_API_KEY = 'secret-gemini';

  storageListeners.forEach((fn) => fn({ GEMINI_API_KEY: { newValue: 'secret-gemini' } }, 'local'));
  await flush();
  await flush();

  assert.deepEqual(sentToTabs.map((entry) => entry.tabId), [11, 12]);
  assert.equal(sentToTabs[0].message.action, 'PREFS_CHANGED');
  assert.equal(sentToTabs[0].message.prefs.providerReady, true);
  assert.ok(!JSON.stringify(sentToTabs[0].message).includes('secret'));

  // An unrelated write is not worth waking every tab for.
  sentToTabs.length = 0;
  storageListeners.forEach((fn) => fn({ SECONDS_SAVED: { newValue: 42 } }, 'local'));
  await flush();
  assert.equal(sentToTabs.length, 0);
});

test('a custom endpoint is normalized to https and scoped to its own origin', async () => {
  const { normalizeEndpoint, endpointOrigin } = await load('../scripts/providers.js');

  assert.deepEqual(normalizeEndpoint('api.example.com/v1/chat/completions'), {
    url: 'https://api.example.com/v1/chat/completions',
    origin: 'https://api.example.com/*'
  });
  assert.equal(normalizeEndpoint('  https://api.example.com/v1  ').origin, 'https://api.example.com/*');
  // The port is part of the origin, so a local server gets a pattern of its own.
  assert.equal(normalizeEndpoint('http://localhost:1234/v1/chat/completions').origin,
    'http://localhost:1234/*');
  assert.equal(normalizeEndpoint('http://127.0.0.1:8080/v1').origin, 'http://127.0.0.1:8080/*');
  // "host:port/path" with no scheme is a host and a port, not a scheme.
  assert.equal(normalizeEndpoint('localhost:1234/v1').origin, 'https://localhost:1234/*');

  // A remote endpoint over plain http would carry the key and the transcript in
  // the clear; only loopback is exempt.
  assert.match(normalizeEndpoint('http://api.example.com/v1').error, /https/);
  assert.match(normalizeEndpoint('http://evil.localhost.example.com/v1').error, /https/);
  assert.ok(normalizeEndpoint('ftp://api.example.com/v1').error);
  assert.ok(normalizeEndpoint('   ').error);
  assert.ok(normalizeEndpoint('https://').error);

  // Built-in providers are declared in the manifest and need no runtime grant.
  const { PROVIDERS } = await load('../scripts/providers.js');
  assert.equal(endpointOrigin(PROVIDERS.gemini), null);
  assert.equal(endpointOrigin({ isCustom: true, endpoint: 'https://api.example.com/v1/x' }),
    'https://api.example.com/*');
  assert.equal(endpointOrigin({ isCustom: true, endpoint: 'not a url' }), null);
});

test('the toolbar badge marks an extension that cannot work yet', async () => {
  reset();
  await load('../background/service-worker.js');
  const change = () => storageListeners[0]({ GEMINI_API_KEY: {} }, 'local');

  // Nothing configured: the badge is the one honest signal that this extension
  // cannot do anything at all yet.
  change();
  await flush();
  assert.equal(badgeText, '!');

  state.GEMINI_API_KEY = 'secret-gemini';
  change();
  await flush();
  assert.equal(badgeText, '');

  // Removing the key puts it back: readiness is derived, never remembered.
  delete state.GEMINI_API_KEY;
  change();
  await flush();
  assert.equal(badgeText, '!');
});

test('a keyless local custom provider clears the badge too', async () => {
  reset();
  await load('../background/service-worker.js');
  Object.assign(state, {
    CUSTOM_PROVIDERS: [{
      id: 'custom_1', name: 'Local', isCustom: true,
      storageKey: 'CUSTOM_CUSTOM_1_API_KEY',
      endpoint: 'http://localhost:1234/v1/chat/completions'
    }],
    CUSTOM_CUSTOM_1_API_KEY: ''
  });
  storageListeners[0]({ CUSTOM_PROVIDERS: {} }, 'local');
  await flush();
  assert.equal(badgeText, '');
});
