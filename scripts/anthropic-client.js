// scripts/anthropic-client.js

import { LLMClient } from './llm-client.js';
import CONSTANTS, { composeSummaryPrompt } from './constants.js';

class AnthropicClient extends LLMClient {
  constructor(providerConfig) {
    super();
    this.providerConfig = providerConfig;
    this.endpoint = providerConfig?.endpoint || 'https://api.anthropic.com/v1/messages';
    this.modelId = providerConfig?.defaultModel || 'claude-3-5-haiku-latest';
  }

  async callAPI(apiKey, transcript, options = {}) {
    const prompt = `${composeSummaryPrompt(options)}

Here is the transcript: ${transcript}`;

    const selectedModel = options.modelId || this.modelId;

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerously-allow-browser": "true"
      },
      body: JSON.stringify({
        model: selectedModel,
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
    
    if (!response.ok || result.error) {
      const status = response.status;
      let errorMsg;
      if (status === 401) errorMsg = 'Invalid API key. Please check your settings.';
      else if (status === 403) errorMsg = 'API key expired or unauthorized. Please check your settings.';
      else if (status === 429) errorMsg = 'Rate limit exceeded. Please try again later.';
      else if (status >= 500) errorMsg = `${this.getModelName()} service unavailable. Please try again later.`;
      else errorMsg = result.error?.message || `${this.getModelName()} API error: ${status}`;
      throw new Error(errorMsg);
    }
    
    if (result.content && result.content.length > 0 && result.content[0].text) {
      return result.content[0].text;
    } else {
      throw new Error(`Failed to get response from ${this.getModelName()}.`);
    }
  }

  async validateKey(apiKey) {
    try {
      const res = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerously-allow-browser": "true"
        },
        body: JSON.stringify({
          model: this.modelId,
          messages: [{ role: "user", content: "." }],
          max_tokens: 1
        })
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async fetchModels(apiKey) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/models', {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerously-allow-browser": "true"
        }
      });
      if (!res.ok) return [];
      const data = await res.json();
      if (!data.data || !Array.isArray(data.data)) return [];
      
      return data.data.map(m => ({
        id: m.id,
        name: m.display_name || m.id
      }));
    } catch {
      return [];
    }
  }

  getModelName() {
    return this.providerConfig?.name || 'Anthropic';
  }
}

export { AnthropicClient };
