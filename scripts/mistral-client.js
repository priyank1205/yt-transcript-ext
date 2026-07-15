// scripts/mistral-client.js

import { LLMClient } from './llm-client.js';

// Import constants + the prompt composer
import CONSTANTS, { composeSummaryPrompt } from './constants.js';

class MistralClient extends LLMClient {
  // Function to call Mistral API
  async callMistralAPI(apiKey, transcript, options = {}) {
    const prompt = `${composeSummaryPrompt(options)}

Here is the transcript: ${transcript}`;

    const API_ENDPOINT = 'https://api.mistral.ai/v1/chat/completions';
    const response = await fetch(API_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "mistral-large-latest",
        // A generous output budget so long In-depth summaries aren't truncated
        // mid-list; low temperature steadies the point count run-to-run.
        max_tokens: 8000,
        temperature: 0.3,
        messages: [
          {
            role: "user",
            content: prompt
          }
        ]
      })
    });

    const result = await response.json();
    
    // Check for API errors first
    if (!response.ok || result.error) {
      const status = response.status;
      let errorMsg;
      if (status === 401) errorMsg = 'Invalid API key. Please check your settings.';
      else if (status === 403) errorMsg = 'API key expired or unauthorized. Please check your settings.';
      else if (status === 429) errorMsg = 'Rate limit exceeded. Please try again later.';
      else if (status >= 500) errorMsg = 'Mistral service unavailable. Please try again later.';
      else errorMsg = result.error?.message || `Mistral API error: ${status}`;
      throw new Error(errorMsg);
    }
    
    if (result.choices && result.choices[0].message.content) {
      return result.choices[0].message.content;
    } else {
      throw new Error("Failed to get response from Mistral.");
    }
  }

  // Implement LLMClient interface methods
  async callAPI(apiKey, transcript, options = {}) {
    return this.callMistralAPI(apiKey, transcript, options);
  }

  async validateKey(apiKey) {
    try {
      const API_ENDPOINT = 'https://api.mistral.ai/v1/chat/completions';
      const res = await fetch(API_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "mistral-large-latest",
          messages: [{ role: "user", content: "." }]
        })
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  getModelName() {
    return 'mistral';
  }
}

export { MistralClient };