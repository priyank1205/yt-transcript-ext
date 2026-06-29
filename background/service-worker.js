// background/service-worker.js

// Import the LLM client classes
import { GeminiClient } from '../scripts/gemini-client.js';
import { MistralClient } from '../scripts/mistral-client.js';

// Helper: send a message to a tab and await it to prevent the service worker from terminating prematurely
async function sendTabMessage(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch (err) {
    // Silently ignore errors (e.g., content script not ready or tab closed)
  }
}

// Helper: get the other model for fallback
function getOtherModel(model) {
  return model === 'gemini' ? 'mistral' : 'gemini';
}

// Helper: create LLM client by model name
function getClient(modelName) {
  switch (modelName.toLowerCase()) {
    case 'gemini': return new GeminiClient();
    case 'mistral': return new MistralClient();
    default: throw new Error(`Unsupported model: ${modelName}`);
  }
}

// Handle messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "OPEN_OPTIONS") {
    const optionsUrl = chrome.runtime.getURL('options/options.html');
    chrome.tabs.create({ url: optionsUrl });
    return;
  }
  if (request.action === "KEYS_CHANGED") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        sendTabMessage(tabs[0].id, { action: "KEYS_CHANGED" });
      }
    });
    return;
  }
  if (request.action === "START_GEMINI_ANALYSIS") {
    handleGeminiAnalysis(sendResponse, request.model).catch(err => {
      console.warn('Unhandled error in handleGeminiAnalysis:', err);
      sendResponse({ success: false, error: err.message || 'Unknown error occurred' });
    });
    return true; 
  }
});

async function handleGeminiAnalysis(sendResponse, modelName = 'gemini') {
  const originalModel = modelName;
  console.log(`handleGeminiAnalysis called with model: ${originalModel}`);
  
  try {
    // 1. Get the active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    console.log(`Active tab ID: ${tab?.id}`);
    
    if (!tab || !tab.id) {
      console.warn('No active tab found');
      sendResponse({ success: false, error: 'No active tab found', keepOpen: true });
      return;
    }
    
    // Fetch all storage keys once upfront
    const storage = await chrome.storage.local.get(['GEMINI_API_KEY', 'MISTRAL_API_KEY']);
    
    // 2. Resolve 'auto' to actual model
    let resolvedModel = modelName;
    if (modelName === 'auto') {
      if (storage.GEMINI_API_KEY) {
        resolvedModel = 'gemini';
      } else if (storage.MISTRAL_API_KEY) {
        resolvedModel = 'mistral';
      } else {
        resolvedModel = 'gemini';
      }
      console.log(`Auto-resolved to: ${resolvedModel}`);
    }
    
    // 3. Create LLM client
    let llmClient = getClient(resolvedModel);
    console.log(`Created LLM client for model: ${resolvedModel}`);
    
    // 4. Fetch transcript (once, reused for fallback)
    console.log('Sending PROGRESS_UPDATE: extracting');
    await sendTabMessage(tab.id, { action: "PROGRESS_UPDATE", phase: "extracting" });
    console.log('Fetching transcript...');
    const transcriptResponse = await llmClient.fetchTranscriptWithRetry(tab.id);
    console.log('Transcript fetched successfully:', transcriptResponse?.success);
    
    if (!transcriptResponse || !transcriptResponse.success) {
      const errorMsg = transcriptResponse ? transcriptResponse.error : "Could not connect to page.";
      const keepOpen = errorMsg.includes('no captions');
      if (keepOpen) {
        console.warn('Transcript:', errorMsg);
      } else {
        console.warn('Failed to fetch transcript:', errorMsg);
      }
      await sendTabMessage(tab.id, { action: "PROGRESS_UPDATE", phase: "error", message: errorMsg, keepOpen });
      sendResponse({ success: false, error: errorMsg, keepOpen });
      return;
    }
    
    // 5. Get API key for resolved model
    const apiKey = storage[`${resolvedModel.toUpperCase()}_API_KEY`];
    console.log(`Getting API key for model: ${resolvedModel}`);
    
    if (!apiKey) {
      // If auto mode, try the other model's key
      if (originalModel === 'auto') {
        const fallbackModel = getOtherModel(resolvedModel);
        const fallbackKey = storage[`${fallbackModel.toUpperCase()}_API_KEY`];
        if (fallbackKey) {
          console.log(`No key for ${resolvedModel}, but ${fallbackModel} has a key. Switching.`);
          resolvedModel = fallbackModel;
          llmClient = getClient(resolvedModel);
        } else {
          const errorMsg = `No API key found. Please set one in settings.`;
          await sendTabMessage(tab.id, { action: "PROGRESS_UPDATE", phase: "error", message: errorMsg });
          sendResponse({ success: false, error: errorMsg });
          return;
        }
      } else {
        const errorMsg = `API Key not found for ${resolvedModel}. Please set it in settings.`;
        console.warn(errorMsg);
        await sendTabMessage(tab.id, { action: "PROGRESS_UPDATE", phase: "error", message: errorMsg });
        sendResponse({ success: false, error: errorMsg });
        return;
      }
    }
    
    const finalApiKey = apiKey || storage[`${resolvedModel.toUpperCase()}_API_KEY`];
    console.log(`API Key found for ${resolvedModel}, length: ${finalApiKey?.length}`);
    
    // 6. Call the LLM API
    console.log('Sending PROGRESS_UPDATE: calling_api');
    await sendTabMessage(tab.id, { action: "PROGRESS_UPDATE", phase: "calling_api" });
    console.log(`Calling ${resolvedModel} API...`);
    
    let summary;
    try {
      summary = await llmClient.callAPI(finalApiKey, transcriptResponse.data);
    } catch (apiErr) {
      console.warn(`API call failed for ${resolvedModel}:`, apiErr.message);
      
      // Auto fallback: try the other model with the same transcript
      if (originalModel === 'auto') {
        const fallbackModel = getOtherModel(resolvedModel);
        console.log(`${resolvedModel} failed, trying ${fallbackModel}...`);
        
        await sendTabMessage(tab.id, { action: "PROGRESS_UPDATE", phase: "calling_api", message: `Trying ${fallbackModel}...` });
        
        const fallbackKey = storage[`${fallbackModel.toUpperCase()}_API_KEY`];
        if (!fallbackKey) {
          console.warn(`No API key for fallback model ${fallbackModel}`);
          sendResponse({ success: false, error: apiErr.message });
          return;
        }
        
        const fallbackClient = getClient(fallbackModel);
        summary = await fallbackClient.callAPI(fallbackKey, transcriptResponse.data);
        console.log(`Fallback to ${fallbackModel} succeeded`);
      } else {
        throw apiErr;
      }
    }
    
    console.log('API call completed successfully, summary length:', summary?.length);
    
    // 7. Send timestamps to content script to render
    console.log('Sending RENDER_TIMESTAMPS');
    await sendTabMessage(tab.id, { action: "RENDER_TIMESTAMPS", data: summary });
    
    // 8. Send response
    console.log('Sending success response');
    sendResponse({ success: true, data: summary, model: resolvedModel });
  } catch (err) {
    console.warn('Error in handleGeminiAnalysis:', err.message, err.stack);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => [null]);
    if (tab) {
      await sendTabMessage(tab.id, { action: "PROGRESS_UPDATE", phase: "error", message: err.message });
    }
    sendResponse({ success: false, error: err.message });
  }
}
