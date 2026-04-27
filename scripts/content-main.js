// scripts/content-main.js

// Global state
let currentVideoId = null;

// Initialize
function initApp() {
    window.addEventListener('yt-navigate-start', resetSidebar);
    window.addEventListener('yt-navigate-finish', handleNavigation);
    
    // Initial check
    handleNavigation();
}

// Function to toggle settings panel visibility
function toggleSettings() {
    const settingsPanel = document.querySelector('.yt-timestamp-settings-panel');
    if (settingsPanel) {
        const isVisible = settingsPanel.style.display === 'block';
        settingsPanel.style.display = isVisible ? 'none' : 'block';
    }
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

initApp();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "GET_TRANSCRIPT") {
        extractTranscript().then(sendResponse);
        return true;
    } else if (request.action === "RENDER_TIMESTAMPS") {
        renderTimestamps(request.data);
        sendResponse({ success: true });
        return true;
    }
});