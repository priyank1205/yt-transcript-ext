if (window.ytTranscriptInjected) {
  // Already injected
} else {
  window.ytTranscriptInjected = true;
  console.log("new script loaded");
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "GET_TRANSCRIPT") {
      extractTranscript().then(sendResponse);
      return true; // Keep the message channel open for async response
    }
  });
}

async function extractTranscript() {
  try {
    // 1. Find the button
    let transcriptBtn = findTranscriptButton();
    if (!transcriptBtn) {
      const expandBtn = document.querySelector('tp-yt-paper-button#expand, #expand-button');
      if (expandBtn) {
        expandBtn.click();
        await sleep(1000);
        transcriptBtn = findTranscriptButton();
      }
    }

    if (!transcriptBtn) {
      return { success: false, error: "Transcript button not found." };
    }

    // 2. Click to initialize the panel
    transcriptBtn.click();
    await sleep(1000);

    // 3. Find the panel and force visibility
    const panel = document.querySelector('ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]');
    if (!panel) {
      return { success: false, error: "Transcript panel container not found." };
    }
    
    panel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED');
    await sleep(1000);

    // 4. Extract segments
    const segments = Array.from(document.querySelectorAll('ytd-transcript-segment-renderer'));
    if (segments.length === 0) {
      return { success: false, error: "Panel opened but no segments found." };
    }

    return extractFromSegments(segments);

  } catch (err) {
    return { success: false, error: "Extraction error: " + err.message };
  }
}

function waitForSegments(timeout) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      // Query globally - YouTube's ShadyDOM renders these into the main DOM
      const segments = document.querySelectorAll('ytd-transcript-segment-renderer');
      if (segments.length > 0) return resolve(Array.from(segments));
      if (Date.now() - start > timeout) return resolve([]);
      setTimeout(check, 250);
    };
    check();
  });
}

function extractFromSegments(segments) {
    let output = "";
    segments.forEach(segment => {
      // Again, query directly within the segment element
      const timestamp = segment.querySelector('.segment-timestamp, #timestamp')?.textContent.trim();
      const text = segment.querySelector('.segment-text, #content')?.textContent.trim();
      if (timestamp && text) {
        output += `[${timestamp}] ${text}\n`;
      }
    });
    return { success: true, data: output };
}

function findTranscriptButton() {
  const allButtons = Array.from(document.querySelectorAll('button, ytd-button-renderer'));
  
  // Look for text match
  return allButtons.find(btn => {
    const text = btn.textContent.toLowerCase();
    return text.includes('show transcript');
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
