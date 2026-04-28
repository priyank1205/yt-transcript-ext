// scripts/mistral-client.js

import { LLMClient } from './llm-client.js';

// Import constants for shared prompt
import CONSTANTS from './constants.js';

class MistralClient extends LLMClient {
  // Function to fetch transcript from content script with retry
  async fetchTranscriptWithRetry(tabId, retries = 3) {
    console.log(`Attempting to fetch transcript from tab ${tabId}, attempt ${4 - retries} of 3`);
    while (retries > 0) {
      try {
        const transcriptResponse = await chrome.tabs.sendMessage(tabId, { action: "GET_TRANSCRIPT" });
        console.log('Successfully fetched transcript');
        return transcriptResponse;
      } catch (err) {
        console.error(`Error fetching transcript (attempt ${4 - retries}):`, err.message);
        if (err.message.includes("Receiving end does not exist") && retries > 1) {
          console.log('Retrying in 1 second...');
          await new Promise(r => setTimeout(r, 1000));
          retries--;
        } else {
          throw err;
        }
      }
    }
    throw new Error("Failed to fetch transcript after retries");
  }

  // Function to call Mistral API
  async callMistralAPI(apiKey, transcript) {
    console.log('Preparing to call Mistral API');
    const prompt = `${CONSTANTS.PROMPTS.SUMMARY_PROMPT}

Here is the transcript: ${transcript}`;

    console.log('Sending request to Mistral API');
    const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
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

    console.log('Received response from Mistral API');
    const result = await response.json();
    console.log('Parsed response:', result);
    
    if (result.choices && result.choices[0].message.content) {
      console.log('Successfully got response from Mistral');
      return result.choices[0].message.content;
    } else {
      console.error('Failed to get valid response from Mistral:', result);
      throw new Error("Failed to get response from Mistral.");
    }
  }

  // Implement LLMClient interface methods
  async callAPI(apiKey, transcript) {
    console.log(`Calling callAPI for model ${this.getModelName()}`);
    return this.callMistralAPI(apiKey, transcript);
  }

  async validateKey(apiKey) {
    console.log(`Validating API key for model ${this.getModelName()}`);
    // Simple validation - try a test request with a small prompt
    try {
      console.log('Sending test request to Mistral API');
      const testResponse = await fetch("https://api.mistral.ai/v1/chat/completions", {
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
              content: "Test prompt"
            }
          ]
        })
      });
      
      console.log('Received test response:', testResponse.ok);
      return testResponse.ok;
    } catch (err) {
      console.error('Error validating API key:', err);
      return false;
    }
  }

  getModelName() {
    return 'mistral';
  }
}

export { MistralClient };