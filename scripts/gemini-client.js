// scripts/gemini-client.js

import { LLMClient } from './llm-client.js';

// Import constants for shared prompt
import CONSTANTS from './constants.js';

class GeminiClient extends LLMClient {
  // Function to fetch transcript from content script with retry
  async fetchTranscriptWithRetry(tabId, retries = 3) {
    while (retries > 0) {
      try {
        const transcriptResponse = await chrome.tabs.sendMessage(tabId, { action: "GET_TRANSCRIPT" });
        return transcriptResponse;
      } catch (err) {
        if (err.message.includes("Receiving end does not exist") && retries > 1) {
          await new Promise(r => setTimeout(r, 1000));
          retries--;
        } else {
          throw err;
        }
      }
    }
    throw new Error("Failed to fetch transcript after retries");
  }

  // Function to call Gemini API
  async callGeminiAPI(apiKey, transcript) {
    const prompt = `${CONSTANTS.PROMPTS.SUMMARY_PROMPT}

Here is the transcript: ${transcript}`;

    const response = await fetch(`${CONSTANTS.API_ENDPOINTS.GEMINI}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
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
  async callAPI(apiKey, transcript) {
    return this.callGeminiAPI(apiKey, transcript);
  }

  async validateKey(apiKey) {
    // Simple validation - try a test request with a small prompt
    try {
      const testResponse = await fetch(`${CONSTANTS.API_ENDPOINTS.GEMINI}?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "Test prompt" }] }]
        })
      });
      return testResponse.ok;
    } catch (err) {
      return false;
    }
  }

  getModelName() {
    return 'gemini';
  }
}

export { GeminiClient };