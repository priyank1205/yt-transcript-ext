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

// --- Panel skin (classic / quiet) ------------------------------------------
// Design-direction toggle: the redesigned "Quiet" skin (styles/skin-quiet.css)
// is opt-in via the PANEL_SKIN preference while it's being evaluated. 'classic'
// (no class) stays the shipping default; 'quiet' adds `yt-skin-quiet` to the
// container, which the skin stylesheet scopes every override under.
let _skinPref = 'classic';

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
        renderTimestampsUI(cached);
    } else if (!container.classList.contains('yt-has-summary')) {
        renderEmptyState(container);
    }
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

    // Cap the accordion height based on the player height so it doesn't run off-screen
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
    let index = DETAIL_DEFAULT_INDEX;
    // Start from the default; the stored default (if any) is applied once the
    // async storage read below resolves.
    _pendingDetail = DETAIL_OPTIONS[DETAIL_DEFAULT_INDEX].value;
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

    // Sync to the stored default (whatever the user last generated with) once
    // storage resolves. This only updates the in-memory selection/display.
    if (chrome?.storage?.local) {
        chrome.storage.local.get(['SUMMARY_LENGTH'], (res) => {
            const stored = DETAIL_OPTIONS.findIndex((o) => o.value === res.SUMMARY_LENGTH);
            if (stored !== -1) select(stored);
        });
    }

    return wrap;
}

// Build the static "Detail" badge for the generated-summary header: a read-only
// pill that just reports which level produced the current summary. No popover —
// changing the level happens in the empty state (via Reset).
function buildDetailBadge() {
    const wrap = document.createElement('div');
    wrap.className = 'yt-detail-chip-wrap';

    const badge = document.createElement('span');
    badge.className = 'yt-detail-chip yt-detail-chip-static';
    badge.title = 'Detail level used for this summary';
    badge.textContent = DETAIL_OPTIONS[DETAIL_DEFAULT_INDEX].label;
    wrap.appendChild(badge);

    chrome.storage.local.get(['SUMMARY_LENGTH'], (res) => {
        const opt = DETAIL_OPTIONS.find((o) => o.value === res.SUMMARY_LENGTH);
        if (opt) badge.textContent = opt.label;
    });

    return wrap;
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
            <div class="yt-empty-text">Chapters with AI summaries, linked to the video</div>
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

    // Load the theme + skin preferences and keep the panel in sync with live
    // YouTube theme toggles (when following the system). The skin affects the
    // markup built above (ghost preview, Detail slider variant), so if the
    // stored skin differs from the one this render assumed, rebuild once with
    // the right one — the re-entrant call sees the matching pref and settles.
    const renderedSkin = _skinPref;
    chrome.storage.local.get(['THEME_PREF', 'PANEL_SKIN'], (res) => {
        _themePref = res.THEME_PREF || 'system';
        applyPanelTheme(_themePref, container);
        _skinPref = res.PANEL_SKIN || 'quiet';
        applyPanelSkin(_skinPref, container);
        if (_skinPref !== renderedSkin) {
            renderEmptyState(container);
        }
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
    // Apply the theme up-front (follows YouTube by default) to avoid a flash.
    // The skin uses the in-memory pref so SPA re-injects don't flash Classic
    // while the async storage read in renderEmptyState resolves.
    applyPanelTheme('system', container);
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
    // page); length is the "Detail" preset currently selected in the panel chip.
    const sendAnalysis = (model, length, timeout = 120000) => {
        return new Promise((resolve) => {
            let resolved = false;

            const timer = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    resolve({ success: false, error: `Request timed out` });
                }
            }, timeout);

            chrome.runtime.sendMessage({ action: "START_ANALYSIS", model: model, length: length }, (res) => {
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
            // Use the level selected in the chip; fall back to the stored default.
            const length = _pendingDetail || prefs.SUMMARY_LENGTH || 'standard';
            // Generating commits this level as the new sticky default, so the next
            // video (and this summary's header badge) opens on it.
            chrome.storage.local.set({ SUMMARY_LENGTH: length });

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
    chrome.storage.local.get(null, (res) => {
        const hasKey = Object.keys(res).some(key => key.endsWith('_API_KEY') && !!res[key]);
        const emptyText = document.querySelector('.yt-empty-text');
        if (hasKey) {
            genBtn.textContent = 'Generate summary';
            genBtn.classList.remove('yt-needs-keys');
            genBtn.onclick = runAnalysis;
            if (emptyText) emptyText.textContent = _skinPref === 'quiet'
                ? 'Chapters with AI summaries, linked to the video'
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
    if (genBtn.disabled || genBtn.classList.contains('yt-error-state')) return;
    setGenerateButtonMode(genBtn);
}

// Function to update the generate button state
let _buttonResetTimeout = null;
let _sweepTimeout = null;
function updateGenerateButton(phase, message, keepOpen) {
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
            if (panel) panel.classList.add('yt-generating');
            break;
        case 'calling_api':
            genBtn.disabled = true;
            genBtn.classList.remove('yt-error-state');
            genBtn.innerHTML = '<span class="yt-spinner"></span>Generating summary...';
            if (panel) panel.classList.add('yt-generating');
            break;
        case 'error':
            genBtn.classList.add('yt-error-state');
            genBtn.innerHTML = message || 'Something went wrong';
            if (panel) panel.classList.remove('yt-generating');
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
    headerLeft.appendChild(buildDetailBadge());
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
    // Render order index, set as a CSS custom property on each section header
    // and row. Classic ignores it; the Quiet skin uses it to stagger the
    // entrance cascade when a summary first renders.
    let orderIndex = 0;

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
            timeLabel.innerHTML = `<span class="yt-time"><span class="yt-time-text">${time}</span></span> <span class="yt-title">${title}</span>`;
            attachTitleTooltip(timeLabel.querySelector('.yt-title'));
            
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