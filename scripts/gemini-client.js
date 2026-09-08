// scripts/gemini-client.js

import { LLMClient } from './llm-client.js';

// Import constants + the prompt composer
import CONSTANTS, { composeSummaryPrompt } from './constants.js';
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
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        // A generous output budget so long In-depth summaries aren't truncated
        // mid-list; low temperature steadies the point count run-to-run.
        generationConfig: { maxOutputTokens: 8192, temperature: 0.3 }
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
    
    if (result.candidates && result.candidates[0].content.parts[0].text) {
      return result.candidates[0].content.parts[0].text;
    } else {
      throw apiError(ERROR_CODES.BAD_OUTPUT, "Failed to get response from Gemini.", response.status);
    }
  }

  // Implement LLMClient interface methods
  async callAPI(apiKey, transcript, options = {}) {
    return this.callGeminiAPI(apiKey, transcript, options);
  }

  async validateKey(apiKey) {
    try {
      const API_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent';
      const res = await fetch(`${API_ENDPOINT}?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: "." }] }] })
      });
      if (res.ok) return true;
      const modelsRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
      return modelsRes.ok;
    } catch {
      return false;
    }
  }

  async fetchModels(apiKey) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
      if (!res.ok) return [];
      const data = await res.json();
      const models = data.models
        .filter(m => m.supportedGenerationMethods.includes('generateContent'))
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
    } catch {
      return [];
    }
  }

  getModelName() {
    return 'gemini';
  }
}

export { GeminiClient };