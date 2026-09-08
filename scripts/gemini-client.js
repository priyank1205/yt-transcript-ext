// scripts/gemini-client.js

import { LLMClient } from './llm-client.js';

// Import constants + the prompt composer
import CONSTANTS, { composeSummaryPrompt, outputBudgetFor } from './constants.js';
import { apiError, codeForStatus, ERROR_CODES } from './errors.js';

class GeminiClient extends LLMClient {
  constructor(providerConfig = {}) {
    super(providerConfig);
    this.providerConfig = providerConfig;
  }

  // Function to call Gemini API
  async callGeminiAPI(apiKey, transcript, options = {}) {
    const prompt = `${composeSummaryPrompt(options)}

Here is the transcript: ${transcript}`;

    const modelId = options.modelId || this.providerConfig?.defaultModel || 'gemini-flash-lite-latest';
    const API_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`;
    const response = await fetch(`${API_ENDPOINT}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Carries the caller's cancellation: navigating away or superseding the
      // request stops the call instead of leaving it running to completion.
      signal: options.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        // An output budget sized from the density this run asked for, so long
        // In-depth summaries aren't truncated mid-list; low temperature
        // steadies the point count run-to-run.
        generationConfig: { maxOutputTokens: outputBudgetFor(options), temperature: 0.3 }
      })
    });

    const result = await response.json();
    
    // Check for API errors first
    if (!response.ok || result.error) {
      const status = response.status;
      let errorMsg;
      if (status === 400) errorMsg = 'Invalid API key. Please check your settings.';
      else if (status === 403) errorMsg = 'API key expired or unauthorized. Please check your settings.';
      else if (status === 429) errorMsg = 'Rate limit exceeded. Please try again later.';
      else if (status >= 500) errorMsg = 'Gemini service unavailable. Please try again later.';
      else errorMsg = result.error?.message || `Gemini API error: ${status}`;
      throw apiError(codeForStatus(status), errorMsg, status);
    }
    
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text) {
      // The reason the model stopped travels with the reply. Reporting it is
      // what turns a silently half-written summary into a named failure.
      return { text, finishReason: result.candidates[0].finishReason || null };
    }
    // No text and a stop reason means the response was cut short or refused;
    // the validator turns that reason into the category the panel shows.
    const finishReason = result.candidates?.[0]?.finishReason ||
      result.promptFeedback?.blockReason || null;
    if (finishReason) return { text: '', finishReason };
    throw apiError(ERROR_CODES.BAD_OUTPUT, "Failed to get response from Gemini.", response.status);
  }

  // Implement LLMClient interface methods
  async callAPI(apiKey, transcript, options = {}) {
    return this.callGeminiAPI(apiKey, transcript, options);
  }

  // Separates "this key is rejected" from "this key can't use that model", so a
  // model that has been retired since it was saved never reads as a bad key.
  async validateKey(apiKey, modelId) {
    const model = modelId || this.providerConfig?.defaultModel || 'gemini-flash-lite-latest';
    try {
      const API_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      const res = await fetch(`${API_ENDPOINT}?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: "." }] }] })
      });
      if (res.ok) return { status: 'valid', model };
      const modelsRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
      if (modelsRes.ok) return { status: 'model_unavailable', model };
      return { status: 'invalid', model };
    } catch {
      return { status: 'unreachable', model };
    }
  }

  // Throws when the list could not be read, so an empty array always means
  // "this key really has no usable models" and callers can tell them apart.
  async fetchModels(apiKey) {
    let res;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
    } catch (err) {
      throw apiError(ERROR_CODES.NETWORK, `Could not reach Gemini to list models: ${err.message}`);
    }
    if (!res.ok) throw apiError(codeForStatus(res.status), `Gemini model list failed (${res.status}).`, res.status);
    const data = await res.json().catch(() => ({}));
    // Only models that can answer a generateContent call belong in the picker.
    const models = (Array.isArray(data.models) ? data.models : [])
      .filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
      .map(m => ({
        id: m.name.replace('models/', ''),
        name: m.displayName || m.name.replace('models/', '')
      }));

    // Ensure "Gemini Flash-Lite Latest" (gemini-flash-lite-latest) is present and prioritized at the top
    const flashLiteIndex = models.findIndex(m => m.id === 'gemini-flash-lite-latest' || m.name === 'Gemini Flash-Lite Latest');
    if (flashLiteIndex >= 0) {
      const [item] = models.splice(flashLiteIndex, 1);
      item.name = item.name || 'Gemini Flash-Lite Latest';
      models.unshift(item);
    } else {
      models.unshift({
        id: 'gemini-flash-lite-latest',
        name: 'Gemini Flash-Lite Latest'
      });
    }

    return models;
  }

  getModelName() {
    return 'gemini';
  }
}

export { GeminiClient };