// scripts/openai-compatible-client.js

import { LLMClient } from './llm-client.js';

// Import constants + the prompt composer
import CONSTANTS, { composeSummaryPrompt } from './constants.js';

class OpenAICompatibleClient extends LLMClient {
  constructor(providerConfig) {
    super();
    this.providerConfig = providerConfig;
    this.endpoint = providerConfig?.endpoint || 'https://api.openai.com/v1/chat/completions';
    // Use a default model if the provider defines one, else generic
    this.modelId = providerConfig?.defaultModel || 'gpt-4o-mini';
  }

  async callAPI(apiKey, transcript, options = {}) {
    const prompt = `${composeSummaryPrompt(options)}

Here is the transcript: ${transcript}`;

    // Note: options might contain a specific model in the future, 
    // but for now we use the provider's default model.
    const selectedModel = options.modelId || this.modelId;

    const headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    };

    // If the custom provider specified additional headers, add them here
    if (this.providerConfig?.headers) {
      Object.assign(headers, this.providerConfig.headers);
    }

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: headers,
      body: JSON.stringify({
        model: selectedModel,
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
      else if (status >= 500) errorMsg = `${this.getModelName()} service unavailable. Please try again later.`;
      else errorMsg = result.error?.message || `${this.getModelName()} API error: ${status}`;
      throw new Error(errorMsg);
    }
    
    if (result.choices && result.choices[0].message.content) {
      return result.choices[0].message.content;
    } else {
      throw new Error(`Failed to get response from ${this.getModelName()}.`);
    }
  }

  async validateKey(apiKey) {
    try {
      const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      };

      if (this.providerConfig?.headers) {
        Object.assign(headers, this.providerConfig.headers);
      }

      const res = await fetch(this.endpoint, {
        method: "POST",
        headers: headers,
        body: JSON.stringify({
          model: this.modelId,
          messages: [{ role: "user", content: "." }],
          max_tokens: 1 // Just a quick check
        })
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async fetchModels(apiKey) {
    try {
      const headers = {
        "Authorization": `Bearer ${apiKey}`
      };

      if (this.providerConfig?.headers) {
        Object.assign(headers, this.providerConfig.headers);
      }

      // Convert chat completion endpoint to models endpoint (e.g. /v1/chat/completions -> /v1/models)
      let modelsEndpoint = this.endpoint.replace('/chat/completions', '/models');
      if (modelsEndpoint === this.endpoint) {
          // If the replace didn't work (maybe custom endpoint), just return an empty array and let the user type the model manually later
          return [];
      }

      const res = await fetch(modelsEndpoint, { headers });
      if (!res.ok) return [];
      const data = await res.json();
      if (!data.data || !Array.isArray(data.data)) return [];
      
      return data.data.map(m => ({
        id: m.id,
        name: m.id
      }));
    } catch {
      return [];
    }
  }

  getModelName() {
    return this.providerConfig?.name || 'OpenAI Compatible';
  }
}

export { OpenAICompatibleClient };
