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
    
    // Initial check
    handleNavigation();
}

function resetSidebar() {
    const container = document.querySelector('.yt-timestamps-container');
    if (container) container.remove();
}

function handleNavigation() {
    const videoId = new URLSearchParams(window.location.search).get('v');
    if (videoId && videoId !== currentVideoId) {
        currentVideoId = videoId;
        resetSidebar();
        
        // Use MutationObserver for DOM changes
        observeDOM();
    }
}

// Function to update the current model
function updateCurrentModel(model) {
    currentModel = model;
    chrome.storage.local.set({ SELECTED_MODEL: model });
}

initApp();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "GET_TRANSCRIPT") {
        extractTranscript().then(sendResponse);
        return true;
    } else if (request.action === "RENDER_TIMESTAMPS") {
        // Use the new renderTimestampsUI function from ui-builder.js
        if (typeof renderTimestampsUI === 'function') {
            renderTimestampsUI(request.data);
        } else {
            // Fallback to original renderTimestamps if the new function is not available
            renderTimestamps(request.data);
        }
        sendResponse({ success: true });
        return true;
    }
});