// background/service-worker.js

// Import the providers registry
import { PROVIDERS } from '../scripts/providers.js';

// First-run onboarding: on fresh install, open the settings page and flag the
// in-page tooltip that points new users to the settings gear icon.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.local.set({ SHOW_SETTINGS_HINT: true });
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
  }
});

// Helper: send a message to a tab and await it to prevent the service worker from terminating prematurely
async function sendTabMessage(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch (err) {
    // Silently ignore errors (e.g., content script not ready or tab closed)
  }
}

// Removed getOtherModel, as fallback is now dynamic

// Helper: derive the video's duration (in minutes) from the transcript's last
// timestamp. The transcript is `[h:mm:ss]`/`[mm:ss]` lines; the final one is
// T_end. Used to compute a concrete per-Detail point count. Returns null if no
// timestamp can be parsed (the prompt then falls back to static directives).
function parseDurationMinutes(transcript) {
  if (!transcript || typeof transcript !== 'string') return null;
  const matches = transcript.match(/\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g);
  if (!matches || matches.length === 0) return null;
  const last = matches[matches.length - 1].replace(/[[\]]/g, '');
  const parts = last.split(':').map(Number);
  let seconds = 0;
  if (parts.length === 3) seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
  else if (parts.length === 2) seconds = parts[0] * 60 + parts[1];
  else return null;
  return seconds > 0 ? seconds / 60 : null;
}

// Delight stat: record one successful summary and the estimated watch-time it
// saved. "Saved" = the video's length minus the time to read the summary at
// READING_WPM, clamped at zero (a summary can't cost more than the video). When
// the duration couldn't be parsed we still count the summary but add 0 seconds.
// Fire-and-forget so it never delays the response to the panel.
const READING_WPM = 200;
function recordSummaryStat(summary, durationMinutes) {
  const words = (summary || '').trim().split(/\s+/).filter(Boolean).length;
  const readMinutes = words / READING_WPM;
  const savedMinutes = durationMinutes ? Math.max(0, durationMinutes - readMinutes) : 0;
  const savedSeconds = Math.round(savedMinutes * 60);
  chrome.storage.local.get(['SUMMARIES_COUNT', 'SECONDS_SAVED'], (res) => {
    chrome.storage.local.set({
      SUMMARIES_COUNT: (res.SUMMARIES_COUNT || 0) + 1,
      SECONDS_SAVED: (res.SECONDS_SAVED || 0) + savedSeconds,
    });
  });
}

// Helper: create LLM client by model name
function getClient(modelName) {
  const provider = PROVIDERS[modelName.toLowerCase()];
  if (!provider) throw new Error(`Unsupported model: ${modelName}`);
  return new provider.clientClass();
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
    handleGeminiAnalysis(sendResponse, request.model, request.length).catch(err => {
      console.warn('Unhandled error in handleGeminiAnalysis:', err);
      sendResponse({ success: false, error: err.message || 'Unknown error occurred' });
    });
    return true;
  }
});

async function handleGeminiAnalysis(sendResponse, modelName = 'gemini', length) {
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
    
    // Fetch all storage keys dynamically based on registry
    const storageKeys = Object.values(PROVIDERS).map(p => p.storageKey);
    storageKeys.push('SUMMARY_LENGTH');
    const storage = await chrome.storage.local.get(storageKeys);

    // Resolve the summary "Detail" preset: explicit request wins, then the
    // persisted preference, then the standard default. Passed to every callAPI.
    const summaryOptions = { length: length || storage.SUMMARY_LENGTH || 'standard' };
    
    // 2. Resolve 'auto' to actual model
    let resolvedModel = modelName;
    if (modelName === 'auto') {
      const availableProviders = Object.keys(PROVIDERS).filter(id => storage[PROVIDERS[id].storageKey]);
      if (availableProviders.length > 0) {
        resolvedModel = availableProviders[0];
      } else {
        resolvedModel = Object.keys(PROVIDERS)[0]; // fallback to first provider so it can trigger 'no key' error
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

    // Derive the real duration so the prompt can inject concrete point/section
    // counts (falls back to static directives if it can't be parsed).
    summaryOptions.durationMinutes = parseDurationMinutes(transcriptResponse.data);
    console.log(`Transcript duration (min): ${summaryOptions.durationMinutes}`);
    
    // 5. Get API key for resolved model
    const apiKey = storage[PROVIDERS[resolvedModel].storageKey];
    console.log(`Getting API key for model: ${resolvedModel}`);
    
    if (!apiKey) {
      // If auto mode, try another model's key
      if (originalModel === 'auto') {
        const fallbackModel = Object.keys(PROVIDERS).find(id => id !== resolvedModel && storage[PROVIDERS[id].storageKey]);
        if (fallbackModel) {
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
        const errorMsg = `API Key not found for ${PROVIDERS[resolvedModel].name}. Please set it in settings.`;
        console.warn(errorMsg);
        await sendTabMessage(tab.id, { action: "PROGRESS_UPDATE", phase: "error", message: errorMsg });
        sendResponse({ success: false, error: errorMsg });
        return;
      }
    }
    
    const finalApiKey = storage[PROVIDERS[resolvedModel].storageKey];
    console.log(`API Key found for ${resolvedModel}, length: ${finalApiKey?.length}`);
    
    // 6. Call the LLM API
    console.log('Sending PROGRESS_UPDATE: calling_api');
    await sendTabMessage(tab.id, { action: "PROGRESS_UPDATE", phase: "calling_api" });
    console.log(`Calling ${resolvedModel} API...`);
    
    let summary;
    try {
      summary = await llmClient.callAPI(finalApiKey, transcriptResponse.data, summaryOptions);
    } catch (apiErr) {
      console.warn(`API call failed for ${resolvedModel}:`, apiErr.message);
      
      // Auto fallback: try another model with the same transcript
      if (originalModel === 'auto') {
        const fallbackModel = Object.keys(PROVIDERS).find(id => id !== resolvedModel && storage[PROVIDERS[id].storageKey]);
        console.log(`${resolvedModel} failed, trying ${fallbackModel || 'none'}...`);
        
        if (!fallbackModel) {
          console.warn(`No API key for any fallback model`);
          sendResponse({ success: false, error: apiErr.message });
          return;
        }

        await sendTabMessage(tab.id, { action: "PROGRESS_UPDATE", phase: "calling_api", message: `Trying ${PROVIDERS[fallbackModel].name}...` });
        
        const fallbackKey = storage[PROVIDERS[fallbackModel].storageKey];
        const fallbackClient = getClient(fallbackModel);
        summary = await fallbackClient.callAPI(fallbackKey, transcriptResponse.data, summaryOptions);
        console.log(`Fallback to ${fallbackModel} succeeded`);
        resolvedModel = fallbackModel;
      } else {
        throw apiErr;
      }
    }
    
    console.log('API call completed successfully, summary length:', summary?.length);

    // Count this successful generation + accumulate estimated time saved.
    recordSummaryStat(summary, summaryOptions.durationMinutes);

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
