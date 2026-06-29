// scripts/llm-client.js

/**
 * Abstract class representing a Language Model Client
 */
export class LLMClient {
  /**
   * Calls the LLM API with the given API key and transcript
   * @param {string} apiKey - The API key for authentication
   * @param {string} transcript - The transcript to summarize
   * @returns {Promise<string>} The generated summary
   */
  async callAPI(apiKey, transcript) {
    throw new Error('Method not implemented');
  }

  /**
   * Fetches transcript from content script with retry logic
   * @param {number} tabId - The tab ID to send the message to
   * @param {number} retries - Number of retry attempts (default: 3)
   * @returns {Promise<Object>} The transcript response
   */
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

  /**
   * Validates the API key with the LLM provider
   * @param {string} apiKey - The API key to validate
   * @returns {Promise<boolean>} Whether the key is valid
   */
  async validateKey(apiKey) {
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