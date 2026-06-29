// scripts/mistral-client.js

import { LLMClient } from './llm-client.js';

// Import constants for shared prompt
import CONSTANTS from './constants.js';

class MistralClient extends LLMClient {
  // Function to call Mistral API
  async callMistralAPI(apiKey, transcript) {
    const prompt = `${CONSTANTS.PROMPTS.SUMMARY_PROMPT}

Here is the transcript: ${transcript}`;

    const response = await fetch(CONSTANTS.API_ENDPOINTS.MISTRAL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "mistral-large-latest",
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
  async callAPI(apiKey, transcript) {
    return this.callMistralAPI(apiKey, transcript);
  }

  async validateKey(apiKey) {
    try {
      const res = await fetch(CONSTANTS.API_ENDPOINTS.MISTRAL, {
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