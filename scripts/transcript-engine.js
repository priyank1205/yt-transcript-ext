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

// Generic panel selector. Used only to locate the panel that owns the segments,
// so we can close it again afterwards — never to decide where to look for them.
const PANEL_SELECTOR = 'ytd-engagement-panel-section-list-renderer';

// How long to wait for segments to arrive, and how often to look. They come over
// the network, so on a cold cache they can take seconds.
const SEGMENT_TIMEOUT = 20000;
const POLL_INTERVAL = 250;

// Find transcript segments anywhere on the page.
//
// Deliberately document-wide rather than scoped to a chosen panel. YouTube ships
// several transcript panel variants — the plain "Transcript" panel, and the
// combined "In this video" panel with either Chapters or Timeline tabs — and the
// segments do not always live in the panel tagged
// engagement-panel-searchable-transcript. That panel can sit in the DOM as an
// empty stub while a different panel holds the real content, so anchoring the
// search to it makes those variants fail every time.
//
// Returns { segments, type, panel } or null when nothing is rendered yet.
function findRenderedSegments() {
  const variants = [
    { type: 'new', selector: SELECTORS.NEW.segment },
    { type: 'old', selector: SELECTORS.OLD.segment }
  ];

  for (const { type, selector } of variants) {
    const nodes = document.querySelectorAll(selector);
    if (nodes.length > 0) {
      const segments = Array.from(nodes);
      return { segments, type, panel: findOwningPanel(segments[0]) };
    }
  }
  return null;
}

// The panel a segment lives in, so it can be closed afterwards. Falls back to any
// ancestor carrying a target-id, then to any engagement-panel-ish ancestor, so a
// panel variant we don't know by name still gets closed rather than left open.
function findOwningPanel(segment) {
  const known = segment.closest(PANEL_SELECTOR) || segment.closest('[target-id]');
  if (known) return known;

  for (let node = segment.parentElement; node; node = node.parentElement) {
    if (node.tagName.toLowerCase().includes('engagement-panel')) return node;
  }
  return null;
}

// Does this panel currently hold any segments, of either generation?
function panelHasSegments(panel) {
  return Boolean(panel.querySelector(SELECTORS.NEW.segment) ||
                 panel.querySelector(SELECTORS.OLD.segment));
}

// Function to extract transcript from YouTube video
async function extractTranscript() {
  try {
    // 1. Check if a transcript is already open and populated
    const alreadyOpen = findRenderedSegments();
    if (alreadyOpen) {
      return extractFromSegments(alreadyOpen.segments, alreadyOpen.type);
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

    // 3. Open the panel; the waiting happens in step 4.
    transcriptBtn.click();

    // 4. Wait for YouTube to render the segments, wherever they land.
    const panelInfo = await waitForTranscriptSegments();
    if (!panelInfo) {
      // Don't leave a half-opened panel behind when extraction fails.
      logPanelDiagnostics();
      closeTranscriptPanel();
      return { success: false, error: "Panel opened but no segments found." };
    }

    // 5. Clean up: close whichever panel the segments turned up in
    closeTranscriptPanel(panelInfo.panel);

    return extractFromSegments(panelInfo.segments, panelInfo.type);
  } catch (err) {
    return { success: false, error: "Extraction error: " + err.message };
  }
}

// Wait for YouTube to render the transcript.
//
// Polling rather than a MutationObserver: the segments can land in any of several
// panels depending on the variant, so there is no single node that is reliably
// worth observing. A 250ms poll of two tag selectors is cheap and variant-proof.
async function waitForTranscriptSegments(timeout = SEGMENT_TIMEOUT) {
  const deadline = Date.now() + timeout;
  let previousCount = 0;

  while (Date.now() < deadline) {
    const found = findRenderedSegments();
    if (found) {
      // Return only once the count stops growing, so a transcript that renders
      // incrementally is never captured half-finished — a truncated transcript
      // fails silently, unlike a missing one.
      if (found.segments.length === previousCount) return found;
      previousCount = found.segments.length;
    }
    await sleep(POLL_INTERVAL);
  }
  return null;
}

// Log what was actually on the page when extraction failed. YouTube's panel
// markup varies by rollout, so this is what makes an unrecognised variant
// diagnosable from a user's console instead of guesswork.
function logPanelDiagnostics() {
  try {
    const panels = Array.from(document.querySelectorAll(PANEL_SELECTOR)).map(panel => ({
      targetId: panel.getAttribute('target-id'),
      visibility: panel.getAttribute('visibility'),
      hasSegments: panelHasSegments(panel),
      childTags: [...new Set(
        Array.from(panel.querySelectorAll('*')).map(el => el.tagName.toLowerCase())
      )].filter(tag => tag.includes('transcript') || tag.includes('segment'))
    }));
    console.warn('[yt-transcript-ext] No segments found. Panels on page:', panels);
  } catch (err) {
    console.warn('[yt-transcript-ext] Diagnostics failed:', err);
  }
}

// Close the transcript panel cleanly using native UI elements to avoid breaking
// YouTube's internal state. With an explicit panel (the one the segments were
// actually found in) we close it directly: the "In this video" variants don't
// always carry a visibility attribute, so gating on that left them open.
// Without one — the failure path — fall back to closing expanded panels that
// look like a transcript.
function closeTranscriptPanel(targetPanel) {
  if (targetPanel) {
    closePanel(targetPanel);
    return;
  }

  for (const panel of document.querySelectorAll(PANEL_SELECTOR)) {
    if (panel.getAttribute('visibility') !== 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED') continue;
    const targetId = panel.getAttribute('target-id') || '';
    if (panelHasSegments(panel) || targetId.includes('transcript')) {
      closePanel(panel);
    }
  }
}

// Click a panel's own close control, preferring native UI over attribute edits.
function closePanel(panel) {
  const closeBtn = panel.querySelector(
    '#visibility-button button, #close-button button, ' +
    'button[aria-label*="Close" i], [role="button"][aria-label*="Close" i]'
  );
  if (closeBtn) {
    closeBtn.click();
    return;
  }

  // Fallback: try clicking the transcript toggle button again
  const transcriptBtn = findTranscriptButton();
  if (transcriptBtn) {
    transcriptBtn.click();
    return;
  }

  // Absolute fallback: manipulate DOM attribute (may break state)
  if (panel.hasAttribute('visibility')) {
    panel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN');
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
