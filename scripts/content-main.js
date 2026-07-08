// scripts/content-main.js

// Global state
let currentVideoId = null;
let currentModel = 'gemini';

// Initialize
function initApp() {
    window.addEventListener('yt-navigate-start', resetSidebar);
    window.addEventListener('yt-navigate-finish', handleNavigation);
    
    // Load the selected model from storage
    chrome.storage.local.get(['SELECTED_MODEL'], (result) => {
        if (result.SELECTED_MODEL) {
            currentModel = result.SELECTED_MODEL;
        }
    });

    // Keep the panel in sync when API keys change (fires across tabs, e.g. after
    // saving a key on the settings page): refresh the model dropdown and flip the
    // primary button between "Generate summary" and "Set API keys".
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes.GEMINI_API_KEY || changes.MISTRAL_API_KEY) {
            const selectEl = document.getElementById('header-model-select');
            if (typeof updateModelDropdown === 'function') updateModelDropdown(selectEl);
            if (typeof refreshGenerateButtonMode === 'function') refreshGenerateButtonMode();
        }
    });

    // Initial check
    handleNavigation();
}

function resetSidebar() {
    if (typeof disconnectPlayerObserver === 'function') {
        disconnectPlayerObserver();
    }
    const container = document.querySelector('.yt-timestamps-container');
    if (container) container.remove();
    if (typeof _invalidateCache === 'function') {
        _invalidateCache();
    }
}

function handleNavigation() {
    const videoId = new URLSearchParams(window.location.search).get('v');
    if (!videoId) {
        currentVideoId = null;
        return;
    }
    if (videoId !== currentVideoId) {
        currentVideoId = videoId;
        if (typeof clearSummaryCache === 'function') {
            clearSummaryCache(currentVideoId);
        }
    }
    // Always re-inject if sidebar is missing (handles miniplayer toggle, SPA nav, etc.)
    observeDOM();
}

// Function to update the current model
function updateCurrentModel(model) {
    currentModel = model;
    chrome.storage.local.set({ SELECTED_MODEL: model });
}

initApp();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "GET_TRANSCRIPT") {
        extractTranscript()
            .then(result => sendResponse(result))
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    } else if (request.action === "RENDER_TIMESTAMPS") {
        try {
            renderTimestampsUI(request.data);
            sendResponse({ success: true });
        } catch (err) {
            sendResponse({ success: false, error: err.message });
        }
        return true;
    } else if (request.action === "PROGRESS_UPDATE") {
        if (typeof updateGenerateButton === 'function') {
            updateGenerateButton(request.phase, request.message, request.keepOpen);
        }
        sendResponse({ success: true });
        return true;
    } else if (request.action === "KEYS_CHANGED") {
        const selectEl = document.getElementById('header-model-select');
        if (typeof updateModelDropdown === 'function') {
            updateModelDropdown(selectEl);
        }
        if (typeof refreshGenerateButtonMode === 'function') {
            refreshGenerateButtonMode();
        }
        sendResponse({ success: true });
        return true;
    }
});