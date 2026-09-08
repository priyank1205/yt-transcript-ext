const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

test('Gemini provider configuration has Gemini Flash-Lite Latest as default', async () => {
  const { PROVIDERS } = await import(path.join(__dirname, '../scripts/providers.js'));
  const gemini = PROVIDERS.gemini;

  assert.equal(gemini.defaultModel, 'gemini-flash-lite-latest');
  assert.equal(gemini.defaultModelName, 'Gemini Flash-Lite Latest');
  assert.ok(gemini.endpoint.includes('gemini-flash-lite-latest'));
});

test('GeminiClient defaults to gemini-flash-lite-latest and prioritizes it in fetchModels', async () => {
  const { GeminiClient } = await import(path.join(__dirname, '../scripts/gemini-client.js'));
  const client = new GeminiClient();

  // Test fetchModels injection when not in API response
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      if (url.includes('/models?')) {
        return {
          ok: true,
          json: async () => ({
            models: [
              { name: 'models/gemini-1.5-pro', displayName: 'Gemini 1.5 Pro', supportedGenerationMethods: ['generateContent'] },
              { name: 'models/gemini-1.5-flash', displayName: 'Gemini 1.5 Flash', supportedGenerationMethods: ['generateContent'] }
            ]
          })
        };
      }
      return { ok: true, json: async () => ({}) };
    };

    const models = await client.fetchModels('fake-key');
    assert.ok(models.length >= 3);
    assert.equal(models[0].id, 'gemini-flash-lite-latest');
    assert.equal(models[0].name, 'Gemini Flash-Lite Latest');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GeminiClient fetchModels places gemini-flash-lite-latest at top if already in response', async () => {
  const { GeminiClient } = await import(path.join(__dirname, '../scripts/gemini-client.js'));
  const client = new GeminiClient();

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      if (url.includes('/models?')) {
        return {
          ok: true,
          json: async () => ({
            models: [
              { name: 'models/gemini-1.5-pro', displayName: 'Gemini 1.5 Pro', supportedGenerationMethods: ['generateContent'] },
              { name: 'models/gemini-flash-lite-latest', displayName: 'Gemini Flash-Lite Latest', supportedGenerationMethods: ['generateContent'] }
            ]
          })
        };
      }
      return { ok: true, json: async () => ({}) };
    };

    const models = await client.fetchModels('fake-key');
    assert.equal(models[0].id, 'gemini-flash-lite-latest');
    assert.equal(models[0].name, 'Gemini Flash-Lite Latest');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GeminiClient callAPI uses explicit modelId when provided', async () => {
  const { GeminiClient } = await import(path.join(__dirname, '../scripts/gemini-client.js'));
  const client = new GeminiClient();

  let requestedUrl = '';
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      requestedUrl = url;
      return {
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: 'Summary result' }] } }]
        })
      };
    };

    // When user selected another model, like gemini-1.5-pro
    await client.callAPI('test-key', 'sample transcript', { modelId: 'gemini-1.5-pro' });
    assert.ok(requestedUrl.includes('/models/gemini-1.5-pro:generateContent'), `Expected URL to include gemini-1.5-pro, got: ${requestedUrl}`);

    // When no model is specified, it defaults to gemini-flash-lite-latest
    await client.callAPI('test-key', 'sample transcript', {});
    assert.ok(requestedUrl.includes('/models/gemini-flash-lite-latest:generateContent'), `Expected URL to include gemini-flash-lite-latest, got: ${requestedUrl}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

