// tests/key-validation.test.cjs
//
// Keys used to be validated by sending a real completion request. That made a
// working key the *slow* case (it waited for an actual generation while a bad
// key failed auth instantly), it billed the user for the privilege, and it
// conflated two separate questions — so a perfectly good key on a tier that
// cannot reach the provider's flagship model was reported as a key the provider
// had rejected.
//
// Validation now asks for a model listing first. These tests pin that down.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const load = (mod) => import(path.join(__dirname, '..', mod));

// A stand-in for any OpenAI-compatible provider: the client under test reads
// nothing from it but the endpoint and the model it was asked about.
const COMPAT = {
  id: 'compat',
  name: 'Compatible Provider',
  endpoint: 'https://api.example.invalid/v1/chat/completions',
  defaultModel: 'flagship-large'
};

// Records every request so a test can assert what was *not* sent.
function stubFetch(handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET' });
    return handler(String(url), init);
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const listing = (ids) => ({ ok: true, json: async () => ({ data: ids.map((id) => ({ id })) }) });

test('a working key is validated by listing, without paying for a generation', async () => {
  const { OpenAICompatibleClient } = await load('scripts/openai-compatible-client.js');
  const stub = stubFetch(async (url) => {
    if (url.endsWith('/v1/models')) return listing(['flagship-large', 'flagship-small']);
    throw new Error('validation must not call the completions endpoint');
  });
  try {
    const result = await new OpenAICompatibleClient(COMPAT).validateKey('k', 'flagship-large');
    assert.equal(result.status, 'valid');
    assert.deepEqual(stub.calls.map((c) => c.method), ['GET']);
    assert.ok(!stub.calls.some((c) => c.url.includes('chat/completions')));
  } finally { stub.restore(); }
});

test('a good key whose model is off-plan is not reported as a rejected key', async () => {
  const { OpenAICompatibleClient } = await load('scripts/openai-compatible-client.js');
  // What a key on a restricted tier actually sees: no `flagship-large`.
  const stub = stubFetch(async (url) => {
    if (url.endsWith('/v1/models')) return listing(['flagship-small', 'open-7b']);
    throw new Error('validation must not call the completions endpoint');
  });
  try {
    const result = await new OpenAICompatibleClient(COMPAT).validateKey('k', 'flagship-large');
    assert.equal(result.status, 'model_unavailable');
    // The caller needs the reachable models to pick a replacement, which is what
    // turns this from a dead end into a working setup.
    assert.deepEqual(result.models.map((m) => m.id), ['flagship-small', 'open-7b']);
  } finally { stub.restore(); }
});

test('a key the provider refuses is still reported as invalid', async () => {
  const { OpenAICompatibleClient } = await load('scripts/openai-compatible-client.js');
  const stub = stubFetch(async () => ({ ok: false, status: 401, text: async () => 'Unauthorized' }));
  try {
    const result = await new OpenAICompatibleClient(COMPAT).validateKey('bad', 'flagship-large');
    assert.equal(result.status, 'invalid');
  } finally { stub.restore(); }
});

test('an endpoint that serves no model list falls back to the probe', async () => {
  const { OpenAICompatibleClient } = await load('scripts/openai-compatible-client.js');
  const local = { id: 'c1', name: 'Local', endpoint: 'http://localhost:1234/v1/chat/completions', defaultModel: 'llama' };
  const stub = stubFetch(async (url) => {
    if (url.endsWith('/v1/models')) return { ok: false, status: 404, text: async () => 'not found' };
    return { ok: true, json: async () => ({}) };   // the completions probe answers
  });
  try {
    const result = await new OpenAICompatibleClient(local).validateKey('k', 'llama');
    assert.equal(result.status, 'valid');
    assert.ok(stub.calls.some((c) => c.url.includes('chat/completions')),
      'the probe is the fallback and must still run when no list is available');
  } finally { stub.restore(); }
});

test('Gemini validates against its listing rather than generating text', async () => {
  const { GeminiClient } = await load('scripts/gemini-client.js');
  const stub = stubFetch(async (url) => {
    if (url.includes('/models?')) {
      return { ok: true, json: async () => ({ models: [
        { name: 'models/gemini-2.0-flash', displayName: 'Flash', supportedGenerationMethods: ['generateContent'] }
      ] }) };
    }
    throw new Error('validation must not call generateContent');
  });
  try {
    const result = await new GeminiClient().validateKey('k', 'gemini-flash-lite-latest');
    assert.equal(result.status, 'valid');
    assert.ok(!stub.calls.some((c) => c.method === 'POST'));
  } finally { stub.restore(); }
});
