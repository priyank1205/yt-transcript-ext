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

// --- Panel preferences -------------------------------------------------------
//
// This file runs in YouTube's page as a content script, so it holds no
// credentials and reads no settings: chrome.storage.local is closed to page
// contexts (see the service worker's setAccessLevel call) precisely because it
// holds every provider API key. What the panel needs is four display
// preferences and one boolean saying whether generation is possible at all, and
// it asks the background for exactly that.
//
// The last answer is kept here so the synchronous render paths have something
// to draw with before the round trip resolves.
const PANEL_PREF_DEFAULTS = {
    summaryLength: 'standard',
    theme: 'system',
    skin: 'quiet',
    showSettingsHint: false,
    providerReady: false
};
let _panelPrefs = { ...PANEL_PREF_DEFAULTS };

// Ask the background for the current preferences. The callback runs with the
// last known values if the message fails (the extension reloading mid-session),
// so a render is never blocked on it.
function readPanelPrefs(callback) {
    try {
        chrome.runtime.sendMessage({ action: 'GET_PANEL_PREFS' }, (res) => {
            if (!chrome.runtime.lastError && res) {
                _panelPrefs = { ...PANEL_PREF_DEFAULTS, ...res };
            }
            if (callback) callback(_panelPrefs);
        });
    } catch {
        if (callback) callback(_panelPrefs);
    }
}

// Persist one of the two preferences the panel owns (the Detail level it last
// generated with, and whether the first-run hint has been dismissed). The
// background re-checks the name and the value; nothing else can be written from
// here.
function writePanelPref(name, value) {
    _panelPrefs = { ..._panelPrefs, [name]: value };
    try {
        chrome.runtime.sendMessage({ action: 'SET_PANEL_PREF', name, value }, () => {
            void chrome.runtime.lastError;   // fire and forget
        });
    } catch { /* The panel keeps the in-memory value either way. */ }
}

// A settings change elsewhere (the options page, another tab) arrives as a
// PREFS_CHANGED broadcast, which is what the panel's own storage.onChanged
// listener used to do before the store was closed to page contexts.
function applyPanelPrefs(prefs) {
    if (!prefs) return;
    const previous = _panelPrefs;
    _panelPrefs = { ...PANEL_PREF_DEFAULTS, ...prefs };
    if (_panelPrefs.theme !== previous.theme) setPanelThemePref(_panelPrefs.theme);
    if (_panelPrefs.skin !== previous.skin) setPanelSkinPref(_panelPrefs.skin);
    if (_panelPrefs.providerReady !== previous.providerReady) refreshGenerateButtonMode();
}

// --- Panel theme (light/dark) ---------------------------------------------
// The panel ships a dark skin by default and adds a `yt-theme-light` class to
// the container when the resolved theme is light. Resolution: an explicit
// 'light'/'dark' override wins; 'system' (default) follows YouTube's own theme,
// which YouTube signals via the `dark` attribute on <html>.
let _themePref = PANEL_PREF_DEFAULTS.theme;
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

// --- Panel skin (classic / quiet) ------------------------------------------
// Design-direction toggle: the redesigned "Quiet" skin (styles/skin-quiet.css)
// is opt-in via the PANEL_SKIN preference while it's being evaluated. 'classic'
// (no class) stays the shipping default; 'quiet' adds `yt-skin-quiet` to the
// container, which the skin stylesheet scopes every override under.
let _skinPref = PANEL_PREF_DEFAULTS.skin;

function applyPanelSkin(pref, containerEl) {
    const container = containerEl || document.querySelector('.yt-timestamps-container');
    if (!container) return;
    container.classList.toggle('yt-skin-quiet', pref === 'quiet');
}

// Update the stored preference and re-apply (called when the override changes).
// The skins differ in markup, not just CSS (Quiet builds the ghost-preview
// empty state and the v2 Detail slider), so a live toggle also rebuilds the
// panel contents for the new skin.
function setPanelSkinPref(pref) {
    _skinPref = pref || 'classic';
    applyPanelSkin(_skinPref);

    const container = document.querySelector('.yt-timestamps-container');
    if (!container) return;
    // Don't tear down an in-flight generation; the next render (summary or
    // error reset) will already use the new skin's markup.
    const genBtn = container.querySelector('.yt-timestamps-generate-button');
    if (genBtn && genBtn.disabled) return;
    const cached = getCachedSummary(getCurrentVideoId());
    if (container.classList.contains('yt-has-summary') && cached) {
        renderTimestampsUI(cached.text, cached.meta);
    } else if (!container.classList.contains('yt-has-summary')) {
        renderEmptyState(container);
    }
}

// Reading the preferences costs a round trip to the background, and nothing
// about that is fast enough for a first paint. The panel used to mount with the
// module defaults, then correct itself once the answer arrived — which is the
// visible Classic-then-Quiet swap on every page load and reload. So the read is
// started the moment this script runs, long before YouTube's sidebar exists to
// mount into, and the first mount waits on it (see injectSidebar).
//
// The wait is bounded: a service worker that is slow to wake, or gone entirely,
// must cost the panel a late paint rather than no panel at all.
const PREFS_PRIME_TIMEOUT_MS = 1000;
let _prefsPrimed = false;
let _primePromise = null;

function primePanelPrefs() {
    if (!_primePromise) {
        _primePromise = new Promise((resolve) => {
            readPanelPrefs((prefs) => {
                _themePref = prefs.theme;
                _skinPref = prefs.skin;
                _prefsPrimed = true;
                resolve(prefs);
            });
        });
    }
    return _primePromise;
}

// Kick it off at load. Everything below reads the answer synchronously.
primePanelPrefs();

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

// Entries keep the request metadata that produced them (video, detail level,
// model), so a restore renders the summary the way it was generated instead of
// re-reading whatever the global settings happen to say now.
function cacheSummary(videoId, summaryText, meta) {
    if (videoId && summaryText) {
        _summaryCache[videoId] = { text: summaryText, meta: meta || null };
    }
}

function getCachedSummary(videoId) {
    return videoId ? _summaryCache[videoId] || null : null;
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

    measureDockAnchor(panel);

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

    // Cap the accordion height based on the player height so it doesn't run off-screen
    const accordionMaxH = playerH + ACCORDION_OFFSET;

    if (_lastAppliedHeight === accordionMaxH) return;
    _lastAppliedHeight = accordionMaxH;

    panel.style.maxHeight = `${headerH + accordionMaxH}px`;
    const body = _getPanelBody();
    if (body) body.style.maxHeight = `${accordionMaxH}px`;
}

// Where the docked playback marker hangs from when the point playing now is
// above the fold: under the header, never over it, and with no seam between the
// two.
//
// Measured off rectangles rather than `offsetHeight`, which is rounded to a
// whole pixel. A header that really stands 45.6px tall reports 46, the dock
// hangs a fraction of a pixel too low, and that fraction is a hairline of the
// list showing through the gap — the exact seam the scrim exists to close.
// `top` resolves against the panel's padding box, so its border comes off.
function measureDockAnchor(panel) {
    if (!panel) return;
    const body = panel.querySelector('.yt-accordion-body');
    if (!body) return;

    const panelRect = panel.getBoundingClientRect();
    if (panelRect.height <= 0) return;      // hidden panel: nothing to measure

    const borderTop = parseFloat(getComputedStyle(panel).borderTopWidth) || 0;
    const top = body.getBoundingClientRect().top - panelRect.top - borderTop;
    panel.style.setProperty('--yt-dock-top', `${Math.max(0, top)}px`);
}

// The header's height is not fixed: a web font landing late, a narrow sidebar
// wrapping the title, or a theme change all move it, and only some of those
// come with a window resize to re-measure on.
function observeHeaderHeight(panel) {
    disconnectHeaderObserver();
    if (typeof ResizeObserver !== 'function' || !panel) return;
    const header = panel.querySelector('.yt-timestamps-panel-header');
    if (!header) return;
    _headerObserver = new ResizeObserver(() => measureDockAnchor(panel));
    // The border box, not the default content box: what the dock hangs from is
    // the header's outer edge, and padding or a border can move that on its own
    // — switching skins alone takes the header's bottom border from 2px to 1px.
    _headerObserver.observe(header, { box: 'border-box' });
}

function disconnectHeaderObserver() {
    if (_headerObserver) {
        _headerObserver.disconnect();
        _headerObserver = null;
    }
}

function observePlayerResize() {
    disconnectPlayerObserver();
    _resizeHandler = () => {
        clearTimeout(_resizeTimer);
        _resizeTimer = setTimeout(() => {
            const player = findVideoPlayer();
            applyPlayerHeight();
            // The panel just changed height, so a row that was on screen may not
            // be any more — and the dock hangs off the header we just remeasured.
            syncPlaybackDock();
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

// --- Current playback indicator ----------------------------------------------
//
// Two halves of one feature, and they answer different questions. The row state
// answers "which point am I in" while that point is on screen. The docked marker
// answers "where did it go" when it isn't — and it *offers* the scroll rather
// than performing one. The list never moves unless the user asks it to.
//
// The player's own `timeupdate` drives everything. It fires roughly four times a
// second, which is ample for chapter granularity and for a hairline crossing a
// point that lasts minutes, so nothing here polls or runs a frame loop. The one
// rAF in the file coalesces scroll events for the dock.

// Points sorted by time rather than by DOM order: a model can return its
// timestamps out of sequence, and "the last point at or before the playhead"
// should still resolve correctly when it does.
let _pbPoints = null;
let _pbVideo = null;
let _pbScroll = null;        // the panel's scroll container (.yt-accordion-body)
let _pbDock = null;
let _pbDockTime = null;
let _pbDockTitle = null;
let _pbDockArrow = null;
let _pbActive = null;        // the row element currently marked "now"
let _pbDocked = false;       // is the dock showing? (one half of the hysteresis)
let _pbDir = 'up';           // which edge the active row went out by
let _pbScrollRaf = 0;
let _pbOnTime = null;
let _pbOnScroll = null;
let _pbAttachTimer = null;
let _pbLastTime = null;      // to tell playback drift from a seek
let _headerObserver = null;

// A row becomes current the moment the playhead reaches it. Seeking is not
// frame-exact — setting currentTime lands on the nearest keyframe, which can be
// a shade early — so a click on a row marks that row rather than the one before.
const PB_SEEK_TOLERANCE = 0.35;

// The dock appears once the active row is fully outside the scroll viewport and
// only goes away once the row is back inside by this much. The gap between the
// two tests is a dead zone; without it the dock flickers as a row grazes an edge.
const PB_DOCK_DEADZONE = 28;

const PB_VIDEO_EVENTS = ['timeupdate', 'seeked', 'play', 'pause'];

// `timeupdate` arrives about every 250ms, so the progress hairline would step
// four times a second if it were painted straight from it. Instead each update
// sets the new width and CSS carries it there linearly over slightly longer than
// one tick (see --yt-progress-ease), which arrives before the step ends and
// keeps the hairline continuously in motion. The lag that buys is a fraction of
// a second across a point that lasts minutes.
//
// That only holds while time moves at playback speed. A jump this size or larger
// is a seek, and a seek should land rather than glide.
const PB_SEEK_JUMP = 1.5;

// Write a progress width, suppressing the easing when the value is discontinuous
// — a seek, or a point that has only just become current.
function setProgressWidth(el, pct, instant) {
    if (!el) return;
    if (instant) {
        el.classList.add('yt-progress-jump');
        el.style.setProperty('--yt-now-progress', pct);
        void el.offsetWidth;                 // commit the width with no transition
        el.classList.remove('yt-progress-jump');
        return;
    }
    el.style.setProperty('--yt-now-progress', pct);
}

function prefersReducedMotion() {
    return typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Seek to the point playing now. Delegates to the row's own click handler so the
// seek and its confirmation pulse have exactly one implementation.
function seekToActivePoint() {
    if (_pbActive) _pbActive.click();
}

// Scroll the list to the point playing now — the only scroll this feature ever
// performs, and only because the dock was clicked.
function scrollToActivePoint() {
    if (!_pbActive || !_pbScroll) return;
    const rowRect = _pbActive.getBoundingClientRect();
    const boxRect = _pbScroll.getBoundingClientRect();
    const centred = Math.max(0, (_pbScroll.clientHeight - rowRect.height) / 2);
    const top = _pbScroll.scrollTop + (rowRect.top - boxRect.top) - centred;
    _pbScroll.scrollTo({
        top: Math.max(0, top),
        behavior: prefersReducedMotion() ? 'auto' : 'smooth'
    });
}

function buildPlaybackDock(panel) {
    // Two layers. The outer rail spans the panel's full width and carries the
    // blurred scrim that covers the gap between the card and the panel edge —
    // without it, list rows scroll visibly through that slit. The card inside is
    // the only part that takes clicks, because the rail's fade region sits over
    // rows the user can still see and reach.
    const dock = document.createElement('div');
    dock.className = 'yt-now-dock';

    const card = document.createElement('div');
    card.className = 'yt-now-dock-card';

    // Two verbs, so two real buttons side by side rather than one nested in the
    // other: seek the video, or scroll the list to where the video already is.
    const seek = document.createElement('button');
    seek.type = 'button';
    seek.className = 'yt-now-dock-seek';
    seek.title = 'Jump the video to this point';

    const glyph = document.createElement('span');
    glyph.className = 'yt-now-dock-glyph';
    glyph.setAttribute('aria-hidden', 'true');
    _pbDockTime = document.createElement('span');
    _pbDockTime.className = 'yt-now-dock-time';
    seek.appendChild(glyph);
    seek.appendChild(_pbDockTime);

    const jump = document.createElement('button');
    jump.type = 'button';
    jump.className = 'yt-now-dock-jump';
    jump.title = 'Scroll the list to the point playing now';

    _pbDockTitle = document.createElement('span');
    _pbDockTitle.className = 'yt-now-dock-title';
    // Polite, and on the title alone. A screen reader should hear the chapter
    // change once it happens, not have every change cut off the sentence before
    // it. While the dock is hidden it is `visibility: hidden`, so nothing is
    // announced for a point the user can already see.
    _pbDockTitle.setAttribute('aria-live', 'polite');

    _pbDockArrow = document.createElement('span');
    _pbDockArrow.className = 'yt-now-dock-arrow';
    _pbDockArrow.setAttribute('aria-hidden', 'true');
    _pbDockArrow.textContent = '↑';

    jump.appendChild(_pbDockTitle);
    jump.appendChild(_pbDockArrow);

    const fill = document.createElement('span');
    fill.className = 'yt-now-dock-fill';
    fill.setAttribute('aria-hidden', 'true');

    card.appendChild(seek);
    card.appendChild(jump);
    card.appendChild(fill);
    dock.appendChild(card);

    seek.addEventListener('click', seekToActivePoint);
    jump.addEventListener('click', scrollToActivePoint);

    panel.appendChild(dock);
    return dock;
}

// Show the dock only while the current point is off screen, and remember which
// edge it left by so the arrow points the right way.
function syncPlaybackDock() {
    if (!_pbDock || !_pbScroll) return;

    if (!_pbActive || _pbScroll.classList.contains('collapsed')) {
        setDockVisible(false);
        return;
    }

    const rowRect = _pbActive.getBoundingClientRect();
    const boxRect = _pbScroll.getBoundingClientRect();
    if (boxRect.height <= 0) {
        setDockVisible(false);
        return;
    }

    const above = rowRect.bottom <= boxRect.top + 2;
    const below = rowRect.top >= boxRect.bottom - 2;
    const wellInside = rowRect.bottom > boxRect.top + PB_DOCK_DEADZONE
        && rowRect.top < boxRect.bottom - PB_DOCK_DEADZONE;

    // Inside the dead zone neither test fires, so whichever state we are in
    // holds — and the arrow keeps pointing the way the row actually went.
    if (above) _pbDir = 'up';
    else if (below) _pbDir = 'down';

    const show = _pbDocked ? !wellInside : (above || below);
    if (show) {
        _pbDock.classList.toggle('yt-dock-below', _pbDir === 'down');
        _pbDockArrow.textContent = _pbDir === 'down' ? '↓' : '↑';
    }
    setDockVisible(show);
}

function setDockVisible(on) {
    if (_pbDocked === on) return;
    _pbDocked = on;
    _pbDock.classList.toggle('yt-dock-on', on);
}

function queueDockSync() {
    if (_pbScrollRaf) return;
    _pbScrollRaf = requestAnimationFrame(() => {
        _pbScrollRaf = 0;
        syncPlaybackDock();
    });
}

function updatePlaybackIndicator() {
    if (!_pbPoints || !_pbVideo) return;

    const now = _pbVideo.currentTime;

    // Playback drift, or a jump? Comparing against the last reading catches a
    // scrub as well as a seek, without either needing its own event.
    const jumped = _pbLastTime === null || Math.abs(now - _pbLastTime) > PB_SEEK_JUMP;
    _pbLastTime = now;

    // The last point at or before the playhead.
    let idx = -1;
    for (let i = 0; i < _pbPoints.length; i++) {
        if (_pbPoints[i].sec <= now + PB_SEEK_TOLERANCE) idx = i;
        else break;
    }

    const active = idx >= 0 ? _pbPoints[idx] : null;
    // Before the first point — a summary whose first timestamp is not 0:00 —
    // nothing is current, and nothing is marked.
    const activeSec = active ? active.sec : Number.NEGATIVE_INFINITY;
    const changed = (active ? active.el : null) !== _pbActive;

    if (changed) {
        for (const point of _pbPoints) {
            const isNow = point === active;
            point.el.classList.toggle('yt-now', isNow);
            point.el.classList.toggle('yt-past', !isNow && point.sec < activeSec);
            if (isNow) point.el.setAttribute('aria-current', 'true');
            else point.el.removeAttribute('aria-current');
        }
        _pbActive = active ? active.el : null;

        if (active && _pbDockTime && _pbDockTitle) {
            // Both come from model output, so both are set as text.
            const timeEl = active.el.querySelector('.yt-time-text');
            const titleEl = active.el.querySelector('.yt-title');
            _pbDockTime.textContent = timeEl ? timeEl.textContent : '';
            _pbDockTitle.textContent = titleEl ? titleEl.textContent : '';
        }
    }

    // How far through the current point the playhead is, so a nine-minute
    // chapter doesn't look identical at 0:10 and 8:50. A live stream has no
    // finite duration to measure the last point against; there the fill stays
    // empty rather than guessing.
    if (active) {
        const next = idx + 1 < _pbPoints.length ? _pbPoints[idx + 1].sec : _pbVideo.duration;
        let progress = 0;
        if (isFinite(next) && next > active.sec) {
            progress = Math.max(0, Math.min(1, (now - active.sec) / (next - active.sec)));
        }
        const pct = `${(progress * 100).toFixed(2)}%`;
        // A row that has only just become current starts from whatever width it
        // was left at, so that first write lands rather than sliding.
        const instant = jumped || changed;
        setProgressWidth(active.el, pct, instant);
        setProgressWidth(_pbDock, pct, instant);
    }

    syncPlaybackDock();
}

function attachPlaybackVideo(attempt) {
    // Same lookup the row's seek handler uses. If the two ever disagreed, the
    // indicator would follow one element while clicks moved another.
    const video = document.querySelector('video');
    if (!video) {
        // YouTube swaps the media element around navigation and the miniplayer.
        // Wait a few beats, then leave the panel as it is — an unmarked list is
        // the pre-feature panel, which is a fine thing to fall back to.
        if (attempt >= 8) return;
        _pbAttachTimer = setTimeout(() => attachPlaybackVideo(attempt + 1), 400);
        return;
    }

    _pbVideo = video;
    _pbOnTime = () => updatePlaybackIndicator();
    for (const evt of PB_VIDEO_EVENTS) video.addEventListener(evt, _pbOnTime);
    updatePlaybackIndicator();
}

function startPlaybackTracking(points, panel, scrollContainer) {
    stopPlaybackTracking();
    if (!points || points.length === 0 || !panel || !scrollContainer) return;

    _pbPoints = points.slice().sort((a, b) => a.sec - b.sec);
    _pbScroll = scrollContainer;
    _pbDock = buildPlaybackDock(panel);

    _pbOnScroll = queueDockSync;
    _pbScroll.addEventListener('scroll', _pbOnScroll, { passive: true });
    observeHeaderHeight(panel);

    attachPlaybackVideo(0);
}

function stopPlaybackTracking() {
    if (_pbAttachTimer) {
        clearTimeout(_pbAttachTimer);
        _pbAttachTimer = null;
    }
    if (_pbScrollRaf) {
        cancelAnimationFrame(_pbScrollRaf);
        _pbScrollRaf = 0;
    }
    if (_pbVideo && _pbOnTime) {
        for (const evt of PB_VIDEO_EVENTS) _pbVideo.removeEventListener(evt, _pbOnTime);
    }
    if (_pbScroll && _pbOnScroll) {
        _pbScroll.removeEventListener('scroll', _pbOnScroll);
    }
    if (_pbDock) _pbDock.remove();
    disconnectHeaderObserver();

    _pbPoints = null;
    _pbVideo = null;
    _pbScroll = null;
    _pbDock = null;
    _pbDockTime = null;
    _pbDockTitle = null;
    _pbDockArrow = null;
    _pbActive = null;
    _pbOnTime = null;
    _pbOnScroll = null;
    _pbDocked = false;
    _pbDir = 'up';
    _pbLastTime = null;
}

// The "Detail" presets, ordered from least to most detail. `value` is what we
// send to the backend and persist as the sticky default (SUMMARY_LENGTH); `label`
// is shown to the user; `help` is the longer explanation revealed by the "?" icon.
// Standard is the out-of-the-box default; after that, SUMMARY_LENGTH holds
// whatever level the user last *generated* with, and that becomes the default.
const DETAIL_OPTIONS = [
    { value: 'brief', label: 'Brief', short: 'Major sections only — a quick skim.', help: 'A high-level skim — only the major sections and clear topic shifts, one short line each. Best for a quick sense of what a video covers.' },
    { value: 'standard', label: 'Standard', short: 'Balanced coverage — the best default.', help: 'A balanced overview — roughly one point every few minutes, each captured in a sentence or two. The best default for most videos.' },
    { value: 'detailed', label: 'In-depth', short: 'Every topic, with concrete specifics.', help: 'A thorough breakdown — every distinct topic with concrete specifics like names, numbers, and examples, so you rarely need to watch the video.' }
];
const DETAIL_DEFAULT_INDEX = 1;

// The level the panel should open on: whatever the user last generated with,
// falling back to Standard. Reads the in-memory preferences, which the mount
// has already waited for (see primePanelPrefs) — asking the background here
// instead is what used to make the chip render "Standard" and then correct
// itself to the real level a moment later.
function storedDetailIndex() {
    const stored = DETAIL_OPTIONS.findIndex((o) => o.value === _panelPrefs.summaryLength);
    return stored === -1 ? DETAIL_DEFAULT_INDEX : stored;
}

// The level currently selected in the empty-state chip. Moving the slider updates
// this in memory only; it's not persisted as the default until the user actually
// generates (see runAnalysis), so abandoned fiddling doesn't change the default.
let _pendingDetail = DETAIL_OPTIONS[DETAIL_DEFAULT_INDEX].value;

// Build the interactive header "Detail" control (used before generation): a chip
// showing the current level (Brief / Standard / In-depth) that opens a popover
// slider on click. Selecting a level updates the in-memory `_pendingDetail`; it's
// committed to SUMMARY_LENGTH (the sticky default) only when the user generates.
// Returns the chip wrapper; the popover is mounted onto the panel container on
// open (so the panel's overflow:hidden can't clip it).
function buildDetailChip() {
    let index = storedDetailIndex();
    _pendingDetail = DETAIL_OPTIONS[index].value;
    let open = false;
    let helpOpen = false;
    let dragging = false;
    const lastIndex = DETAIL_OPTIONS.length - 1;

    // Skin variant, decided at build time. Quiet builds the v2 popover: labeled
    // lozenge thumb, level labels under the track, always-visible one-line
    // description, free-tracking drag with a spring snap on release.
    const quiet = _skinPref === 'quiet';

    // Thumb width (must match CSS). Positions are inset by half the thumb so the
    // thumb sits fully inside the track at the extremes instead of clipping.
    // The v2 thumb is wider because it carries the current level's name.
    const THUMB_W = quiet ? 74 : 46;
    const posLeft = (frac) => `calc(${THUMB_W / 2}px + (100% - ${THUMB_W}px) * ${frac})`;
    const fracOf = (i) => (lastIndex ? i / lastIndex : 0);

    // --- Chip (lives in the header) ---
    const wrap = document.createElement('div');
    wrap.className = 'yt-detail-chip-wrap';

    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'yt-detail-chip';
    chip.title = 'Summary detail';
    chip.setAttribute('aria-haspopup', 'dialog');
    chip.setAttribute('aria-expanded', 'false');

    const chipLabel = document.createElement('span');
    chipLabel.className = 'yt-detail-chip-label';

    const chipCaret = document.createElement('span');
    chipCaret.className = 'yt-detail-chip-caret';
    chipCaret.innerHTML = '<svg width="9" height="9" viewBox="0 0 10 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M1 1l4 4 4-4"/></svg>';

    chip.appendChild(chipLabel);
    chip.appendChild(chipCaret);
    wrap.appendChild(chip);

    // --- Popover (Effort-style slider), mounted on open ---
    const pop = document.createElement('div');
    pop.className = quiet ? 'yt-detail-pop yt-detail-pop-v2' : 'yt-detail-pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Summary detail');
    pop.hidden = true;
    // Clicks inside the popover must not bubble to the header (which toggles the
    // summary accordion) or to the document close-listener.
    pop.addEventListener('click', (e) => e.stopPropagation());

    // Title row: "Detail <value>" on the left, a "?" help toggle on the right.
    const top = document.createElement('div');
    top.className = 'yt-detail-top';

    const titleGroup = document.createElement('div');
    titleGroup.className = 'yt-detail-title';
    const label = document.createElement('span');
    label.className = 'yt-detail-label';
    label.textContent = 'Detail';
    const value = document.createElement('span');
    value.className = 'yt-detail-value';
    titleGroup.appendChild(label);
    // v2 shows the current level inside the thumb instead of the title row.
    if (!quiet) titleGroup.appendChild(value);

    const helpBtn = document.createElement('button');
    helpBtn.type = 'button';
    helpBtn.className = 'yt-detail-help-btn';
    helpBtn.title = 'What does this level mean?';
    helpBtn.setAttribute('aria-label', 'Explain this detail level');
    helpBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';

    top.appendChild(titleGroup);
    top.appendChild(helpBtn);

    // End captions on their own row, above the track.
    const caps = document.createElement('div');
    caps.className = 'yt-detail-caps';
    const capLeft = document.createElement('span');
    capLeft.className = 'yt-detail-cap';
    capLeft.textContent = 'Quick';
    const capRight = document.createElement('span');
    capRight.className = 'yt-detail-cap';
    capRight.textContent = 'Thorough';
    caps.appendChild(capLeft);
    caps.appendChild(capRight);

    // Grooved track with evenly spaced dots and a lozenge thumb.
    const track = document.createElement('div');
    track.className = 'yt-detail-track';
    track.setAttribute('role', 'slider');
    track.setAttribute('tabindex', '0');
    track.setAttribute('aria-label', 'Summary detail');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', String(lastIndex));

    const dots = DETAIL_OPTIONS.map((opt, i) => {
        const dot = document.createElement('span');
        dot.className = 'yt-detail-dot';
        dot.style.left = posLeft(fracOf(i));
        track.appendChild(dot);
        return dot;
    });

    const thumb = document.createElement('div');
    thumb.className = 'yt-detail-thumb';
    // v2: the thumb carries the current level's name.
    let thumbLabel = null;
    if (quiet) {
        thumbLabel = document.createElement('span');
        thumbLabel.className = 'yt-detail-thumb-label';
        thumb.appendChild(thumbLabel);
    }
    track.appendChild(thumb);

    // v2: level names under the track at their detent positions (click to
    // select), plus an always-visible one-line description that crossfades.
    let levelEls = [];
    let desc = null;
    if (quiet) {
        const levels = document.createElement('div');
        levels.className = 'yt-detail-levels';
        levelEls = DETAIL_OPTIONS.map((opt, i) => {
            const lvl = document.createElement('button');
            lvl.type = 'button';
            lvl.className = 'yt-detail-level';
            lvl.textContent = opt.label;
            lvl.addEventListener('click', (e) => {
                e.stopPropagation();
                select(i);
            });
            levels.appendChild(lvl);
            return lvl;
        });

        desc = document.createElement('div');
        desc.className = 'yt-detail-desc';

        var quietLevels = levels;
    }

    // Longer per-level explanation, toggled by the "?" icon.
    const help = document.createElement('div');
    help.className = 'yt-detail-help';
    help.hidden = true;

    pop.appendChild(top);
    if (!quiet) pop.appendChild(caps);
    pop.appendChild(track);
    if (quiet) {
        pop.appendChild(quietLevels);
        pop.appendChild(desc);
    }
    pop.appendChild(help);

    function render() {
        const opt = DETAIL_OPTIONS[index];
        // While a v2 drag is live the thumb tracks the pointer freely; the
        // detent position is applied on release (spring snap).
        if (!(quiet && dragging)) {
            thumb.style.left = posLeft(fracOf(index));
        }
        chipLabel.textContent = opt.label;
        value.textContent = opt.label;
        help.textContent = opt.help;
        track.setAttribute('aria-valuenow', String(index));
        track.setAttribute('aria-valuetext', opt.label);
        dots.forEach((d, i) => d.classList.toggle('active', i === index));
        if (quiet) {
            thumbLabel.textContent = opt.label;
            levelEls.forEach((el, i) => el.classList.toggle('active', i === index));
            // Crossfade the one-liner only when it actually changes (remove +
            // reflow restarts the entrance animation).
            if (desc.textContent !== opt.short) {
                desc.textContent = opt.short;
                desc.classList.remove('yt-desc-in');
                void desc.offsetWidth;
                desc.classList.add('yt-desc-in');
            }
        }
    }

    function select(i) {
        const next = Math.min(lastIndex, Math.max(0, i));
        index = next;
        render();
        // In-memory only — committed to SUMMARY_LENGTH when the user generates.
        _pendingDetail = DETAIL_OPTIONS[index].value;
    }

    // Map a pointer x-position to the nearest level index.
    function indexFromClientX(clientX) {
        const rect = track.getBoundingClientRect();
        const usable = rect.width - THUMB_W;
        if (usable <= 0) return index;
        let frac = (clientX - rect.left - THUMB_W / 2) / usable;
        frac = Math.min(1, Math.max(0, frac));
        return Math.round(frac * lastIndex);
    }

    // v2 drag feel: the thumb follows the pointer freely (clamped inside the
    // track) while the nearest level stays selected live; classic snaps the
    // thumb detent-to-detent as before.
    function thumbToPointer(clientX) {
        const rect = track.getBoundingClientRect();
        const half = THUMB_W / 2;
        const x = Math.min(rect.width - half, Math.max(half, clientX - rect.left));
        thumb.style.left = `${x}px`;
    }

    track.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragging = true;
        try { track.setPointerCapture(e.pointerId); } catch (_) {}
        if (quiet) {
            track.classList.add('dragging');
            thumbToPointer(e.clientX);
        }
        select(indexFromClientX(e.clientX));
    });
    track.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        if (quiet) thumbToPointer(e.clientX);
        select(indexFromClientX(e.clientX));
    });
    const endDrag = (e) => {
        if (!dragging) return;
        dragging = false;
        try { track.releasePointerCapture(e.pointerId); } catch (_) {}
        if (quiet) {
            // Release: spring-snap to the selected detent (the `dragging` class
            // held the left-transition off while tracking the pointer).
            track.classList.remove('dragging');
            thumb.style.left = posLeft(fracOf(index));
        }
    };
    track.addEventListener('pointerup', endDrag);
    track.addEventListener('pointercancel', endDrag);

    track.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); select(index - 1); }
        else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); select(index + 1); }
        else if (e.key === 'Home') { e.preventDefault(); select(0); }
        else if (e.key === 'End') { e.preventDefault(); select(lastIndex); }
    });

    helpBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        helpOpen = !helpOpen;
        help.hidden = !helpOpen;
        helpBtn.classList.toggle('active', helpOpen);
    });

    // --- Open / close the popover ---
    const onDocClick = (e) => {
        if (pop.contains(e.target) || chip.contains(e.target)) return;
        closePop();
    };
    const onKeydown = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); closePop(); chip.focus(); }
    };

    function openPop() {
        const container = wrap.closest('.yt-timestamps-container');
        if (!container) return;
        container.appendChild(pop);
        pop.hidden = false;

        // Anchor the popover just below the chip, clamped inside the container so
        // it never spills past the right edge.
        const chipRect = chip.getBoundingClientRect();
        const contRect = container.getBoundingClientRect();
        const popW = pop.offsetWidth || 236;
        let left = chipRect.left - contRect.left;
        const maxLeft = contRect.width - popW - 8;
        if (left > maxLeft) left = Math.max(8, maxLeft);
        pop.style.left = `${left}px`;
        pop.style.top = `${chipRect.bottom - contRect.top + 8}px`;

        open = true;
        chip.setAttribute('aria-expanded', 'true');
        chip.classList.add('open');
        track.focus();
        // Defer so the opening click doesn't immediately close it.
        setTimeout(() => document.addEventListener('click', onDocClick, true), 0);
        document.addEventListener('keydown', onKeydown, true);
    }

    function closePop() {
        open = false;
        pop.hidden = true;
        if (pop.parentElement) pop.parentElement.removeChild(pop);
        chip.setAttribute('aria-expanded', 'false');
        chip.classList.remove('open');
        document.removeEventListener('click', onDocClick, true);
        document.removeEventListener('keydown', onKeydown, true);
    }

    chip.addEventListener('click', (e) => {
        // Don't let the click reach the header accordion toggle.
        e.stopPropagation();
        if (open) closePop(); else openPop();
    });

    render();

    // Confirm against the background. Normally this agrees with what was just
    // drawn; it only moves the chip in the degraded case where the mount's
    // bounded wait for the preferences timed out. In-memory selection only.
    readPanelPrefs((prefs) => {
        const stored = DETAIL_OPTIONS.findIndex((o) => o.value === prefs.summaryLength);
        if (stored !== -1 && stored !== index) select(stored);
    });

    return wrap;
}

// The summary's detail control, shown on the briefing card rather than in the
// panel header. Pressing it discloses the model and the age of the result —
// the two things a viewer asks about a summary they did not just watch appear.
//
// `meta` is the request that generated the summary on screen. It matters that
// this reads from there and not from storage: the stored preference is a global
// the user can change straight after generating, which would leave the chip
// describing a summary that was never made at that level.
function buildBriefingDetail(meta) {
    const generated = DETAIL_OPTIONS.find((o) => o.value === meta?.length);
    const label = (generated || DETAIL_OPTIONS[storedDetailIndex()]).label;

    const provenance = [];
    if (meta?.modelId) provenance.push(meta.modelId);
    if (meta?.generatedAt) provenance.push(`generated ${relativeTime(meta.generatedAt)}`);

    // Nothing to disclose (an older cached render, or the dev harness): a plain
    // read-only badge, and the stored preference as the best guess at a label.
    if (!provenance.length) {
        const badge = document.createElement('span');
        badge.className = 'yt-brief-detail yt-brief-detail-static';
        badge.textContent = label;
        if (!generated) {
            readPanelPrefs((prefs) => {
                const opt = DETAIL_OPTIONS.find((o) => o.value === prefs.summaryLength);
                if (opt) badge.textContent = opt.label;
            });
        }
        return { control: badge, line: null };
    }

    const line = document.createElement('div');
    line.className = 'yt-brief-meta';
    line.id = 'yt-brief-meta';
    line.textContent = provenance.join(' · ');
    line.hidden = true;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'yt-brief-detail';
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', 'yt-brief-meta');
    btn.title = 'How this summary was generated';

    const text = document.createElement('span');
    text.textContent = label;
    const caret = document.createElement('span');
    caret.className = 'yt-brief-caret';
    caret.innerHTML = '<svg width="8" height="5" viewBox="0 0 10 6" fill="none" aria-hidden="true"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    btn.appendChild(text);
    btn.appendChild(caret);

    btn.addEventListener('click', () => {
        const open = line.hidden;
        line.hidden = !open;
        btn.classList.toggle('yt-open', open);
        btn.setAttribute('aria-expanded', String(open));
    });

    return { control: btn, line };
}

// "4 min ago" / "2 hours ago" / "3 days ago" — how old the summary on screen is.
function relativeTime(timestamp) {
    const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
    if (seconds < 90) return 'just now';
    const units = [
        { limit: 3600, size: 60, name: 'min', plural: false },
        { limit: 86400, size: 3600, name: 'hour', plural: true },
        { limit: 2592000, size: 86400, name: 'day', plural: true }
    ];
    for (const unit of units) {
        if (seconds < unit.limit) {
            const value = Math.round(seconds / unit.size);
            const suffix = unit.plural && value !== 1 ? 's' : '';
            return `${value} ${unit.name}${suffix} ago`;
        }
    }
    return new Date(timestamp).toLocaleDateString();
}

// The video's own length, for the briefing rail. The player is the accurate
// source and is right there; the request's duration (taken from the last
// transcript cue) covers a restore that renders before the player is ready.
function videoRuntimeLabel(meta) {
    const video = document.querySelector('video');
    let seconds = (video && Number.isFinite(video.duration) && video.duration > 0) ? video.duration : null;
    if (!seconds && typeof meta?.durationMinutes === 'number' && meta.durationMinutes > 0) {
        seconds = meta.durationMinutes * 60;
    }
    if (!seconds) return null;
    const whole = Math.round(seconds);
    const hours = Math.floor(whole / 3600);
    const minutes = Math.floor(whole / 60) % 60;
    const secs = String(whole % 60).padStart(2, '0');
    return hours
        ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}`
        : `${minutes}:${secs}`;
}

// Minutes to read the summary, at the same 200 wpm the background uses to
// estimate time saved — so the two numbers can never disagree.
function readingMinutes(summaryText) {
    const words = String(summaryText || '').trim().split(/\s+/).filter(Boolean).length;
    return words ? Math.max(1, Math.round(words / 200)) : null;
}

// Gear (settings) icon markup, shared by the empty-state header.
const GEAR_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 1 1 1.51 1.65 1.65 0 0 0 1.82.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';

// Build (or rebuild) the pre-generation empty state inside an existing container:
// header (title + gear) and body (prompt + Detail slider + Generate button). Used
// both for the first render and when the user hits Reset on a finished summary, so
// picking a different Detail level and regenerating is always one path.
function renderEmptyState(container) {
    if (!container) return;

    // Clear whatever was there (summary or prior empty state) and drop the DOM
    // cache. There are no points to follow once the summary is gone.
    stopPlaybackTracking();
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

    // Append elements (title + Detail chip on the left, gear on the right)
    headerLeft.appendChild(headerTitle);
    headerLeft.appendChild(buildDetailChip());
    panelHeader.appendChild(headerLeft);
    panelHeader.appendChild(gearIcon);
    panel.appendChild(panelHeader);

    // Create panel body (empty state before generation)
    const panelBody = document.createElement('div');
    panelBody.className = 'yt-timestamps-panel-body';

    const emptyState = document.createElement('div');
    emptyState.className = 'yt-timestamps-empty-state';
    if (_skinPref === 'quiet') {
        // Quiet: a faint "ghost preview" of the output itself — placeholder
        // section label + rows that shimmer while a summary is generating.
        emptyState.innerHTML = `
            <div class="yt-ghost-preview" aria-hidden="true">
                <div class="yt-ghost-row"><span class="yt-ghost-chip"></span><span class="yt-ghost-bar" style="width: 76%"></span></div>
                <div class="yt-ghost-row"><span class="yt-ghost-chip"></span><span class="yt-ghost-bar" style="width: 58%"></span></div>
            </div>
            <div class="yt-empty-text">An overview, then chapters linked to the video</div>
        `;
    } else {
        emptyState.innerHTML = `
            <div class="yt-empty-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <polyline points="12 6 12 12 16 14"/>
                </svg>
            </div>
            <div class="yt-empty-text">Generate an AI-powered summary with timestamps</div>
        `;
    }
    panelBody.appendChild(emptyState);

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

    // Re-read the preferences and keep the panel in sync with live YouTube theme
    // toggles (when following the system). The mount already waited for the
    // first answer, so this normally confirms what was drawn; the rebuild below
    // is the fallback for the case where it could not — a bounded wait that
    // timed out — since the skin affects the markup built above (ghost preview,
    // Detail slider variant) and not just its CSS. The re-entrant call sees the
    // matching pref and settles.
    const renderedSkin = _skinPref;
    readPanelPrefs((prefs) => {
        _themePref = prefs.theme;
        applyPanelTheme(_themePref, container);
        _skinPref = prefs.skin;
        applyPanelSkin(_skinPref, container);
        if (_skinPref !== renderedSkin) {
            renderEmptyState(container);
            return;
        }
        // First-run onboarding: point new users to the settings gear icon.
        if (prefs.showSettingsHint) showSettingsHint(panel, gearIcon);
    });
}

let _mountPending = false;

// Function to inject sidebar into the DOM.
//
// The panel is built once, in the skin and theme the user actually chose. On
// the very first mount of a page those are still in flight (see
// primePanelPrefs), so the mount waits for them: drawing Classic and correcting
// to Quiet a moment later is a flash the user sees on every load. Every later
// mount — SPA navigation, miniplayer toggle — has the answer already and is
// synchronous, as before.
function injectSidebar(secondary) {
    if (document.querySelector('.yt-timestamps-container')) return;

    if (!_prefsPrimed) {
        if (_mountPending) return;
        _mountPending = true;
        const bounded = new Promise((resolve) => setTimeout(resolve, PREFS_PRIME_TIMEOUT_MS));
        Promise.race([primePanelPrefs(), bounded]).then(() => {
            _mountPending = false;
            // The page can move on while we wait; YouTube tears the sidebar out
            // on navigation, and resetSidebar may have mounted one since.
            if (!secondary.isConnected) return;
            if (document.querySelector('.yt-timestamps-container')) return;
            mountSidebar(secondary);
        });
        return;
    }

    mountSidebar(secondary);
}

function mountSidebar(secondary) {
    // Create container element
    const container = document.createElement('div');
    container.className = 'yt-timestamps-container';
    // Apply the theme and skin up-front, before the container is in the
    // document, so the panel's first paint is already the right one.
    applyPanelTheme(_themePref, container);
    applyPanelSkin(_skinPref, container);

    // Inject into #secondary-inner so we don't push the sticky engagement panels container down
    // (which triggers YouTube's responsive layout to auto-close them).
    const secondaryInner = secondary.querySelector('#secondary-inner');
    const panels = secondary.querySelector('#panels');
    
    if (panels) {
        panels.parentElement.insertBefore(container, panels);
    } else if (secondaryInner) {
        secondaryInner.insertBefore(container, secondaryInner.firstChild);
    } else {
        secondary.insertBefore(container, secondary.firstChild);
    }
    renderEmptyState(container);
    ensureYtThemeObserver();

    // Restore cached summary if available (e.g. after miniplayer toggle)
    const cachedSummary = getCachedSummary(getCurrentVideoId());
    if (cachedSummary) {
        renderTimestampsUI(cachedSummary.text, cachedSummary.meta);
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
    text.textContent = 'Open Settings from this icon anytime to add or update your LLM API keys.';

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
        writePanelPref('showSettingsHint', false);
    };

    dismiss.addEventListener('click', (e) => {
        e.stopPropagation();
        close();
    });

    // Also dismiss once the user opens settings via the gear
    gearIcon.addEventListener('click', close, { once: true });

    host.appendChild(hint);
}

// --- Request ownership -------------------------------------------------------
//
// A generation is bound to the video it was started on and to an id of its own.
// Everything the background sends back carries that binding, and the panel acts
// only on messages that match: a summary produced for the previous video, or by
// a run this panel has already given up on, is dropped rather than rendered
// over whatever is on screen now.
let _activeRequest = null;

function newRequestId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return `r${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// A message with no id predates the binding (the dev harness sends these), so it
// is allowed through; one that names a generation this panel isn't waiting for
// is not.
function isStaleRequest(requestId) {
    if (!requestId) return false;
    return !_activeRequest || _activeRequest.id !== requestId;
}

// Does this message belong to what the panel is showing and waiting for?
function isCurrentGeneration(message) {
    if (!message) return false;
    if (message.videoId && message.videoId !== getCurrentVideoId()) return false;
    return !isStaleRequest(message.requestId);
}

// Tell the background to stop the generation this panel started. Used by the UI
// timeout and by navigating away — without it, the panel's own timeout left the
// provider call running, free to overlap the next attempt.
function cancelActiveRequest(reason) {
    if (!_activeRequest) return;
    const { id, videoId } = _activeRequest;
    _activeRequest = null;
    try {
        chrome.runtime.sendMessage({ action: 'CANCEL_ANALYSIS', requestId: id, videoId, reason }, () => {
            void chrome.runtime.lastError;   // the worker may already be gone
        });
    } catch { /* extension context invalidated */ }
}

// Set while a generation is in flight: re-arms that run's idle timeout. The
// progress handler calls it, which is what lets a multi-part summary of a long
// video take as long as it honestly needs.
let _noteAnalysisProgress = null;

function noteAnalysisProgress() {
    if (typeof _noteAnalysisProgress === 'function') _noteAnalysisProgress();
}

// Run the transcript -> summary analysis flow (used when at least one API key is set)
function runAnalysis() {
    // One generation at a time: a second click, or a Try again racing a slow
    // response, must not start work whose result would arrive out of order.
    if (_activeRequest) return;

    const request = { id: newRequestId(), videoId: getCurrentVideoId() };
    _activeRequest = request;
    updateGenerateButton('extracting');

    // Send analysis request with timeout. Which provider runs is a settings-page
    // preference the background resolves for itself; length is the "Detail"
    // preset currently selected in the panel chip.
    //
    // The timeout measures silence, not total time. A long video is summarised
    // in parts, and the whole run legitimately outlasts any single-call budget —
    // but each finished part reports progress, so re-arming the timer on every
    // update still catches a genuinely stuck provider without cutting off a run
    // that is visibly working.
    const sendAnalysis = (length, idleTimeout = 120000) => {
        return new Promise((resolve) => {
            let resolved = false;
            let timer = null;

            const arm = () => {
                clearTimeout(timer);
                timer = setTimeout(() => {
                    if (resolved) return;
                    resolved = true;
                    _noteAnalysisProgress = null;
                    // Stop the provider call too, not just the waiting.
                    cancelActiveRequest('timeout');
                    resolve({ success: false, error: LOCAL_ERRORS.timeout });
                }, idleTimeout);
            };
            arm();
            _noteAnalysisProgress = arm;

            chrome.runtime.sendMessage({
                action: "START_ANALYSIS",
                length: length,
                videoId: request.videoId,
                requestId: request.id
            }, (res) => {
                if (resolved) return;
                resolved = true;
                clearTimeout(timer);
                _noteAnalysisProgress = null;
                if (chrome.runtime.lastError) {
                    resolve({ success: false, error: LOCAL_ERRORS.disconnected });
                } else {
                    resolve(res || { success: false, error: LOCAL_ERRORS.disconnected });
                }
            });
        });
    };

    // Main execution
    (async () => {
        try {
            // Use the level selected in the chip; fall back to the last known
            // stored default.
            const length = _pendingDetail || _panelPrefs.summaryLength || 'standard';
            // Generating commits this level as the new sticky default, so the next
            // video opens on it. The summary's own badge reads the request, not this.
            writePanelPref('summaryLength', length);

            const result = await sendAnalysis(length);

            // Another generation took ownership while this one was in flight:
            // its outcome is no longer this panel's to report.
            if (_activeRequest && _activeRequest.id !== request.id) return;
            if (_activeRequest === request) _activeRequest = null;

            // A cancelled run is an expected outcome, not a failure to show.
            if (result?.cancelled) return;

            if (result && result.success) {
                updateGenerateButton('done');
            } else {
                updateGenerateButton('error', result?.error);
            }
        } catch (e) {
            if (_activeRequest === request) _activeRequest = null;
            updateGenerateButton('error', LOCAL_ERRORS.disconnected);
        }
    })();
}

// Toggle the primary button between generating a summary and prompting for API keys.
// With nothing configured, the button opens the settings page instead of running
// analysis.
//
// Whether a provider is usable is decided in the background: it is the one place
// that may read keys, and it already knows that a custom provider on a local
// endpoint is saved with an empty key on purpose. The panel used to answer this
// by reading the whole settings store — every key included — to compute a single
// boolean.
function setGenerateButtonMode(genBtn) {
    if (!genBtn) return;
    readPanelPrefs((prefs) => {
        const hasKey = prefs.providerReady;
        const emptyText = document.querySelector('.yt-empty-text');
        if (hasKey) {
            genBtn.textContent = 'Generate summary';
            genBtn.classList.remove('yt-needs-keys');
            genBtn.onclick = runAnalysis;
            if (emptyText) emptyText.textContent = _skinPref === 'quiet'
                ? 'An overview, then chapters linked to the video'
                : 'Generate an AI-powered summary with timestamps';
        } else {
            genBtn.textContent = 'Set API keys';
            genBtn.classList.add('yt-needs-keys');
            genBtn.onclick = () => { chrome.runtime.sendMessage({ action: "OPEN_OPTIONS" }); };
            if (emptyText) emptyText.textContent = 'Add an LLM API key to start generating summaries';
        }
    });
}

// Re-evaluate the button mode when keys change, but only while the button is idle
function refreshGenerateButtonMode() {
    const genBtn = document.querySelector('.yt-timestamps-generate-button');
    if (!genBtn) return;
    if (genBtn.disabled || genBtn.hidden) return;
    setGenerateButtonMode(genBtn);
}

// Set the primary button's label as text, optionally preceded by the spinner.
// Provider/API error strings reach this button, so its content is built from
// nodes instead of markup.
function setGenerateButtonLabel(genBtn, text, withSpinner) {
    genBtn.textContent = '';
    if (withSpinner) {
        const spinner = document.createElement('span');
        spinner.className = 'yt-spinner';
        genBtn.appendChild(spinner);
    }
    genBtn.appendChild(document.createTextNode(text));
}

// --- Recoverable errors ------------------------------------------------------
//
// A failure used to be pushed into the Generate button's label and cleared
// after three seconds (or left the button permanently disabled). Instead the
// panel now shows a compact status block that stays until the user acts, and
// every category offers a way forward: Retry always, Open settings when the fix
// lives there, and Copy details for a report that carries no secrets.
//
// The categories themselves come from the service worker (scripts/errors.js).
// The two below are the ones it can never report, because they are failures of
// the message channel itself.
const LOCAL_ERRORS = {
    timeout: {
        code: 'timeout',
        title: 'The request timed out',
        detail: 'No response after two minutes. Try again, or switch to a faster model.',
        settings: true
    },
    disconnected: {
        code: 'disconnected',
        title: 'The extension reloaded',
        detail: 'Refresh this YouTube page, then try again.',
        settings: false
    }
};

const ALERT_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';

// Accept either a classified payload from the background or a bare string, so
// an older message (or the dev harness) still renders something sensible.
function normalizeError(input) {
    if (input && typeof input === 'object' && (input.title || input.code)) {
        return {
            code: input.code || 'unknown',
            title: input.title || 'Something went wrong',
            detail: input.detail || '',
            settings: !!input.settings,
            raw: input.raw || '',
            stage: input.stage || null,
            provider: input.provider || null,
            model: input.model || null,
            level: input.level || null,
            status: input.status || null
        };
    }
    return {
        code: 'unknown',
        title: 'Something went wrong',
        detail: typeof input === 'string' && input ? input : "The summary couldn't be generated.",
        settings: false,
        raw: typeof input === 'string' ? input : ''
    };
}

// The error currently on screen, so Copy details can build its report.
let _lastError = null;

function makeErrorAction(label, extraClass, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = extraClass ? `yt-error-btn ${extraClass}` : 'yt-error-btn';
    btn.textContent = label;
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick(btn);
    });
    return btn;
}

// A copyable report for bug threads. Deliberately excludes API keys, caption
// URLs (they carry signatures and session tokens), transcript text, the video
// title and the video ID; `raw` was already sanitized by scripts/errors.js.
function buildDiagnostics(error) {
    const manifest = (typeof chrome !== 'undefined' && chrome.runtime?.getManifest)
        ? chrome.runtime.getManifest() : {};
    const lines = [
        `${manifest.name || 'YouTube Transcript Extractor'} ${manifest.version || ''}`.trim(),
        `When: ${new Date().toISOString()}`,
        `Category: ${error.code || 'unknown'} — ${error.title || ''}`,
        `Stage: ${error.stage || 'unknown'}`
    ];
    if (error.provider) lines.push(`Provider: ${error.provider}`);
    if (error.model) lines.push(`Model: ${error.model}`);
    if (error.level) lines.push(`Detail level: ${error.level}`);
    if (error.status) lines.push(`HTTP status: ${error.status}`);
    if (error.raw) lines.push(`Message: ${error.raw}`);
    lines.push('', 'Excludes API keys, caption URLs, transcript text and video details.');
    return lines.join('\n');
}

// Put text on the clipboard. clipboard.writeText needs a focused document and a
// secure context and neither is guaranteed inside YouTube's page, so the hidden
// textarea stays as the fallback.
function writeClipboardText(text) {
    const fallback = () => {
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.cssText = 'position:fixed;top:-1000px;opacity:0';
        document.body.appendChild(area);
        area.select();
        let copied = false;
        try { copied = document.execCommand('copy'); } catch { copied = false; }
        area.remove();
        return copied ? Promise.resolve() : Promise.reject(new Error('Copy command refused'));
    };
    if (navigator.clipboard?.writeText) {
        return navigator.clipboard.writeText(text).catch(fallback);
    }
    return fallback();
}

// Swap a text button's label to say what happened, then put it back.
function reportCopy(btn, label, done) {
    btn.textContent = done ? 'Copied' : 'Copy failed';
    setTimeout(() => { btn.textContent = label; }, 1600);
}

function copyDiagnostics(btn) {
    const text = buildDiagnostics(_lastError || { code: 'unknown' });
    writeClipboardText(text)
        .then(() => reportCopy(btn, 'Copy details', true))
        .catch(() => reportCopy(btn, 'Copy details', false));
}

// Remove the status block and put the Generate button back in charge.
function clearErrorBlock() {
    _lastError = null;
    const block = document.querySelector('.yt-error-block');
    if (block) block.remove();
    const genBtn = document.querySelector('.yt-timestamps-generate-button');
    if (genBtn) genBtn.hidden = false;
}

function renderErrorBlock(error) {
    // Normally the action area under the empty state. The fallbacks exist so a
    // failure is never swallowed if generation is somehow reported while the
    // panel is showing something else.
    const host = document.getElementById('action-area')
        || document.querySelector('.yt-timestamps-panel-body')
        || document.querySelector('.yt-timestamps-panel');
    if (!host) return;

    _lastError = error;
    const existing = document.querySelector('.yt-error-block');
    if (existing) existing.remove();

    const block = document.createElement('div');
    block.className = 'yt-error-block';
    block.setAttribute('role', 'alert');

    const head = document.createElement('div');
    head.className = 'yt-error-head';
    const icon = document.createElement('span');
    icon.className = 'yt-error-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = ALERT_SVG;
    const title = document.createElement('span');
    title.className = 'yt-error-title';
    title.textContent = error.title;
    head.appendChild(icon);
    head.appendChild(title);

    const detail = document.createElement('p');
    detail.className = 'yt-error-detail';
    detail.textContent = error.detail;

    const actions = document.createElement('div');
    actions.className = 'yt-error-actions';
    actions.appendChild(makeErrorAction('Try again', 'yt-error-primary', () => {
        clearErrorBlock();
        // The failed generation no longer owns the panel, so a retry is free to
        // claim it. Without this the one-at-a-time guard would swallow the click.
        _activeRequest = null;
        runAnalysis();
    }));
    if (error.settings) {
        actions.appendChild(makeErrorAction('Open settings', '', () => {
            chrome.runtime.sendMessage({ action: 'OPEN_OPTIONS' });
        }));
    }
    actions.appendChild(makeErrorAction('Copy details', '', copyDiagnostics));

    block.appendChild(head);
    if (error.detail) block.appendChild(detail);
    block.appendChild(actions);
    if (host.id === 'action-area') host.insertBefore(block, host.firstChild);
    else host.appendChild(block);

    // The block owns recovery while it is up, so there is only one way forward.
    const genBtn = document.querySelector('.yt-timestamps-generate-button');
    if (genBtn) {
        genBtn.hidden = true;
        genBtn.disabled = false;
        genBtn.style.pointerEvents = '';
        setGenerateButtonLabel(genBtn, 'Generate summary');
    }
}

// Function to update the generate button state
let _sweepTimeout = null;
function updateGenerateButton(phase, payload) {
    const panel = _getPanel();

    // 'done' usually arrives after the summary has replaced the empty state
    // (so the generate button is gone): fire the Quiet skin's completion sweep
    // on whatever panel is showing, then fall through to the button logic for
    // the cases where the button still exists.
    if (phase === 'done' && panel) {
        panel.classList.remove('yt-generating');
        panel.classList.add('yt-done-sweep');
        clearTimeout(_sweepTimeout);
        _sweepTimeout = setTimeout(() => panel.classList.remove('yt-done-sweep'), 900);
    }

    if (phase === 'error') {
        if (panel) panel.classList.remove('yt-generating');
        renderErrorBlock(normalizeError(payload));
        return;
    }

    // Any forward progress retires the previous failure.
    clearErrorBlock();

    const genBtn = document.querySelector('.yt-timestamps-generate-button');
    if (!genBtn) return;

    switch (phase) {
        case 'extracting':
            genBtn.disabled = true;
            setGenerateButtonLabel(genBtn, 'Extracting transcript...', true);
            if (panel) panel.classList.add('yt-generating');
            break;
        case 'calling_api':
            genBtn.disabled = true;
            // A windowed run names the part it is on: without it a five-hour
            // video looks hung for minutes behind an unchanging label.
            setGenerateButtonLabel(genBtn,
                typeof payload === 'string' && payload ? payload : 'Generating summary...', true);
            if (panel) panel.classList.add('yt-generating');
            break;
        case 'done':
            setGenerateButtonLabel(genBtn, 'Generate summary');
            genBtn.disabled = false;
            genBtn.style.pointerEvents = '';
            break;
    }
}

// Reveal a timestamp title that's too long to fit on one line. On hover — but
// only when the text is actually truncated — a tooltip with the full title is
// shown. It's mounted on the container (position:relative) rather than the row,
// because the row's overflow:hidden would otherwise clip it. One tooltip element
// is shared across all rows in a panel.
function attachTitleTooltip(titleEl) {
    const show = () => {
        // Nothing to reveal if the title fits without ellipsis.
        if (titleEl.scrollWidth <= titleEl.clientWidth) return;
        const container = titleEl.closest('.yt-timestamps-container');
        if (!container) return;

        let tip = container.querySelector('.yt-title-tooltip');
        if (!tip) {
            tip = document.createElement('div');
            tip.className = 'yt-title-tooltip';
            container.appendChild(tip);
        }
        tip.textContent = titleEl.textContent;
        tip.hidden = false;

        // Position relative to the container, clamped inside its edges. Prefer
        // sitting above the row; drop below if there's no room up top.
        const tRect = titleEl.getBoundingClientRect();
        const cRect = container.getBoundingClientRect();
        const gap = 8;
        let left = tRect.left - cRect.left;
        const maxLeft = cRect.width - tip.offsetWidth - 8;
        if (left > maxLeft) left = maxLeft;
        if (left < 8) left = 8;
        tip.style.left = `${left}px`;

        let top = tRect.top - cRect.top - tip.offsetHeight - gap;
        if (top < 4) top = tRect.bottom - cRect.top + gap;
        tip.style.top = `${top}px`;
    };
    const hide = () => {
        const tip = titleEl.closest('.yt-timestamps-container')?.querySelector('.yt-title-tooltip');
        if (tip) tip.hidden = true;
    };
    titleEl.addEventListener('mouseenter', show);
    titleEl.addEventListener('mouseleave', hide);
}

// Split a summary into its overview line and the chapter lines below it.
//
// The overview travels inside the summary text (see summary-validator.js), so
// every path that already carries a summary — the render message, the per-video
// cache, a restore after a miniplayer toggle — carries the gist with it and
// needs no second field. A summary without one is the normal older case and
// simply renders as it always did.
function splitOverview(summaryText) {
    const overview = [];
    const body = [];
    for (const line of String(summaryText || '').split('\n')) {
        const clean = line.replace(/`+/g, '').trim().replace(/^[-*•]\s+/, '').replace(/\*\*/g, '').trim();
        if (!clean) continue;
        const gist = /^>+\s*(.+)$/.exec(clean);
        if (gist) { overview.push(gist[1].trim()); continue; }
        body.push(clean);
    }
    return { overview: overview.join(' ').trim() || null, lines: body };
}

// The briefing card: what this summary is, before the chapter list starts.
//
// The audit asked for "the gist in the first glance" without settling what a
// glance is, so this is where those decisions live:
//  - The card is the one raised surface in the panel — a fill and a hairline,
//    no shadow, which inside a 402px column would read as a modal. It says
//    "this block is about the summary", not "this is the first row".
//  - Collapsed is three lines of overview. The card's own padding costs height,
//    and the third line buys most of it back.
//  - The rail carries only figures the extension already has: the video's
//    length, the points that survived validation, and the reading time at the
//    same 200 wpm the background uses. Together they are the whole proposition
//    — 72 minutes of video, 3 minutes of reading.
//  - The detail level lives here rather than in the header, next to the numbers
//    it explains, and discloses the model and the summary's age when pressed.
//  - "Show more" appears only when something is actually clipped; a control
//    that expands nothing is worse than no control (see revealGistToggle).
//  - Copy takes the overview alone. Copying the whole summary with timestamp
//    links is its own backlog item; this button does the small thing it says.
//  - Expansion is not persisted. It costs one click, and a remembered
//    expansion would make the panel a different height on every video.
function buildBriefingCard({ overview, meta, points, summaryText }) {
    const block = document.createElement('div');
    block.className = 'yt-gist';
    // Joins the Quiet skin's entrance cascade at position 0, ahead of the rows.
    block.style.setProperty('--yt-i', 0);

    const card = document.createElement('div');
    card.className = 'yt-brief';

    if (overview) {
        const eyebrow = document.createElement('span');
        eyebrow.className = 'yt-gist-eyebrow';
        eyebrow.textContent = 'Overview';

        // Model-generated prose: a text node, never innerHTML.
        const body = document.createElement('p');
        body.className = 'yt-gist-text';
        body.id = 'yt-gist-text';
        body.textContent = overview;

        card.appendChild(eyebrow);
        card.appendChild(body);
    }

    const rail = document.createElement('div');
    rail.className = 'yt-brief-rail';
    const runtime = videoRuntimeLabel(meta);
    const minutes = readingMinutes(summaryText);
    const stats = [
        runtime ? [runtime, 'video'] : null,
        points ? [String(points), points === 1 ? 'point' : 'points'] : null,
        minutes ? [`${minutes} min`, 'read'] : null
    ].filter(Boolean);
    for (const [value, name] of stats) {
        const stat = document.createElement('span');
        stat.className = 'yt-brief-stat';
        const strong = document.createElement('b');
        strong.textContent = value;
        stat.appendChild(strong);
        stat.appendChild(document.createTextNode(` ${name}`));
        rail.appendChild(stat);
    }
    if (stats.length) card.appendChild(rail);

    const actions = document.createElement('div');
    actions.className = 'yt-gist-actions';

    if (overview) {
        const moreBtn = document.createElement('button');
        moreBtn.type = 'button';
        moreBtn.className = 'yt-gist-link yt-gist-more';
        moreBtn.textContent = 'Show more';
        moreBtn.setAttribute('aria-expanded', 'false');
        moreBtn.setAttribute('aria-controls', 'yt-gist-text');
        // Revealed after layout, once we know the text is long enough to clip.
        moreBtn.hidden = true;
        moreBtn.addEventListener('click', () => {
            const expanded = card.classList.toggle('yt-gist-expanded');
            moreBtn.textContent = expanded ? 'Show less' : 'Show more';
            moreBtn.setAttribute('aria-expanded', String(expanded));
        });

        const separator = document.createElement('span');
        separator.className = 'yt-gist-sep';
        separator.textContent = '·';
        separator.hidden = true;
        separator.setAttribute('aria-hidden', 'true');

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'yt-gist-link yt-gist-copy';
        copyBtn.textContent = 'Copy';
        copyBtn.title = 'Copy the overview';
        copyBtn.addEventListener('click', () => {
            writeClipboardText(overview)
                .then(() => reportCopy(copyBtn, 'Copy', true))
                .catch(() => reportCopy(copyBtn, 'Copy', false));
        });

        actions.appendChild(moreBtn);
        actions.appendChild(separator);
        actions.appendChild(copyBtn);
    } else {
        // No overview to read: the detail control is the row's only occupant and
        // sits where the links would have started, not pushed to the far edge.
        actions.classList.add('yt-gist-actions-solo');
    }

    const detail = buildBriefingDetail(meta);
    actions.appendChild(detail.control);
    card.appendChild(actions);
    if (detail.line) card.appendChild(detail.line);

    block.appendChild(card);
    return block;
}

// Show the expand control only for an overview that is actually being clipped.
// A clamped paragraph reports its overflow only once it has been laid out, so
// this runs after the panel is in the document.
function revealGistToggle(block) {
    const body = block?.querySelector('.yt-gist-text');
    const moreBtn = block?.querySelector('.yt-gist-more');
    if (!body || !moreBtn) return;
    const clipped = body.scrollHeight - body.clientHeight > 1;
    moreBtn.hidden = !clipped;
    const separator = block.querySelector('.yt-gist-sep');
    if (separator) separator.hidden = !clipped;
}

// Function to render timestamps UI from processed data
// `meta` describes the request that produced this summary: which video, detail
// level and model. It is what the cache key and the header badge are taken from,
// instead of from the URL and the global settings at render time.
function renderTimestampsUI(summaryText, meta) {
    const request = meta || null;
    // Cache the summary for restoration across DOM rebuilds (e.g. miniplayer toggle)
    cacheSummary(request?.videoId || getCurrentVideoId(), summaryText, request);

    // This function will build the UI for timestamps
    const container = document.querySelector('.yt-timestamps-container');
    if (!container) return;
    
    // Clear existing content and invalidate cached DOM references. The playback
    // tracker holds listeners on the player and on the old scroll container, so
    // it has to be released before either goes away.
    stopPlaybackTracking();
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

    // A circular-arrows glyph promised "run it again with the same settings",
    // which is not what this does: it discards the summary and returns to the
    // setup state so a different Detail level can be chosen. A back-arrow and
    // the words say that; an icon on its own never did.
    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'yt-reset-btn';
    resetBtn.title = 'Discard this summary and choose a new detail level';
    resetBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/></svg>';
    const resetLabel = document.createElement('span');
    resetLabel.textContent = 'Start over';
    resetBtn.appendChild(resetLabel);
    resetBtn.addEventListener('click', (e) => {
        // Don't let the click bubble to the header (which toggles the accordion).
        e.stopPropagation();
        // Clear the cached summary so no re-inject restores it, then rebuild the
        // empty state (the Detail slider re-syncs to the stored SUMMARY_LENGTH).
        clearSummaryCache(getCurrentVideoId());
        _activeRequest = null;
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

    // Process summary text: the overview line first, then the chapter lines.
    // The briefing card is built after the rows and inserted above them, because
    // the figures on its rail describe what the rows turned out to be.
    const { overview, lines } = splitOverview(summaryText);
    let itemCount = 0;
    // {sec, el} for every rendered point, handed to the playback tracker once
    // the panel is in the document.
    const playbackPoints = [];
    // Render order index, set as a CSS custom property on each section header
    // and row. Classic ignores it; the Quiet skin uses it to stagger the
    // entrance cascade when a summary first renders. Index 0 is reserved for
    // the briefing card, which leads the cascade.
    let orderIndex = 1;

    lines.forEach(cleanLine => {
        // splitOverview has already normalized the common LLM formatting drift
        // that would otherwise drop valid points: code fences/backticks, a
        // leading list bullet, and markdown bold markers.
        if (cleanLine.startsWith('#')) {
            const sectionHeader = document.createElement('div');
            sectionHeader.className = 'yt-section-header';
            sectionHeader.textContent = cleanLine.substring(1).trim();
            sectionHeader.style.setProperty('--yt-i', orderIndex++);
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
            tsDiv.style.setProperty('--yt-i', orderIndex++);

            const glowBorder = document.createElement('div');
            glowBorder.className = 'yt-glow-border';
            tsDiv.appendChild(glowBorder);
            
            const timeLabel = document.createElement('span');
            timeLabel.className = 'yt-time-label';
            // The title comes from the model, so it is inserted as text: build the
            // spans here rather than interpolating into innerHTML, or a title
            // containing angle brackets would be parsed as markup.
            const timeWrap = document.createElement('span');
            timeWrap.className = 'yt-time';
            const timeTextEl = document.createElement('span');
            timeTextEl.className = 'yt-time-text';
            timeTextEl.textContent = time;
            timeWrap.appendChild(timeTextEl);

            const titleEl = document.createElement('span');
            titleEl.className = 'yt-title';
            titleEl.textContent = title;

            timeLabel.appendChild(timeWrap);
            timeLabel.appendChild(document.createTextNode(' '));
            timeLabel.appendChild(titleEl);
            attachTitleTooltip(titleEl);
            
            const expandBtn = document.createElement('span');
            expandBtn.textContent = '+';
            expandBtn.className = 'yt-expand-btn';
            
            tsDiv.appendChild(timeLabel);
            tsDiv.appendChild(expandBtn);
            
            const accordionContent = document.createElement('div');
            accordionContent.className = 'yt-accordion-content';
            accordionContent.textContent = description;
            
            expandBtn.onclick = e => {
                e.stopPropagation();

                const scrollContainer = panelContent;

                // Single source of truth: is THIS item the one currently open?
                // (No per-button flag — a stale one caused switches to take two clicks.)
                const wasExpanded = _expandedAccordion === accordionContent;

                // Case 1: clicking the already-open item → toggle it closed (animated).
                if (wasExpanded) {
                    accordionContent.classList.remove('expanded');
                    expandBtn.textContent = '+';
                    expandBtn.classList.remove('yt-open');
                    tsDiv.classList.remove('yt-row-open');
                    _expandedAccordion = null;
                    _expandedAccordionBtn = null;
                    return;
                }

                // Case 2: a different item is open → collapse it instantly (no
                // transition), anchoring scroll so the clicked row doesn't jump.
                if (_expandedAccordion) {
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
                        _expandedAccordionBtn.classList.remove('yt-open');
                        const oldRow = _expandedAccordionBtn.closest('.yt-timestamp-item');
                        if (oldRow) oldRow.classList.remove('yt-row-open');
                    }
                }

                // Case 3 (falls through from 2, or nothing was open): open this item.
                accordionContent.classList.add('expanded');
                expandBtn.textContent = '−';
                expandBtn.classList.add('yt-open');
                tsDiv.classList.add('yt-row-open');
                _expandedAccordion = accordionContent;
                _expandedAccordionBtn = expandBtn;
            };
            
            // Hover background is handled by the CSS `:hover` rule so it stays
            // theme-aware; here we only toggle the red glow overlay.
            tsDiv.onmouseover = () => { glowBorder.style.opacity = '1'; };
            tsDiv.onmouseout = () => { glowBorder.style.opacity = '0'; };
            tsDiv.onclick = () => {
                const video = document.querySelector('video');
                if (video) video.currentTime = sec;
                // Quiet-skin seek confirmation: restart the row's pulse overlay
                // (remove + reflow re-triggers the ::before animation). No-op in
                // Classic, which has no styles for this class.
                tsDiv.classList.remove('yt-seek-pulse');
                void tsDiv.offsetWidth;
                tsDiv.classList.add('yt-seek-pulse');
            };
            
            playbackPoints.push({ sec, el: tsDiv });

            timestampsList.appendChild(tsDiv);
            timestampsList.appendChild(accordionContent);
        }
    });

    // Safety net: if the model returned section headers but not a single
    // parseable point, note it — but only its shape. The summary is the content
    // of someone's video, sometimes a members-only one, and the page console is
    // shared with YouTube and every other extension on the tab.
    if (itemCount === 0) {
        console.warn(`[yt-timestamps] No timestamp items parsed from a ${summaryText.length}-character summary.`);
    }

    const briefing = buildBriefingCard({
        overview,
        meta: request,
        points: itemCount,
        summaryText
    });
    timestampsList.insertBefore(briefing, timestampsList.firstChild);

    panelContent.appendChild(timestampsList);
    panel.appendChild(panelContent);
    container.appendChild(panel);

    // Needs the panel in the document: until then the overview has no layout to
    // overflow, and the toggle would be offered for text that already fits.
    revealGistToggle(briefing);

    _lastAppliedHeight = 0;
    applyPlayerHeight();
    observePlayerResize();

    // Follow the playhead. Needs the panel measured and in the document: the
    // dock hangs off the header's height, and deciding whether the current row
    // is on screen means reading real rectangles.
    startPlaybackTracking(playbackPoints, panel, panelContent);

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
        // A collapsed panel is only its header; the dock has nothing to point at.
        syncPlaybackDock();
    });
}

// Export functions for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    injectSidebar,
    renderTimestampsUI,
    updateGenerateButton,
    noteAnalysisProgress
  };
}