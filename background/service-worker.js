// background/service-worker.js

// Import the LLM client classes
import { GeminiClient } from '../scripts/gemini-client.js';
import { MistralClient } from '../scripts/mistral-client.js';

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
        chrome.tabs.sendMessage(tabs[0].id, { action: "KEYS_CHANGED" }).catch(() => {});
      }
    });
    return;
  }
  if (request.action === "START_GEMINI_ANALYSIS") {
    handleGeminiAnalysis(sendResponse, request.model).catch(err => {
      console.error('Unhandled error in handleGeminiAnalysis:', err);
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
      console.error('No active tab found');
      sendResponse({ success: false, error: 'No active tab found' });
      return;
    }
    
    // 2. Resolve 'auto' to actual model
    let resolvedModel = modelName;
    if (modelName === 'auto') {
      const storage = await chrome.storage.local.get(['GEMINI_API_KEY', 'MISTRAL_API_KEY']);
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
    chrome.tabs.sendMessage(tab.id, { action: "PROGRESS_UPDATE", phase: "extracting" }).catch(err => {
      console.error('Failed to send extracting progress:', err);
    });
    console.log('Fetching transcript...');
    const transcriptResponse = await llmClient.fetchTranscriptWithRetry(tab.id);
    console.log('Transcript fetched successfully:', transcriptResponse?.success);
    
    if (!transcriptResponse || !transcriptResponse.success) {
      const errorMsg = transcriptResponse ? transcriptResponse.error : "Could not connect to page.";
      console.error('Failed to fetch transcript:', errorMsg);
      chrome.tabs.sendMessage(tab.id, { action: "PROGRESS_UPDATE", phase: "error", message: errorMsg }).catch(() => {});
      sendResponse({ success: false, error: errorMsg });
      return;
    }
    
    // 5. Get API key for resolved model
    const storageKey = `${resolvedModel.toUpperCase()}_API_KEY`;
    console.log(`Getting API key for model: ${resolvedModel}`);
    const keyStorage = await chrome.storage.local.get([storageKey]);
    const apiKey = keyStorage[storageKey];
    
    if (!apiKey) {
      // If auto mode, try the other model's key
      if (originalModel === 'auto') {
        const fallbackModel = getOtherModel(resolvedModel);
        const fallbackKey = (await chrome.storage.local.get([`${fallbackModel.toUpperCase()}_API_KEY`]))[`${fallbackModel.toUpperCase()}_API_KEY`];
        if (fallbackKey) {
          console.log(`No key for ${resolvedModel}, but ${fallbackModel} has a key. Switching.`);
          resolvedModel = fallbackModel;
          llmClient = getClient(resolvedModel);
        } else {
          const errorMsg = `No API key found. Please set one in settings.`;
          chrome.tabs.sendMessage(tab.id, { action: "PROGRESS_UPDATE", phase: "error", message: errorMsg }).catch(() => {});
          sendResponse({ success: false, error: errorMsg });
          return;
        }
      } else {
        const errorMsg = `API Key not found for ${resolvedModel}. Please set it in settings.`;
        console.error(errorMsg);
        chrome.tabs.sendMessage(tab.id, { action: "PROGRESS_UPDATE", phase: "error", message: errorMsg }).catch(() => {});
        sendResponse({ success: false, error: errorMsg });
        return;
      }
    }
    
    const finalApiKey = (await chrome.storage.local.get([`${resolvedModel.toUpperCase()}_API_KEY`]))[`${resolvedModel.toUpperCase()}_API_KEY`];
    console.log(`API Key found for ${resolvedModel}, length: ${finalApiKey?.length}`);
    
    // 6. Call the LLM API
    console.log('Sending PROGRESS_UPDATE: calling_api');
    chrome.tabs.sendMessage(tab.id, { action: "PROGRESS_UPDATE", phase: "calling_api" }).catch(err => {
      console.error('Failed to send calling_api progress:', err);
    });
    console.log(`Calling ${resolvedModel} API...`);
    
    let summary;
    try {
      summary = await llmClient.callAPI(finalApiKey, transcriptResponse.data);
    } catch (apiErr) {
      console.error(`API call failed for ${resolvedModel}:`, apiErr.message);
      
      // Auto fallback: try the other model with the same transcript
      if (originalModel === 'auto') {
        const fallbackModel = getOtherModel(resolvedModel);
        console.log(`${resolvedModel} failed, trying ${fallbackModel}...`);
        
        chrome.tabs.sendMessage(tab.id, { action: "PROGRESS_UPDATE", phase: "calling_api", message: `Trying ${fallbackModel}...` }).catch(() => {});
        
        const fallbackKey = (await chrome.storage.local.get([`${fallbackModel.toUpperCase()}_API_KEY`]))[`${fallbackModel.toUpperCase()}_API_KEY`];
        if (!fallbackKey) {
          console.error(`No API key for fallback model ${fallbackModel}`);
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
    chrome.tabs.sendMessage(tab.id, { action: "RENDER_TIMESTAMPS", data: summary }).catch(err => {
      console.error('Failed to send RENDER_TIMESTAMPS:', err);
    });
    
    // 8. Send response
    console.log('Sending success response');
    sendResponse({ success: true, data: summary, model: resolvedModel });
  } catch (err) {
    console.error('Error in handleGeminiAnalysis:', err.message, err.stack);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => [null]);
    if (tab) {
      chrome.tabs.sendMessage(tab.id, { action: "PROGRESS_UPDATE", phase: "error", message: err.message }).catch(() => {});
    }
    sendResponse({ success: false, error: err.message });
  }
}
