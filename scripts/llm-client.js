// scripts/llm-client.js

/**
 * Abstract class representing a Language Model Client
 */
export class LLMClient {
  /**
   * Calls the LLM API with the given API key and transcript.
   *
   * Returns the reply together with the provider's own reason for stopping, so
   * a response that ran out of output budget can be recognised as truncated
   * rather than summarised as if it were complete.
   *
   * @param {string} apiKey - The API key for authentication
   * @param {string} transcript - The transcript to summarize
   * @param {{modelId?: string, length?: string, durationMinutes?: number, signal?: AbortSignal}} options
   * @returns {Promise<{text: string, finishReason: string|null}>}
   */
  async callAPI(apiKey, transcript, options) {
    throw new Error('Method not implemented');
  }

  /**
   * Fetches transcript from content script with retry logic.
   *
   * `videoId` names the video the request was started for: the content script
   * refuses to answer for a different one, so a retry that lands after the user
   * has navigated cannot return the wrong video's transcript.
   *
   * @param {number} tabId - The tab ID to send the message to
   * @param {string} videoId - The video the request is bound to
   * @param {number} retries - Number of retry attempts (default: 3)
   * @returns {Promise<Object>} The transcript response
   */
  async fetchTranscriptWithRetry(tabId, videoId, retries = 3) {
    while (retries > 0) {
      try {
        const transcriptResponse = await chrome.tabs.sendMessage(tabId, { action: "GET_TRANSCRIPT", videoId });
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

  /**
   * Validates the API key with the LLM provider, against the model that will
   * actually be used. The outcome distinguishes a rejected key from a key that
   * simply cannot reach the configured model.
   *
   * @param {string} apiKey - The API key to validate
   * @param {string} [modelId] - The model the key will be used with
   * @returns {Promise<{status: 'valid'|'invalid'|'model_unavailable'|'endpoint'|'unreachable', model: string}>}
   */
  async validateKey(apiKey, modelId) {
    throw new Error('Method not implemented');
  }

  /**
   * Fetches the available text-generation models for this provider. Throws when
   * the list could not be read, so an empty array means the key genuinely has
   * no usable models rather than that the request failed.
   *
   * @param {string} apiKey - The API key for authentication
   * @returns {Promise<Array<{id: string, name: string}>>} List of models
   */
  async fetchModels(apiKey) {
    throw new Error('Method not implemented');
  }

  /**
   * Gets the name of the model this client represents
   * @returns {string} The model name
   */
  getModelName() {
    throw new Error('Method not implemented');
  }
}