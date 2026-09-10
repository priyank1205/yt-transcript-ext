// scripts/llm-client.js

import { ERROR_CODES } from './errors.js';

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

  /**
   * Validate a key by listing models rather than by generating with one.
   *
   * Every client used to answer "does this key work?" by sending a real
   * completion request. That has two costs the user feels: a working key waits
   * for an actual generation (seconds) while a bad one fails auth instantly, so
   * the flow is slowest exactly when it succeeded; and it conflates two
   * different questions, because a perfectly good key whose tier cannot reach
   * one particular model comes back looking rejected.
   *
   * A model listing is one cheap GET. It bills nothing, returns promptly, and
   * separates the two questions: the listing succeeding proves the key, and the
   * requested model's presence in it is a second, answerable fact.
   *
   * @returns {Promise<{status: string, model: string, models?: Array}|null>}
   *          null means "could not decide this way" — the caller should fall
   *          back to its own probe (a custom endpoint may serve no /models).
   */
  async validateByListing(apiKey, model) {
    let models;
    try {
      models = await this.fetchModels(apiKey);
    } catch (err) {
      // The provider actively refused the credentials: that is an answer.
      if (err?.code === ERROR_CODES.AUTH) return { status: 'invalid', model };
      return null;
    }
    if (!Array.isArray(models) || !models.length) return null;

    const ids = models.map((m) => (typeof m === 'string' ? m : m.id)).filter(Boolean);
    if (!ids.length) return null;
    if (ids.includes(model)) return { status: 'valid', model, models };
    // The key works; this model is simply not one it can reach. Callers get the
    // list so they can offer or choose one that is, instead of dead-ending.
    return { status: 'model_unavailable', model, models };
  }

}