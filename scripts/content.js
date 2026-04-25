if (window.ytTranscriptInjected) {
  // Already injected
} else {
  window.ytTranscriptInjected = true;
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "GET_TRANSCRIPT") {
      extractTranscript().then(sendResponse);
      return true; // Keep the message channel open for async response
    }
  });
}

async function extractTranscript() {
  try {
    // 1. Try to find the "Show transcript" button
    let transcriptBtn = findTranscriptButton();
    
    if (!transcriptBtn) {
      // Try to expand the description first
      const expandBtn = document.querySelector('tp-yt-paper-button#expand, #expand-button, .ytd-video-secondary-info-renderer #expand');
      if (expandBtn) {
        expandBtn.click();
        await sleep(500);
        transcriptBtn = findTranscriptButton();
      }
    }

    if (!transcriptBtn) {
      // One more try: search for the button in the whole description area
      const descriptionArea = document.querySelector('#description');
      if (descriptionArea) {
        transcriptBtn = Array.from(descriptionArea.querySelectorAll('button, ytd-button-renderer'))
          .find(btn => btn.textContent.toLowerCase().includes('show transcript'));
      }
    }

    if (!transcriptBtn) {
      return { success: false, error: "Transcript button not found. Is it a video with no transcript?" };
    }

    // 2. Click the button
    // Ensure we are clicking the actual button element if it's wrapped in ytd-button-renderer
    const targetClick = transcriptBtn.tagName.toLowerCase() === 'ytd-button-renderer' 
      ? transcriptBtn.querySelector('button') || transcriptBtn 
      : transcriptBtn;
    
    targetClick.click();

    // 3. Wait for the transcript panel to appear
    // The container is often ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]
    const panelLoaded = await waitForElement('ytd-transcript-segment-renderer', 8000);
    
    if (!panelLoaded) {
      // Try clicking again, sometimes the first click only focuses or something
      targetClick.click();
      const secondAttempt = await waitForElement('ytd-transcript-segment-renderer', 4000);
      if (!secondAttempt) {
        return { success: false, error: "Transcript panel didn't appear after clicking." };
      }
    }

    // 4. Extract data
    const segments = document.querySelectorAll('ytd-transcript-segment-renderer');
    if (segments.length === 0) {
      return { success: false, error: "No transcript segments found in the panel." };
    }

    let output = "";
    segments.forEach(segment => {
      const timestamp = segment.querySelector('.segment-timestamp, #timestamp')?.textContent.trim();
      const text = segment.querySelector('.segment-text, #content')?.textContent.trim();
      if (timestamp && text) {
        output += `[${timestamp}] ${text}\n`;
      }
    });

    return { success: true, data: output };

  } catch (err) {
    return { success: false, error: "Extraction error: " + err.message };
  }
}

function findTranscriptButton() {
  const buttons = Array.from(document.querySelectorAll('button, ytd-button-renderer'));
  
  // Strategy 1: Text content match
  let btn = buttons.find(btn => 
    btn.textContent.toLowerCase().includes('show transcript')
  );

  // Strategy 2: Aria-label match
  if (!btn) {
    btn = buttons.find(btn => 
      btn.getAttribute('aria-label')?.toLowerCase().includes('show transcript')
    );
  }

  // Strategy 3: Search for the specific YouTube transcript button structure
  if (!btn) {
    btn = document.querySelector('ytd-button-renderer[aria-label*="transcript"] button');
  }

  return btn;
}

function waitForElement(selector, timeout) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);
      if (Date.now() - start > timeout) return resolve(null);
      setTimeout(check, 100);
    };
    check();
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
