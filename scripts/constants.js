// scripts/constants.js

// Shared selectors and config
const CONSTANTS = {
  YOUTUBE_SELECTORS: {
    SECONDARY: 'ytd-watch-flexy #secondary',
    TRANSCRIPT_BUTTON: 'button, ytd-button-renderer',
    TRANSCRIPT_PANEL: 'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]',
    TRANSCRIPT_SEGMENT: 'ytd-transcript-segment-renderer',
    TIMESTAMP: '.segment-timestamp, #timestamp',
    CONTENT: '.segment-text, #content'
  },
  API_ENDPOINTS: {
    GEMINI: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent',
    MISTRAL: 'https://api.mistral.ai/v1/chat/completions'
  },
  MODELS: {
    GEMINI: 'gemini',
    MISTRAL: 'mistral'
  }
};

// Export constants for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONSTANTS;
}