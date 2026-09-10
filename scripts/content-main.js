// scripts/content-main.js

// Global state
let currentVideoId = null;

// Initialize
function initApp() {
    window.addEventListener('yt-navigate-start', resetSidebar);
    window.addEventListener('yt-navigate-finish', handleNavigation);

    // Settings live in chrome.storage.local alongside every API key, and that
    // store is closed to content scripts. So the panel is told about changes
    // rather than watching for them: the background sends PREFS_CHANGED (handled
    // below) with the display preferences and a single "is anything configured"
    // boolean, and nothing secret crosses into the page.

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
    // The tracker holds listeners on the outgoing video element; release them
    // before YouTube swaps it for the next one.
    if (typeof stopPlaybackTracking === 'function') {
        stopPlaybackTracking();
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
    } else if (request.action === "PREFS_CHANGED") {
        // A key saved on the settings page, an appearance override, or the
        // Detail default changing in another tab. Re-theme, re-skin, and flip
        // the primary button between "Generate summary" and "Add API key".
        if (typeof applyPanelPrefs === 'function') {
            applyPanelPrefs(request.prefs);
        }
        sendResponse({ success: true });
        return true;
    }
});