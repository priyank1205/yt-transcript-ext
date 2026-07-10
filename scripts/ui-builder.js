// scripts/ui-builder.js

// Player height tracking
let _resizeHandler = null;
let _resizeTimer = null;
let _lastAppliedHeight = 0;
const ACCORDION_OFFSET = 50;

// Summary cache: stores generated summaries keyed by video ID
const _summaryCache = {};

// Track the currently expanded timestamp accordion
let _expandedAccordion = null;
let _expandedAccordionBtn = null;

// Cached DOM references for performance (invalidated when panel rebuilds)
let _cachedPanel = null;
let _cachedPanelBody = null;

function _getPanel() {
    if (_cachedPanel && document.contains(_cachedPanel)) {
        return _cachedPanel;
    }
    _cachedPanel = document.querySelector('.yt-timestamps-panel');
    return _cachedPanel;
}

function _getPanelBody() {
    if (_cachedPanelBody && document.contains(_cachedPanelBody)) {
        return _cachedPanelBody;
    }
    _cachedPanelBody = document.querySelector('.yt-accordion-body');
    return _cachedPanelBody;
}

function _invalidateCache() {
    _cachedPanel = null;
    _cachedPanelBody = null;
}

// --- Panel theme (light/dark) ---------------------------------------------
// The panel ships a dark skin by default and adds a `yt-theme-light` class to
// the container when the resolved theme is light. Resolution: an explicit
// 'light'/'dark' override wins; 'system' (default) follows YouTube's own theme,
// which YouTube signals via the `dark` attribute on <html>.
let _themePref = 'system';
let _ytThemeObserver = null;

function getYouTubeTheme() {
    return document.documentElement.hasAttribute('dark') ? 'dark' : 'light';
}

function applyPanelTheme(pref, containerEl) {
    const container = containerEl || document.querySelector('.yt-timestamps-container');
    if (!container) return;
    const mode = (pref === 'light' || pref === 'dark') ? pref : getYouTubeTheme();
    container.classList.toggle('yt-theme-light', mode === 'light');
}

// Update the stored preference and re-apply (called when the override changes).
function setPanelThemePref(pref) {
    _themePref = pref || 'system';
    applyPanelTheme(_themePref);
}

// Follow live YouTube theme toggles while the override is on 'system'.
function ensureYtThemeObserver() {
    if (_ytThemeObserver) return;
    _ytThemeObserver = new MutationObserver(() => {
        if (_themePref === 'system') applyPanelTheme('system');
    });
    _ytThemeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['dark']
    });
}

function getCurrentVideoId() {
    return new URLSearchParams(window.location.search).get('v');
}

function cacheSummary(videoId, summaryText) {
    if (videoId && summaryText) {
        _summaryCache[videoId] = summaryText;
    }
}

function getCachedSummary(videoId) {
    return videoId ? _summaryCache[videoId] : null;
}

function clearSummaryCache(videoId) {
    if (videoId) {
        delete _summaryCache[videoId];
    }
}

function findVideoPlayer() {
    // Try specific YouTube player selectors, fall back to the <video> element
    const selectors = [
        '#movie_player',
        '#player .html5-video-container',
        'ytd-player',
        '.html5-video-player',
        '#player'
    ];
    for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.getBoundingClientRect().height > 0) return el;
    }
    // Last resort: the <video> element itself
    const video = document.querySelector('video');
    if (video && video.getBoundingClientRect().height > 0) return video;
    return null;
}

function applyPlayerHeight() {
    const player = findVideoPlayer();
    const panel = _getPanel();
    if (!panel) return;

    const header = panel.querySelector('.yt-timestamps-panel-header');
    const headerH = header ? header.offsetHeight : 45;

    if (!player) {
        const fallback = 550;
        if (_lastAppliedHeight === fallback) return;
        _lastAppliedHeight = fallback;
        panel.style.maxHeight = `${fallback}px`;
        const body = _getPanelBody();
        if (body) body.style.maxHeight = '500px';
        return;
    }

    const playerH = player.getBoundingClientRect().height;
    if (playerH <= 0) {
        const fallback = 550;
        if (_lastAppliedHeight === fallback) return;
        _lastAppliedHeight = fallback;
        panel.style.maxHeight = `${fallback}px`;
        const body = _getPanelBody();
        if (body) body.style.maxHeight = '500px';
        return;
    }

    const accordionMaxH = playerH + ACCORDION_OFFSET;
    if (_lastAppliedHeight === accordionMaxH) return;
    _lastAppliedHeight = accordionMaxH;

    panel.style.maxHeight = `${headerH + accordionMaxH}px`;
    const body = _getPanelBody();
    if (body) body.style.maxHeight = `${accordionMaxH}px`;
}

function observePlayerResize() {
    disconnectPlayerObserver();
    _resizeHandler = () => {
        clearTimeout(_resizeTimer);
        _resizeTimer = setTimeout(() => {
            const player = findVideoPlayer();
            applyPlayerHeight();
        }, 100);
    };
    window.addEventListener('resize', _resizeHandler);
}

function disconnectPlayerObserver() {
    if (_resizeHandler) {
        window.removeEventListener('resize', _resizeHandler);
        _resizeHandler = null;
    }
    if (_resizeTimer) {
        clearTimeout(_resizeTimer);
        _resizeTimer = null;
    }
    _lastAppliedHeight = 0;
}

// The per-video "Detail" presets, ordered from least to most detail. `value` is
// what we persist (SUMMARY_LENGTH) and send to the backend; `label` is shown to
// the user. Middle (Standard) is the smart default.
const DETAIL_OPTIONS = [
    { value: 'brief', label: 'Brief' },
    { value: 'standard', label: 'Standard' },
    { value: 'detailed', label: 'In-depth' }
];
const DETAIL_DEFAULT_INDEX = 1;

// Build the "Detail" slider: an Effort-style track (title + current value,
// Quick↔Thorough end caps, three dots + a thumb). Selecting a level persists
// SUMMARY_LENGTH; the picked level is read back at generate time. The control is
// created with the default selected, then synced to the stored preference async.
function buildDetailSlider() {
    let index = DETAIL_DEFAULT_INDEX;
    const lastIndex = DETAIL_OPTIONS.length - 1;

    // Thumb width (must match CSS). Positions are inset by half the thumb so the
    // end stops and the thumb sit fully inside the rail instead of clipping.
    const THUMB_W = 22;
    const posLeft = (frac) => `calc(${THUMB_W / 2}px + (100% - ${THUMB_W}px) * ${frac})`;
    const fracOf = (i) => (lastIndex ? i / lastIndex : 0);

    const control = document.createElement('div');
    control.className = 'yt-detail-control';

    const head = document.createElement('div');
    head.className = 'yt-detail-head';
    const label = document.createElement('span');
    label.className = 'yt-detail-label';
    label.textContent = 'Detail';
    const value = document.createElement('span');
    value.className = 'yt-detail-value';
    head.appendChild(label);
    head.appendChild(value);

    const row = document.createElement('div');
    row.className = 'yt-detail-row';

    const capLeft = document.createElement('span');
    capLeft.className = 'yt-detail-cap';
    capLeft.textContent = 'Quick';

    const capRight = document.createElement('span');
    capRight.className = 'yt-detail-cap';
    capRight.textContent = 'Thorough';

    const rail = document.createElement('div');
    rail.className = 'yt-detail-rail';
    rail.setAttribute('role', 'slider');
    rail.setAttribute('tabindex', '0');
    rail.setAttribute('aria-label', 'Summary detail');
    rail.setAttribute('aria-valuemin', '0');
    rail.setAttribute('aria-valuemax', String(lastIndex));

    const fill = document.createElement('div');
    fill.className = 'yt-detail-fill';
    rail.appendChild(fill);

    const dots = DETAIL_OPTIONS.map((opt, i) => {
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'yt-detail-dot';
        dot.style.left = posLeft(fracOf(i));
        dot.setAttribute('aria-label', opt.label);
        dot.addEventListener('click', () => select(i));
        rail.appendChild(dot);
        return dot;
    });

    const thumb = document.createElement('div');
    thumb.className = 'yt-detail-thumb';
    rail.appendChild(thumb);

    row.appendChild(capLeft);
    row.appendChild(rail);
    row.appendChild(capRight);
    control.appendChild(head);
    control.appendChild(row);

    function render() {
        const frac = fracOf(index);
        thumb.style.left = posLeft(frac);
        // Fill runs from the first stop to the thumb centre.
        fill.style.width = `calc((100% - ${THUMB_W}px) * ${frac})`;
        value.textContent = DETAIL_OPTIONS[index].label;
        rail.setAttribute('aria-valuenow', String(index));
        rail.setAttribute('aria-valuetext', DETAIL_OPTIONS[index].label);
        dots.forEach((d, i) => d.classList.toggle('active', i <= index));
    }

    function select(i, persist = true) {
        const next = Math.min(lastIndex, Math.max(0, i));
        index = next;
        render();
        if (persist) chrome.storage.local.set({ SUMMARY_LENGTH: DETAIL_OPTIONS[index].value });
    }

    rail.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); select(index - 1); }
        else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); select(index + 1); }
        else if (e.key === 'Home') { e.preventDefault(); select(0); }
        else if (e.key === 'End') { e.preventDefault(); select(lastIndex); }
    });

    render();

    // Sync to the persisted preference (no re-write) once storage resolves.
    chrome.storage.local.get(['SUMMARY_LENGTH'], (res) => {
        const stored = DETAIL_OPTIONS.findIndex((o) => o.value === res.SUMMARY_LENGTH);
        if (stored !== -1) select(stored, false);
    });

    return control;
}

// Gear (settings) icon markup, shared by the empty-state header.
const GEAR_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 1 1 1.51 1.65 1.65 0 0 0 1.82.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';

// Build (or rebuild) the pre-generation empty state inside an existing container:
// header (title + gear) and body (prompt + Detail slider + Generate button). Used
// both for the first render and when the user hits Reset on a finished summary, so
// picking a different Detail level and regenerating is always one path.
function renderEmptyState(container) {
    if (!container) return;

    // Clear whatever was there (summary or prior empty state) and drop the DOM cache.
    container.innerHTML = '';
    _invalidateCache();
    container.classList.remove('yt-has-summary');

    // Create panel element
    const panel = document.createElement('div');
    panel.className = 'yt-timestamps-panel';

    // Create panel header element
    const panelHeader = document.createElement('div');
    panelHeader.className = 'yt-timestamps-panel-header';

    // Create left group (title)
    const headerLeft = document.createElement('div');
    headerLeft.className = 'yt-timestamps-header-left';

    // Create header title element
    const headerTitle = document.createElement('h3');
    headerTitle.className = 'yt-timestamps-panel-header-title';
    headerTitle.textContent = 'Timestamped Summary';

    // Create gear icon element
    const gearIcon = document.createElement('span');
    gearIcon.className = 'gear-icon';
    gearIcon.innerHTML = GEAR_SVG;
    gearIcon.onclick = () => {
        chrome.runtime.sendMessage({ action: "OPEN_OPTIONS" });
    };

    // Append elements
    headerLeft.appendChild(headerTitle);
    panelHeader.appendChild(headerLeft);
    panelHeader.appendChild(gearIcon);
    panel.appendChild(panelHeader);

    // Create panel body (empty state before generation)
    const panelBody = document.createElement('div');
    panelBody.className = 'yt-timestamps-panel-body';

    const emptyState = document.createElement('div');
    emptyState.className = 'yt-timestamps-empty-state';
    emptyState.innerHTML = `
        <div class="yt-empty-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
            </svg>
        </div>
        <div class="yt-empty-text">Generate an AI-powered summary with timestamps</div>
    `;
    panelBody.appendChild(emptyState);

    // Per-video "Detail" control (density + depth). Lives in the empty state; the
    // whole body is rebuilt on summary render, so it clears itself afterward.
    panelBody.appendChild(buildDetailSlider());

    // Create action area element
    const actionArea = document.createElement('div');
    actionArea.id = 'action-area';
    actionArea.className = 'yt-timestamps-action-area';

    // Create generate button element
    const genBtn = document.createElement('button');
    genBtn.textContent = 'Generate summary';
    genBtn.className = 'yt-timestamps-generate-button';
    // Wire the button based on whether an API key is configured
    // ('Generate summary' vs 'Set API keys' -> opens settings)
    setGenerateButtonMode(genBtn);

    // Append elements to action area
    actionArea.appendChild(genBtn);
    panelBody.appendChild(actionArea);
    panel.appendChild(panelBody);

    // Append panel to container
    container.appendChild(panel);

    // Apply initial height and observe player for resizes (must be after DOM insertion)
    _lastAppliedHeight = 0;
    applyPlayerHeight();
    observePlayerResize();
    // Re-apply after a short delay to catch late layout shifts
    setTimeout(applyPlayerHeight, 500);

    // Load the theme preference and keep the panel in sync with live YouTube
    // theme toggles (when following the system).
    chrome.storage.local.get(['THEME_PREF'], (res) => {
        _themePref = res.THEME_PREF || 'system';
        applyPanelTheme(_themePref, container);
    });

    // First-run onboarding: point new users to the settings gear icon
    chrome.storage.local.get(['SHOW_SETTINGS_HINT'], (res) => {
        if (res.SHOW_SETTINGS_HINT) {
            showSettingsHint(panel, gearIcon);
        }
    });
}

// Function to inject sidebar into the DOM
function injectSidebar(secondary) {
    if (document.querySelector('.yt-timestamps-container')) return;

    // Create container element
    const container = document.createElement('div');
    container.className = 'yt-timestamps-container';
    // Apply the theme up-front (follows YouTube by default) to avoid a flash
    applyPanelTheme('system', container);

    // Insert container into secondary, then build the empty state inside it
    secondary.insertBefore(container, secondary.firstChild);
    renderEmptyState(container);
    ensureYtThemeObserver();

    // Restore cached summary if available (e.g. after miniplayer toggle)
    const cachedSummary = getCachedSummary(getCurrentVideoId());
    if (cachedSummary) {
        renderTimestampsUI(cachedSummary);
    }
}

// Function to show a first-run tooltip pointing at the settings gear icon
function showSettingsHint(panel, gearIcon) {
    if (!panel || !gearIcon) return;
    // Anchor to the container (not the panel) — the panel clips with overflow:hidden
    const host = panel.parentElement || panel;
    if (host.querySelector('.yt-settings-hint')) return; // avoid duplicates

    // Draw the eye to the gear
    gearIcon.classList.add('yt-gear-pulse');

    const hint = document.createElement('div');
    hint.className = 'yt-settings-hint';

    const arrow = document.createElement('div');
    arrow.className = 'yt-settings-hint-arrow';

    const title = document.createElement('div');
    title.className = 'yt-settings-hint-title';
    title.textContent = 'Manage your API keys here';

    const text = document.createElement('div');
    text.className = 'yt-settings-hint-text';
    text.textContent = 'Open Settings from this icon anytime to add or update your Gemini and Mistral API keys.';

    const dismiss = document.createElement('button');
    dismiss.className = 'yt-settings-hint-dismiss';
    dismiss.textContent = 'Got it';

    hint.appendChild(arrow);
    hint.appendChild(title);
    hint.appendChild(text);
    hint.appendChild(dismiss);

    // Anchor just below the header, under the gear
    const header = panel.querySelector('.yt-timestamps-panel-header');
    if (header) hint.style.top = `${header.offsetHeight + 6}px`;

    const close = () => {
        hint.remove();
        gearIcon.classList.remove('yt-gear-pulse');
        gearIcon.removeEventListener('click', close);
        chrome.storage.local.set({ SHOW_SETTINGS_HINT: false });
    };

    dismiss.addEventListener('click', (e) => {
        e.stopPropagation();
        close();
    });

    // Also dismiss once the user opens settings via the gear
    gearIcon.addEventListener('click', close, { once: true });

    host.appendChild(hint);
}

// Run the transcript -> summary analysis flow (used when at least one API key is set)
function runAnalysis() {
    updateGenerateButton('extracting');

    // Send analysis request with timeout. Model is a global preference (settings
    // page); length is the per-video "Detail" preset chosen in the panel.
    const sendAnalysis = (model, length, timeout = 120000) => {
        return new Promise((resolve) => {
            let resolved = false;

            const timer = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    resolve({ success: false, error: `Request timed out` });
                }
            }, timeout);

            chrome.runtime.sendMessage({ action: "START_GEMINI_ANALYSIS", model: model, length: length }, (res) => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timer);
                    if (chrome.runtime.lastError) {
                        resolve({ success: false, error: chrome.runtime.lastError.message });
                    } else {
                        resolve(res || { success: false, error: 'No response from background' });
                    }
                } else {
                    resolve({ success: false, error: 'No response from background' });
                }
            });
        });
    };

    // Main execution
    (async () => {
        try {
            const prefs = await new Promise((resolve) =>
                chrome.storage.local.get(['SELECTED_MODEL', 'SUMMARY_LENGTH'], resolve)
            );
            const model = prefs.SELECTED_MODEL || 'auto';
            const length = prefs.SUMMARY_LENGTH || 'standard';

            const result = await sendAnalysis(model, length);

            if (result && result.success) {
                updateGenerateButton('done');
            } else {
                updateGenerateButton('error', result?.error || 'Unknown error', result?.keepOpen);
            }
        } catch (e) {
            updateGenerateButton('error', 'Extension context invalidated');
        }
    })();
}

// Toggle the primary button between generating a summary and prompting for API keys.
// With no key set, the button opens the settings page instead of running analysis.
function setGenerateButtonMode(genBtn) {
    if (!genBtn) return;
    chrome.storage.local.get(['GEMINI_API_KEY', 'MISTRAL_API_KEY'], (res) => {
        const hasKey = !!(res.GEMINI_API_KEY || res.MISTRAL_API_KEY);
        const emptyText = document.querySelector('.yt-empty-text');
        if (hasKey) {
            genBtn.textContent = 'Generate summary';
            genBtn.classList.remove('yt-needs-keys');
            genBtn.onclick = runAnalysis;
            if (emptyText) emptyText.textContent = 'Generate an AI-powered summary with timestamps';
        } else {
            genBtn.textContent = 'Set API keys';
            genBtn.classList.add('yt-needs-keys');
            genBtn.onclick = () => { chrome.runtime.sendMessage({ action: "OPEN_OPTIONS" }); };
            if (emptyText) emptyText.textContent = 'Add a Gemini or Mistral API key to start generating summaries';
        }
    });
}

// Re-evaluate the button mode when keys change, but only while the button is idle
function refreshGenerateButtonMode() {
    const genBtn = document.querySelector('.yt-timestamps-generate-button');
    if (!genBtn) return;
    if (genBtn.disabled || genBtn.classList.contains('yt-error-state')) return;
    setGenerateButtonMode(genBtn);
}

// Function to update the generate button state
let _buttonResetTimeout = null;
function updateGenerateButton(phase, message, keepOpen) {
    const genBtn = document.querySelector('.yt-timestamps-generate-button');
    if (!genBtn) return;

    // Clear any pending reset timeout
    if (_buttonResetTimeout) {
        clearTimeout(_buttonResetTimeout);
        _buttonResetTimeout = null;
    }

    const resetButton = () => {
        genBtn.innerHTML = 'Generate summary';
        genBtn.disabled = false;
        genBtn.style.pointerEvents = '';
        genBtn.classList.remove('yt-error-state');
    };

    switch (phase) {
        case 'extracting':
            genBtn.disabled = true;
            genBtn.classList.remove('yt-error-state');
            genBtn.innerHTML = '<span class="yt-spinner"></span>Extracting transcript...';
            break;
        case 'calling_api':
            genBtn.disabled = true;
            genBtn.classList.remove('yt-error-state');
            genBtn.innerHTML = '<span class="yt-spinner"></span>Generating summary...';
            break;
        case 'error':
            genBtn.classList.add('yt-error-state');
            genBtn.innerHTML = message || 'Something went wrong';
            if (keepOpen) {
                genBtn.disabled = true;
                genBtn.style.pointerEvents = 'none';
            } else {
                genBtn.disabled = false;
                _buttonResetTimeout = setTimeout(resetButton, 3000);
            }
            break;
        case 'done':
            resetButton();
            break;
    }
}

// Function to render timestamps UI from processed data
function renderTimestampsUI(summaryText) {
    // Cache the summary for restoration across DOM rebuilds (e.g. miniplayer toggle)
    cacheSummary(getCurrentVideoId(), summaryText);

    // This function will build the UI for timestamps
    const container = document.querySelector('.yt-timestamps-container');
    if (!container) return;
    
    // Clear existing content and invalidate cached DOM references
    container.innerHTML = '';
    _invalidateCache();
    container.classList.add('yt-has-summary');
    
    // Reset expanded accordion tracking
    _expandedAccordion = null;
    _expandedAccordionBtn = null;
    
    // Create panel elements
    const panel = document.createElement('div');
    panel.className = 'yt-timestamps-panel';
    
    const panelHeader = document.createElement('div');
    panelHeader.className = 'yt-timestamps-panel-header';
    panelHeader.style.cursor = 'pointer';
    
    // Left group: title + Reset. Reset returns to the empty state so the user can
    // pick a different Detail level and regenerate.
    const headerLeft = document.createElement('div');
    headerLeft.className = 'yt-timestamps-header-left';

    const headerTitle = document.createElement('h3');
    headerTitle.className = 'yt-timestamps-panel-header-title';
    headerTitle.textContent = 'Timestamped Summary';

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'yt-reset-btn';
    resetBtn.title = 'Start over';
    resetBtn.setAttribute('aria-label', 'Start over');
    resetBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>';
    resetBtn.addEventListener('click', (e) => {
        // Don't let the click bubble to the header (which toggles the accordion).
        e.stopPropagation();
        // Clear the cached summary so no re-inject restores it, then rebuild the
        // empty state (the Detail slider re-syncs to the stored SUMMARY_LENGTH).
        clearSummaryCache(getCurrentVideoId());
        renderEmptyState(container);
    });

    headerLeft.appendChild(headerTitle);
    headerLeft.appendChild(resetBtn);

    const toggleIcon = document.createElement('span');
    toggleIcon.className = 'yt-accordion-toggle-icon';
    toggleIcon.textContent = '›';

    panelHeader.appendChild(headerLeft);
    panelHeader.appendChild(toggleIcon);
    panel.appendChild(panelHeader);
    
    // Create panel content (accordion body)
    const panelContent = document.createElement('div');
    panelContent.className = 'yt-timestamps-panel-content yt-accordion-body';
    
    const timestampsList = document.createElement('div');
    timestampsList.className = 'yt-timestamps-list';
    
    // Process summary text
    const lines = summaryText.split('\n').map(l => l.trim()).filter(Boolean);
    let itemCount = 0;

    lines.forEach(line => {
        // Normalize common LLM formatting drift so valid points aren't silently
        // dropped: strip code fences/backticks, a leading list bullet, and
        // markdown bold markers.
        let cleanLine = line.replace(/`+/g, '').trim();
        cleanLine = cleanLine.replace(/^[-*•]\s+/, '');
        cleanLine = cleanLine.replace(/\*\*/g, '').trim();

        if (cleanLine.startsWith('#')) {
            const sectionHeader = document.createElement('div');
            sectionHeader.className = 'yt-section-header';
            sectionHeader.textContent = cleanLine.substring(1).trim();
            timestampsList.appendChild(sectionHeader);
            return;
        }

        // Match a timestamped point, tolerating format drift: optional brackets
        // around the time, a hyphen / en-dash / em-dash (or nothing) before the
        // title, and an optional ": description". This is what prevents the
        // "sections but no items" render when the model swaps the plain hyphen.
        const timeMatch = cleanLine.match(/^\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*[-–—]?\s*(.+?)(?::\s*(.+))?$/);
        if (timeMatch) {
            const time = timeMatch[1];
            const title = timeMatch[2].trim();
            const description = (timeMatch[3] || '').trim();
            itemCount++;
            let sec = 0;
            const timeParts = time.split(':').map(Number);
            if (timeParts.length === 3) sec = timeParts[0] * 3600 + timeParts[1] * 60 + timeParts[2];
            else if (timeParts.length === 2) sec = timeParts[0] * 60 + timeParts[1];
            
            const tsDiv = document.createElement('div');
            tsDiv.className = 'yt-timestamp-item';
            
            const glowBorder = document.createElement('div');
            glowBorder.className = 'yt-glow-border';
            tsDiv.appendChild(glowBorder);
            
            const timeLabel = document.createElement('span');
            timeLabel.className = 'yt-time-label';
            timeLabel.innerHTML = `<span class="yt-time">[${time}]</span> <span class="yt-title">${title}</span>`;
            
            const expandBtn = document.createElement('span');
            expandBtn.textContent = '+';
            expandBtn.className = 'yt-expand-btn';
            
            tsDiv.appendChild(timeLabel);
            tsDiv.appendChild(expandBtn);
            
            const accordionContent = document.createElement('div');
            accordionContent.className = 'yt-accordion-content';
            accordionContent.textContent = description;
            
            let isExpanded = false;
            expandBtn.onclick = e => {
                e.stopPropagation();
                
                const scrollContainer = panelContent;
                
                // Close the currently expanded accordion instantly (no transition)
                if (_expandedAccordion && _expandedAccordion !== accordionContent) {
                    const oldAccordion = _expandedAccordion;
                    
                    // Capture position before instant collapse
                    const yBefore = tsDiv.getBoundingClientRect().top;
                    
                    // Disable transition, collapse, force reflow
                    oldAccordion.style.setProperty('transition', 'none', 'important');
                    oldAccordion.classList.remove('expanded');
                    oldAccordion.offsetHeight; // force reflow
                    
                    // Re-enable transition
                    oldAccordion.style.removeProperty('transition');
                    
                    // Correct scroll to keep tsDiv visually anchored
                    const yAfter = tsDiv.getBoundingClientRect().top;
                    scrollContainer.scrollTop += (yAfter - yBefore);
                    
                    if (_expandedAccordionBtn) {
                        _expandedAccordionBtn.textContent = '+';
                    }
                }
                
                isExpanded = !isExpanded;
                expandBtn.textContent = isExpanded ? '−' : '+';
                
                if (isExpanded) {
                    accordionContent.classList.add('expanded');
                    _expandedAccordion = accordionContent;
                    _expandedAccordionBtn = expandBtn;
                } else {
                    accordionContent.classList.remove('expanded');
                    _expandedAccordion = null;
                    _expandedAccordionBtn = null;
                }
            };
            
            // Hover background is handled by the CSS `:hover` rule so it stays
            // theme-aware; here we only toggle the red glow overlay.
            tsDiv.onmouseover = () => { glowBorder.style.opacity = '1'; };
            tsDiv.onmouseout = () => { glowBorder.style.opacity = '0'; };
            tsDiv.onclick = () => {
                const video = document.querySelector('video');
                if (video) video.currentTime = sec;
            };
            
            timestampsList.appendChild(tsDiv);
            timestampsList.appendChild(accordionContent);
        }
    });

    // Safety net: if the model returned section headers but not a single
    // parseable point, log the raw output so a recurrence can be diagnosed
    // (rather than silently showing a header-only wall).
    if (itemCount === 0) {
        console.warn('[yt-timestamps] No timestamp items parsed from summary. Raw output:\n', summaryText);
    }

    panelContent.appendChild(timestampsList);
    panel.appendChild(panelContent);
    container.appendChild(panel);

    _lastAppliedHeight = 0;
    applyPlayerHeight();
    observePlayerResize();
    
    // Accordion toggle for the entire summary
    let isSummaryExpanded = true;
    panelHeader.addEventListener('click', () => {
        isSummaryExpanded = !isSummaryExpanded;
        if (isSummaryExpanded) {
            panelContent.classList.remove('collapsed');
            toggleIcon.classList.remove('collapsed');
        } else {
            panelContent.classList.add('collapsed');
            toggleIcon.classList.add('collapsed');
        }
    });
}

// Export functions for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    injectSidebar,
    renderTimestampsUI,
    updateGenerateButton
  };
}