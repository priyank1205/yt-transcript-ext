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