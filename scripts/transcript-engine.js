// scripts/transcript-engine.js

// Selectors based on constants
const SELECTORS = {
  OLD: {
    segment: 'ytd-transcript-segment-renderer',
    timestamp: '.segment-timestamp, #timestamp',
    content: '.segment-text, #content'
  },
  NEW: {
    segment: 'transcript-segment-view-model',
    timestamp: '.ytwTranscriptSegmentViewModelTimestamp',
    content: 'span[role="text"]'
  }
};

// Generic panel selector (we'll find the one with actual segments)
const PANEL_SELECTOR = 'ytd-engagement-panel-section-list-renderer';

// Find any panel that contains transcript segments
function findPanelWithSegments() {
  const panels = document.querySelectorAll(PANEL_SELECTOR);
  for (const panel of panels) {
    // Check for new UI segments first
    if (panel.querySelector(SELECTORS.NEW.segment)) {
      return { element: panel, type: 'new' };
    }
    // Check for old UI segments
    if (panel.querySelector(SELECTORS.OLD.segment)) {
      return { element: panel, type: 'old' };
    }
  }
  return null;
}

// Extract segments from a panel that has already been identified
function getSegments(panelInfo) {
  const selector = panelInfo.type === 'new' ? SELECTORS.NEW.segment : SELECTORS.OLD.segment;
  return Array.from(panelInfo.element.querySelectorAll(selector));
}

// Function to extract transcript from YouTube video
async function extractTranscript() {
  try {
    // 1. Check if any transcript panel is already open and populated
    let segments = findSegmentsInOpenPanel();
    if (segments.length > 0) {
      return extractFromSegments(segments, getPanelTypeFromSegments(segments));
    }

    // 2. Find the transcript button
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

    // 3. Click and wait for the panel to populate
    transcriptBtn.click();
    await sleep(1000);

    // 4. Detect which panel opened and extract segments
    // Try to find segments in either new or old panel
    const panelInfo = await waitForTranscriptPanel();
    if (!panelInfo) {
      return { success: false, error: "Panel opened but no segments found." };
    }

    // 5. Clean up: close the transcript panel (old or new)
    closeTranscriptPanel(panelInfo.panel);

    return extractFromSegments(panelInfo.segments, panelInfo.type);
  } catch (err) {
    return { success: false, error: "Extraction error: " + err.message };
  }
}

// Find segments in an already open transcript panel
function findSegmentsInOpenPanel() {
  const panelInfo = findPanelWithSegments();
  if (panelInfo) {
    const segments = getSegments(panelInfo);
    if (segments.length > 0) return segments;
  }
  return [];
}

// Determine panel type from found segments
function getPanelTypeFromSegments(segments) {
  if (segments.length === 0) return null;
  // Check if the first segment matches the new UI structure
  if (segments[0].matches(SELECTORS.NEW.segment)) return 'new';
  return 'old';
}

// Wait for a transcript panel to appear and load its segments
async function waitForTranscriptPanel() {
  const panelInfo = findPanelWithSegments();

  if (!panelInfo) return null;

  // Modern UI (with loading spinner): use MutationObserver for speed
  if (panelInfo.type === 'new') {
    return waitForModernPanelContent(panelInfo.element);
  }

  // Legacy UI: ensure panel is expanded and poll for segments
  return pollForPanelContent(panelInfo, 10, 1000);
}

// Use MutationObserver to detect when modern panels finish loading
function waitForModernPanelContent(panel, timeout = 20000) {
  return new Promise((resolve) => {
    // Check immediately
    const segments = Array.from(panel.querySelectorAll(SELECTORS.NEW.segment));
    if (segments.length > 0) {
      resolve({ segments, type: 'new', panel });
      return;
    }

    const contentContainer = panel.querySelector('#content');
    if (!contentContainer) {
      resolve(null);
      return;
    }

    const observer = new MutationObserver(() => {
      const segments = Array.from(panel.querySelectorAll(SELECTORS.NEW.segment));
      if (segments.length > 0) {
        clearTimeout(timer);
        observer.disconnect();
        resolve({ segments, type: 'new', panel });
      }
    });

    observer.observe(contentContainer, { childList: true, subtree: true });

    const timer = setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeout);
  });
}

// Poll any panel type until segments appear or max attempts reached
async function pollForPanelContent(panelInfo, maxAttempts, interval) {
  for (let i = 0; i < maxAttempts; i++) {
    // Re-query for panels in case the DOM changed
    const currentInfo = findPanelWithSegments();
    if (currentInfo && currentInfo.type === panelInfo.type) {
      if (currentInfo.type === 'old') {
        currentInfo.element.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED');
      }
      const segments = getSegments(currentInfo);
      if (segments.length > 0) {
        return { segments, type: currentInfo.type, panel: currentInfo.element };
      }
    }
    await sleep(interval);
  }
  return null;
}

// Close the transcript panel cleanly using native UI elements to avoid breaking YouTube's internal state
function closeTranscriptPanel(targetPanel) {
  const panelsToClose = targetPanel ? [targetPanel] : Array.from(document.querySelectorAll(PANEL_SELECTOR));

  for (const panel of panelsToClose) {
    if (panel.getAttribute('visibility') === 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED') {
      const hasSegments = panel.querySelector(SELECTORS.OLD.segment) ||
                          panel.querySelector(SELECTORS.NEW.segment);
      if (hasSegments || targetPanel) {
        // Try finding the native close button inside the panel header
        const closeBtn = panel.querySelector('#visibility-button button, #close-button button, button[aria-label="Close transcript"], button[aria-label="Close"]');
        if (closeBtn) {
          closeBtn.click();
        } else {
          // Fallback: try clicking the transcript toggle button again
          const transcriptBtn = findTranscriptButton();
          if (transcriptBtn) {
            transcriptBtn.click();
          } else {
            // Absolute fallback: manipulate DOM attribute (may break state)
            panel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN');
          }
        }
      }
    }
  }
}

// Function to find transcript button using a more robust method
function findTranscriptButton() {
  // 1. Primary: Look inside the transcript section renderer for the button with aria-label="Show transcript"
  //    This targets the actual <button> element inside the custom element, which is more reliable for .click()
  const transcriptSectionButton = document.querySelector('ytd-video-description-transcript-section-renderer ytd-button-renderer button[aria-label="Show transcript"]');
  if (transcriptSectionButton) {
    return transcriptSectionButton;
  }

  // 2. Fallback: Search all ytd-button-renderer elements for one containing the exact text
  const allButtonRenderers = Array.from(document.querySelectorAll('ytd-button-renderer'));
  const textMatch = allButtonRenderers.find(btn => btn.textContent.trim() === 'Show transcript');
  if (textMatch) {
    return textMatch;
  }

  // 3. Fallback: Search all buttons for aria-label="Show transcript"
  const allButtons = Array.from(document.querySelectorAll('button'));
  const ariaMatch = allButtons.find(btn => btn.getAttribute('aria-label') === 'Show transcript');
  if (ariaMatch) {
    return ariaMatch.closest('ytd-button-renderer') || ariaMatch;
  }

  return null;
}

// Function to extract from segments
function extractFromSegments(segments, panelType) {
  let output = "";

  if (panelType === 'new') {
    segments.forEach(segment => {
      const timestampEl = segment.querySelector(SELECTORS.NEW.timestamp);
      const textEl = segment.querySelector(SELECTORS.NEW.content);
      const timestamp = timestampEl?.textContent.trim();
      const text = textEl?.textContent.trim();
      if (timestamp && text) output += `[${timestamp}] ${text}\n`;
    });
  } else {
    // Default to old logic for backward compatibility
    segments.forEach(segment => {
      const timestamp = segment.querySelector(SELECTORS.OLD.timestamp)?.textContent.trim();
      const text = segment.querySelector(SELECTORS.OLD.content)?.textContent.trim();
      if (timestamp && text) output += `[${timestamp}] ${text}\n`;
    });
  }

  if (output.length === 0) {
    return { success: false, error: "Could not parse any segments from the panel." };
  }

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
