// scripts/content-main.js

// Global state
let currentVideoId = null;

// Initialize
function initApp() {
    window.addEventListener('yt-navigate-start', resetSidebar);
    window.addEventListener('yt-navigate-finish', handleNavigation);

    // Keep the panel in sync when API keys change (fires across tabs, e.g. after
    // saving a key on the settings page): flip the primary button between
    // "Generate summary" and "Set API keys".
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes.GEMINI_API_KEY || changes.MISTRAL_API_KEY) {
            if (typeof refreshGenerateButtonMode === 'function') refreshGenerateButtonMode();
        }
        // Appearance override changed (e.g. from the settings tab): re-theme the panel.
        if (changes.THEME_PREF && typeof setPanelThemePref === 'function') {
            setPanelThemePref(changes.THEME_PREF.newValue || 'system');
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
        if (typeof refreshGenerateButtonMode === 'function') {
            refreshGenerateButtonMode();
        }
        sendResponse({ success: true });
        return true;
    }
});