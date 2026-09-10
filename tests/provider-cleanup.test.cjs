// What a provider leaves behind when it stops being built in.
//
// Dropping an entry from the PROVIDERS registry is a one-line edit with two
// consequences that outlive it in the user's storage: an API key nothing can
// read and no settings card can delete, and a `SELECTED_MODEL` naming an id
// that no longer resolves — which fails every generation with "Unknown
// provider" rather than falling back. These pin the cleanup that runs on
// update, and that it leaves a working setup alone.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const noop = () => {};
const state = {};                 // stands in for chrome.storage.local
const installListeners = [];

globalThis.chrome = {
  runtime: {
    onInstalled: { addListener: (fn) => installListeners.push(fn) },
    onStartup: { addListener: noop },
    onMessage: { addListener: noop },
    getURL: (p) => p,
    lastError: null
  },
  action: {
    setBadgeText: async () => {},
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
      remove: async (keys) => {
        for (const key of (Array.isArray(keys) ? keys : [keys])) delete state[key];
      },
      setAccessLevel: async () => {}
    },
    onChanged: { addListener: noop }
  },
  tabs: {
    create: noop, query: async () => [], get: async () => ({}), sendMessage: async () => {},
    onUpdated: { addListener: noop }, onRemoved: { addListener: noop }
  },
  permissions: { contains: async () => true }
};

const load = (rel) => import(path.join(__dirname, rel));
const reset = () => { for (const key of Object.keys(state)) delete state[key]; };

// Chrome fires onInstalled on update; the cleanup hangs off it. Awaiting the
// listener is enough because every write it makes is awaited inside it.
async function runUpdate() {
  await load('../background/service-worker.js');
  await installListeners[0]({ reason: 'update' });
}

test('a removed provider is no longer in the registry', async () => {
  const { PROVIDERS, REMOVED_PROVIDERS } = await load('../scripts/providers.js');
  for (const removed of REMOVED_PROVIDERS) {
    assert.ok(!PROVIDERS[removed.id],
      `${removed.id} is listed as removed but is still a built-in provider`);
  }
});

test('the key and model a removed provider left behind are cleared on update', async () => {
  reset();
  Object.assign(state, {
    MISTRAL_API_KEY: 'secret-mistral',
    mistral_MODEL: 'mistral-large-latest',
    GEMINI_API_KEY: 'secret-gemini',
    gemini_MODEL: 'gemini-flash-lite-latest'
  });

  await runUpdate();

  assert.ok(!('MISTRAL_API_KEY' in state), 'the orphaned key must not survive the update');
  assert.ok(!('mistral_MODEL' in state));
  // A provider that is still built in is none of the cleanup's business.
  assert.equal(state.GEMINI_API_KEY, 'secret-gemini');
  assert.equal(state.gemini_MODEL, 'gemini-flash-lite-latest');
});

test('a selection naming a removed provider falls back to auto', async () => {
  reset();
  Object.assign(state, { GEMINI_API_KEY: 'secret-gemini', SELECTED_MODEL: 'mistral' });

  await runUpdate();

  // Left alone this is not dead weight but a break: the id no longer resolves,
  // so every generation would fail with "Unknown provider".
  assert.equal(state.SELECTED_MODEL, 'auto');
});

test('a selection naming a provider that is still built in is left alone', async () => {
  reset();
  Object.assign(state, { ANTHROPIC_API_KEY: 'secret-anthropic', SELECTED_MODEL: 'anthropic' });

  await runUpdate();

  assert.equal(state.SELECTED_MODEL, 'anthropic');
});

test('a profile with nothing to clean is not written to', async () => {
  reset();
  Object.assign(state, { GEMINI_API_KEY: 'secret-gemini' });
  const writes = [];
  const { set, remove } = chrome.storage.local;
  chrome.storage.local.set = async (obj) => { writes.push(obj); return set(obj); };
  chrome.storage.local.remove = async (keys) => { writes.push(keys); return remove(keys); };

  try {
    await runUpdate();
  } finally {
    Object.assign(chrome.storage.local, { set, remove });
  }

  assert.deepEqual(writes, [], 'a fresh install has no residue and needs no write');
});
