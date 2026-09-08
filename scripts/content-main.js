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
        // Any provider's key, and the custom-provider list: naming two of them
        // meant configuring OpenAI or Anthropic left the button saying "Set API
        // keys" until the page was reloaded.
        const providerChanged = Object.keys(changes).some(key => key.endsWith('_API_KEY')) ||
            !!changes.CUSTOM_PROVIDERS;
        if (providerChanged) {
            if (typeof refreshGenerateButtonMode === 'function') refreshGenerateButtonMode();
        }
        // Appearance override changed (e.g. from the settings tab): re-theme the panel.
        if (changes.THEME_PREF && typeof setPanelThemePref === 'function') {
            setPanelThemePref(changes.THEME_PREF.newValue || 'system');
        }
        // Design skin changed (Classic vs Quiet preview): re-skin the panel live.
        if (changes.PANEL_SKIN && typeof setPanelSkinPref === 'function') {
            setPanelSkinPref(changes.PANEL_SKIN.newValue || 'quiet');
        }
    });

    // Initial check
    handleNavigation();
}

function resetSidebar() {
    // Fires on yt-navigate-start, before the new page settles: whatever is being
    // generated was started for the video being left, so stop it here rather
    // than letting it finish into a panel that no longer belongs to it.
    if (typeof cancelActiveRequest === 'function') {
        cancelActiveRequest('navigation');
    }
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
        // Covers the SPA navigations that don't fire yt-navigate-start.
        if (typeof cancelActiveRequest === 'function') {
            cancelActiveRequest('navigation');
        }
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
        // The request names the video it was started for; extraction refuses to
        // answer for a different one rather than returning the wrong transcript.
        extractTranscript(request.videoId)
            .then(result => sendResponse(result))
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    } else if (request.action === "RENDER_TIMESTAMPS") {
        // A result belongs to the video and the generation it was made for.
        // Rendering unconditionally is how a summary of video A used to end up
        // attached to video B when the user navigated while it was running.
        if (typeof isCurrentGeneration === 'function' && !isCurrentGeneration(request)) {
            sendResponse({ success: false, stale: true });
            return true;
        }
        try {
            renderTimestampsUI(request.data, request.meta);
            sendResponse({ success: true });
        } catch (err) {
            sendResponse({ success: false, error: err.message });
        }
        return true;
    } else if (request.action === "PROGRESS_UPDATE") {
        if (typeof isCurrentGeneration === 'function' && !isCurrentGeneration(request)) {
            sendResponse({ success: false, stale: true });
            return true;
        }
        // Forward progress is proof the run is alive: it re-arms the panel's
        // idle timeout, so a long video summarised in several parts is not cut
        // off partway through for taking longer than one call's worth of time.
        if (typeof noteAnalysisProgress === 'function') noteAnalysisProgress();
        if (typeof updateGenerateButton === 'function') {
            // 'error' carries the classified payload from scripts/errors.js;
            // 'calling_api' may carry a message naming the part in progress.
            updateGenerateButton(request.phase, request.error ?? request.message);
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