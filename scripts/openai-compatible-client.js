// scripts/openai-compatible-client.js

import { LLMClient } from './llm-client.js';

// Import constants + the prompt composer
import CONSTANTS, { composeSummaryPrompt, outputBudgetFor } from './constants.js';
import { apiError, codeForStatus, ERROR_CODES } from './errors.js';

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
      // Carries the caller's cancellation: navigating away or superseding the
      // request stops the call instead of leaving it running to completion.
      signal: options.signal,
      body: JSON.stringify({
        model: selectedModel,
        // An output budget sized from the density this run asked for, so long
        // In-depth summaries aren't truncated mid-list; low temperature
        // steadies the point count run-to-run.
        max_tokens: outputBudgetFor(options),
        temperature: 0.3,
        messages: [
          {
            role: "user",
            content: prompt
          }
        ]
      })
    });

    const text = await response.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch (e) {
      // If it's not JSON, it's likely an HTML error page or plain text error like "404 Not Found"
      throw apiError(ERROR_CODES.BAD_OUTPUT, `API returned invalid JSON (Status ${response.status}): ${text.substring(0, 60)}`, response.status);
    }
    
    // Check for API errors first
    if (!response.ok || result.error) {
      const status = response.status;
      let errorMsg;
      let code = codeForStatus(status);
      if (status === 401) errorMsg = 'Invalid API key. Please check your settings.';
      else if (status === 403) errorMsg = 'API key expired or unauthorized. Please check your settings.';
      else if (status === 404) {
        // For an OpenAI-compatible endpoint a 404 is far more often a wrong
        // base URL than a retired model, so it gets its own category.
        code = ERROR_CODES.ENDPOINT;
        errorMsg = `Endpoint not found (404). Did you forget to add /v1/chat/completions to your Base URL?`;
      }
      else if (status === 429) errorMsg = 'Rate limit exceeded. Please try again later.';
      else if (status >= 500) errorMsg = `${this.getModelName()} service unavailable. Please try again later.`;
      else errorMsg = result.error?.message || `${this.getModelName()} API error: ${status}`;
      throw apiError(code, errorMsg, status);
    }
    
    const choice = result.choices?.[0];
    if (choice?.message?.content) {
      // `finish_reason` is how a summary that ran out of output budget
      // announces itself; passing it on is what stops a half-written list
      // being rendered as a complete one.
      return { text: choice.message.content, finishReason: choice.finish_reason || null };
    }
    if (choice?.finish_reason) return { text: '', finishReason: choice.finish_reason };
    throw apiError(ERROR_CODES.BAD_OUTPUT, `Failed to get response from ${this.getModelName()}.`, response.status);
  }

  // Separates "this key is rejected" from "this key can't use that model" and
  // from "that URL isn't a chat endpoint", so a retired model or a mistyped
  // base URL never reads as a bad key.
  async validateKey(apiKey, modelId) {
    const model = modelId || this.modelId;
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
          model,
          messages: [{ role: "user", content: "." }],
          max_tokens: 1 // Just a quick check
        })
      });
      if (res.ok) return { status: 'valid', model };
      if (res.status === 401 || res.status === 403) return { status: 'invalid', model };
      if (res.status === 404) {
        // A 404 that names the model is a retired id; a bare 404 is far more
        // often a base URL missing /v1/chat/completions.
        const body = await res.text().catch(() => '');
        return { status: /model/i.test(body) ? 'model_unavailable' : 'endpoint', model };
      }
      if (res.status === 400) {
        const body = await res.text().catch(() => '');
        return { status: /model/i.test(body) ? 'model_unavailable' : 'invalid', model };
      }
      return { status: 'unreachable', model };
    } catch {
      return { status: 'unreachable', model };
    }
  }

  // Model ids that a chat-completions request cannot use. /models lists
  // everything the key can see, including embedding, audio and image models,
  // and offering those in the picker only produces a confusing 400 later.
  static NON_CHAT_MODEL = /(embedding|^text-embedding|^tts|-tts|whisper|transcribe|audio-preview|dall-e|gpt-image|moderation|rerank|-guard|stable-diffusion|^clip-)/i;

  // Throws when the list could not be read, so an empty array always means
  // "this key really has no usable models" and callers can tell them apart.
  async fetchModels(apiKey) {
    const headers = {
      "Authorization": `Bearer ${apiKey}`
    };

    if (this.providerConfig?.headers) {
      Object.assign(headers, this.providerConfig.headers);
    }

    // Convert chat completion endpoint to models endpoint (e.g. /v1/chat/completions -> /v1/models)
    const modelsEndpoint = this.endpoint.replace('/chat/completions', '/models');
    if (modelsEndpoint === this.endpoint) {
      // Not an endpoint shape we can derive a list from; the user types the
      // model ids themselves for this provider.
      return [];
    }

    let res;
    try {
      res = await fetch(modelsEndpoint, { headers });
    } catch (err) {
      throw apiError(ERROR_CODES.NETWORK, `Could not reach ${this.getModelName()} to list models: ${err.message}`);
    }
    if (!res.ok) throw apiError(codeForStatus(res.status), `${this.getModelName()} model list failed (${res.status}).`, res.status);
    const data = await res.json().catch(() => ({}));
    if (!Array.isArray(data.data)) return [];

    const models = data.data.map(m => ({ id: m.id, name: m.id }));
    const chatModels = models.filter(m => !OpenAICompatibleClient.NON_CHAT_MODEL.test(m.id));
    // A provider whose ids all look non-chat is more likely naming things
    // unusually than offering nothing usable, so keep the unfiltered list.
    return chatModels.length ? chatModels : models;
  }

  getModelName() {
    return this.providerConfig?.name || 'OpenAI Compatible';
  }
}

export { OpenAICompatibleClient };
