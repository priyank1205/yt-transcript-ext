// scripts/transcript-engine.js

// Function to extract transcript from YouTube video
async function extractTranscript() {
  try {
    let transcriptBtn = findTranscriptButton();
    if (!transcriptBtn) {
      const expandBtn = document.querySelector('tp-yt-paper-button.expand-button, #expand-button');
      if (expandBtn) {
        expandBtn.click();
        await sleep(1000);
        transcriptBtn = findTranscriptButton();
      }
    }
    if (!transcriptBtn) return { success: false, error: "Sorry! This video has no captions" };
    transcriptBtn.click();
    await sleep(1000);
    const panel = document.querySelector('ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]');
    if (!panel) return { success: false, error: "Transcript panel container not found." };
    const originalVisibility = panel.getAttribute('visibility');
    panel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED');
    await sleep(1000);
    const segments = Array.from(document.querySelectorAll('ytd-transcript-segment-renderer'));
    if (originalVisibility) panel.setAttribute('visibility', originalVisibility); else panel.removeAttribute('visibility');
    if (segments.length === 0) return { success: false, error: "Panel opened but no segments found." };
    return extractFromSegments(segments);
  } catch (err) { return { success: false, error: "Extraction error: " + err.message }; }
}

// Function to find transcript button using a more robust method
function findTranscriptButton() {
  // Use a more specific selector to find the transcript button
  const transcriptButton = document.querySelector('ytd-video-secondary-info-renderer ytd-button-renderer');
  if (transcriptButton) {
    return transcriptButton;
  }
  // Fallback to text-based search
  const allButtons = Array.from(document.querySelectorAll('button, ytd-button-renderer'));
  return allButtons.find(btn => btn.textContent.toLowerCase().includes('show transcript'));
}

// Function to extract from segments
function extractFromSegments(segments) {
    let output = "";
    segments.forEach(segment => {
      const timestamp = segment.querySelector('.segment-timestamp, #timestamp')?.textContent.trim();
      const text = segment.querySelector('.segment-text, #content')?.textContent.trim();
      if (timestamp && text) output += `[${timestamp}] ${text}\n`;
    });
    return { success: true, data: output };
}

// Helper function for sleep
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Export functions for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    extractTranscript,
    findTranscriptButton,
    extractFromSegments,
    sleep
  };
}