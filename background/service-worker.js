// background/service-worker.js

// Import the LLM client classes
import { GeminiClient } from '../scripts/gemini-client.js';
import { MistralClient } from '../scripts/mistral-client.js';

// Handle messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "START_GEMINI_ANALYSIS") {
    handleGeminiAnalysis(sendResponse, request.model);
    return true; 
  }
});

async function handleGeminiAnalysis(sendResponse, modelName = 'gemini') {
  try {
    console.log(`Starting analysis with model: ${modelName}`);
    // 1. Get the active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    console.log(`Active tab ID: ${tab.id}`);
    
    // 2. Create the appropriate LLM client
    let llmClient;
    switch (modelName.toLowerCase()) {
      case 'gemini':
        llmClient = new GeminiClient();
        break;
      case 'mistral':
        llmClient = new MistralClient();
        break;
      default:
        throw new Error(`Unsupported model: ${modelName}`);
    }
    console.log(`Created LLM client for model: ${llmClient.getModelName()}`);
    
    // 3. Fetch transcript from content script with retry
    chrome.tabs.sendMessage(tab.id, { action: "PROGRESS_UPDATE", phase: "extracting" });
    console.log('Fetching transcript...');
    const transcriptResponse = await llmClient.fetchTranscriptWithRetry(tab.id);
    console.log('Transcript fetched successfully');
    
    if (!transcriptResponse || !transcriptResponse.success) {
      console.error('Failed to fetch transcript:', transcriptResponse ? transcriptResponse.error : "Could not connect to page.");
      const errorMsg = transcriptResponse ? transcriptResponse.error : "Could not connect to page.";
      chrome.tabs.sendMessage(tab.id, { action: "PROGRESS_UPDATE", phase: "error", message: errorMsg });
      sendResponse({ success: false, error: errorMsg });
      return;
    }
    
    // 4. Get API Key based on model
    const storageKey = `${modelName.toUpperCase()}_API_KEY`;
    console.log(`Getting API key for model: ${modelName}`);
    const storage = await chrome.storage.local.get([storageKey]);
    const apiKey = storage[storageKey];
    
    if (!apiKey) {
      console.error(`API Key not found for ${modelName}`);
      const errorMsg = `API Key not found for ${modelName}. Please set it in options.`;
      chrome.tabs.sendMessage(tab.id, { action: "PROGRESS_UPDATE", phase: "error", message: errorMsg });
      sendResponse({ success: false, error: errorMsg });
      return;
    }
    
    // 5. Call the LLM API
    chrome.tabs.sendMessage(tab.id, { action: "PROGRESS_UPDATE", phase: "calling_api" });
    console.log(`Calling ${modelName} API...`);
    const summary = await llmClient.callAPI(apiKey, transcriptResponse.data);
    console.log('API call completed successfully');
    
    // Send message to content script to render
    sendResponse({ success: true, data: summary });
    
    // Send message to content script to render timestamps
    chrome.tabs.sendMessage(tab.id, { action: "RENDER_TIMESTAMPS", data: summary });
  } catch (err) {
    console.error('Error in handleGeminiAnalysis:', err);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => [null]);
    if (tab) chrome.tabs.sendMessage(tab.id, { action: "PROGRESS_UPDATE", phase: "error", message: err.message });
    sendResponse({ success: false, error: err.message });
  }
}