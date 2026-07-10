// scripts/gemini-client.js

import { LLMClient } from './llm-client.js';

// Import constants + the prompt composer
import CONSTANTS, { composeSummaryPrompt } from './constants.js';

class GeminiClient extends LLMClient {
  // Function to call Gemini API
  async callGeminiAPI(apiKey, transcript, options = {}) {
    const prompt = `${composeSummaryPrompt(options)}

Here is the transcript: ${transcript}`;

    const response = await fetch(`${CONSTANTS.API_ENDPOINTS.GEMINI}?key=${apiKey}`, {
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
      throw new Error(errorMsg);
    }
    
    if (result.candidates && result.candidates[0].content.parts[0].text) {
      return result.candidates[0].content.parts[0].text;
    } else {
      throw new Error("Failed to get response from Gemini.");
    }
  }

  // Implement LLMClient interface methods
  async callAPI(apiKey, transcript, options = {}) {
    return this.callGeminiAPI(apiKey, transcript, options);
  }

  async validateKey(apiKey) {
    try {
      const res = await fetch(`${CONSTANTS.API_ENDPOINTS.GEMINI}?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: "." }] }] })
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  getModelName() {
    return 'gemini';
  }
}

export { GeminiClient };