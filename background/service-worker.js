// background/service-worker.js

import { PROVIDERS } from '../scripts/providers.js';
import { OpenAICompatibleClient } from '../scripts/openai-compatible-client.js';
import { getPlayerCaptions } from '../scripts/caption-reader.js';
import { classifyError, ERROR_CODES } from '../scripts/errors.js';

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

// Every analysis failure leaves through here. It categorises the error once and
// gives the panel what it needs to recover: a persistent explanation, the flag
// that decides whether "Open settings" is offered, and a sanitized message for
// the copyable diagnostics. The panel decides presentation; nothing downstream
// has to sniff error strings.
async function failAnalysis(tabId, sendResponse, input, context = {}) {
  const error = classifyError(input, context);
  console.warn(`Analysis failed [${error.code}] at ${error.stage || 'unknown'} stage:`, error.raw);
  if (tabId) await sendTabMessage(tabId, { action: "PROGRESS_UPDATE", phase: "error", error });
  sendResponse({ success: false, error });
  return error;
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

function getClient(modelName, allProviders) {
  const provider = allProviders[modelName.toLowerCase()];
  if (!provider) throw new Error(`Unsupported model: ${modelName}`);
  return new provider.clientClass(provider);
}

// Handle messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'GET_PLAYER_CAPTIONS') {
    getPlayerCaptions(request, sender).then(sendResponse).catch(() => {
      sendResponse({ success: false, error: 'Could not read player captions. Please refresh and try again.' });
    });
    return true;
  }
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
  if (request.action === "START_ANALYSIS") {
    handleAnalysis(sendResponse, request.model, request.length).catch(err => {
      console.warn('Unhandled error in handleAnalysis:', err);
      sendResponse({ success: false, error: classifyError(err, { stage: 'generation' }) });
    });
    return true;
  }
});

async function handleAnalysis(sendResponse, modelName = 'gemini', length) {
  const originalModel = modelName;
  console.log(`handleAnalysis called with model: ${originalModel}`);

  // Declared out here so the catch below can still report which provider and
  // model the request was using when it failed.
  let resolvedModel = modelName;
  let summaryOptions = null;

  try {
    // 1. Get the active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    console.log(`Active tab ID: ${tab?.id}`);
    
    if (!tab || !tab.id) {
      await failAnalysis(null, sendResponse, 'No active tab found', { stage: 'setup' });
      return;
    }
    
    const initialStorage = await chrome.storage.local.get(['CUSTOM_PROVIDERS']);
    const customProviders = initialStorage.CUSTOM_PROVIDERS || [];
    
    const allProviders = { ...PROVIDERS };
    customProviders.forEach(cp => {
      allProviders[cp.id] = {
        ...cp,
        clientClass: OpenAICompatibleClient
      };
    });

    // Fetch all storage keys dynamically based on registry
    const storageKeys = Object.values(allProviders).map(p => p.storageKey);
    const modelKeys = Object.values(allProviders).map(p => `${p.id}_MODEL`);
    storageKeys.push('SUMMARY_LENGTH');
    storageKeys.push(...modelKeys);
    const storage = await chrome.storage.local.get(storageKeys);

    // Resolve the summary "Detail" preset: explicit request wins, then the
    // persisted preference, then the standard default. Passed to every callAPI.
    summaryOptions = { length: length || storage.SUMMARY_LENGTH || 'standard' };

    // 2. Resolve 'auto' to actual model
    if (modelName === 'auto') {
      const availableProviders = Object.keys(allProviders).filter(id => storage[allProviders[id].storageKey] || (allProviders[id].isCustom && storage[allProviders[id].storageKey] === ''));
      if (availableProviders.length > 0) {
        resolvedModel = availableProviders[0];
      } else {
        resolvedModel = Object.keys(allProviders)[0]; // fallback to first provider so it can trigger 'no key' error
      }
      console.log(`Auto-resolved to: ${resolvedModel}`);
    }
    
    // 3. Create LLM client
    let llmClient = getClient(resolvedModel, allProviders);
    console.log(`Created LLM client for model: ${resolvedModel}`);
    
    // 4. Fetch transcript (once, reused for fallback)
    console.log('Sending PROGRESS_UPDATE: extracting');
    await sendTabMessage(tab.id, { action: "PROGRESS_UPDATE", phase: "extracting" });
    console.log('Fetching transcript...');
    const transcriptResponse = await llmClient.fetchTranscriptWithRetry(tab.id);
    console.log('Transcript fetched successfully:', transcriptResponse?.success);
    
    if (!transcriptResponse || !transcriptResponse.success) {
      await failAnalysis(tab.id, sendResponse,
        transcriptResponse || { message: "Could not connect to page.", code: ERROR_CODES.CAPTIONS_UNREADABLE },
        { stage: 'transcript', detail: summaryOptions.length });
      return;
    }

    // Derive the real duration so the prompt can inject concrete point/section
    // counts (falls back to static directives if it can't be parsed).
    summaryOptions.durationMinutes = parseDurationMinutes(transcriptResponse.data);
    console.log(`Transcript duration (min): ${summaryOptions.durationMinutes}`);
    
    // 5. Get API key for resolved model
    const apiKey = storage[allProviders[resolvedModel].storageKey];
    const isCustomEmptyKey = allProviders[resolvedModel].isCustom && apiKey === '';
    console.log(`Getting API key for model: ${resolvedModel}`);
    
    if (!apiKey && !isCustomEmptyKey) {
      // If auto mode, try another model's key
      if (originalModel === 'auto') {
        const fallbackModel = Object.keys(allProviders).find(id => id !== resolvedModel && (storage[allProviders[id].storageKey] || (allProviders[id].isCustom && storage[allProviders[id].storageKey] === '')));
        if (fallbackModel) {
          console.log(`No key for ${resolvedModel}, but ${fallbackModel} has a key. Switching.`);
          resolvedModel = fallbackModel;
          llmClient = getClient(resolvedModel, allProviders);
        } else {
          await failAnalysis(tab.id, sendResponse,
            { message: 'No API key found. Please set one in settings.', code: ERROR_CODES.NO_KEY },
            { stage: 'setup', detail: summaryOptions.length });
          return;
        }
      } else {
        await failAnalysis(tab.id, sendResponse,
          { message: `API key not found for provider ${resolvedModel}.`, code: ERROR_CODES.NO_KEY },
          { stage: 'setup', provider: resolvedModel, detail: summaryOptions.length });
        return;
      }
    }
    
    const finalApiKey = apiKey;
    console.log(`API Key found for ${resolvedModel}, length: ${finalApiKey?.length}`);
    
    // 6. Call the LLM API
    console.log('Sending PROGRESS_UPDATE: calling_api');
    await sendTabMessage(tab.id, { action: "PROGRESS_UPDATE", phase: "calling_api" });
    console.log(`Calling ${resolvedModel} API...`);
    
    let summary;
    try {
      summaryOptions.modelId = storage[`${resolvedModel}_MODEL`] || allProviders[resolvedModel].defaultModel;
      summary = await llmClient.callAPI(finalApiKey, transcriptResponse.data, summaryOptions);
    } catch (apiErr) {
      console.warn(`API call failed for ${resolvedModel}:`, apiErr.message);
      
      // Auto fallback: try another model with the same transcript
      if (originalModel === 'auto') {
        const fallbackModel = Object.keys(allProviders).find(id => id !== resolvedModel && (storage[allProviders[id].storageKey] || (allProviders[id].isCustom && storage[allProviders[id].storageKey] === '')));
        console.log(`${resolvedModel} failed, trying ${fallbackModel || 'none'}...`);
        
        if (!fallbackModel) {
          console.warn(`No API key for any fallback model`);
          await failAnalysis(tab.id, sendResponse, apiErr, {
            stage: 'generation', provider: resolvedModel,
            model: summaryOptions.modelId, detail: summaryOptions.length
          });
          return;
        }

        await sendTabMessage(tab.id, { action: "PROGRESS_UPDATE", phase: "calling_api", message: `Trying ${allProviders[fallbackModel].name}...` });
        
        const fallbackKey = storage[allProviders[fallbackModel].storageKey];
        const fallbackClient = getClient(fallbackModel, allProviders);
        summaryOptions.modelId = storage[`${fallbackModel}_MODEL`] || allProviders[fallbackModel].defaultModel;
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
    console.warn('Error in handleAnalysis:', err.message, err.stack);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => [null]);
    await failAnalysis(tab?.id || null, sendResponse, err, {
      stage: 'generation', provider: resolvedModel,
      model: summaryOptions?.modelId, detail: summaryOptions?.length
    });
  }
}
