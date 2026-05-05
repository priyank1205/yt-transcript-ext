// scripts/ui-builder.js

// Player height tracking
let _resizeHandler = null;
let _resizeTimer = null;
let _lastAppliedHeight = 0;
const ACCORDION_OFFSET = 50;

// Summary cache: stores generated summaries keyed by video ID
const _summaryCache = {};

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
    const panel = document.querySelector('.yt-timestamps-panel');
    if (!panel) { console.log('[YT-Ext] no panel found'); return; }

    const header = panel.querySelector('.yt-timestamps-panel-header');
    const headerH = header ? header.offsetHeight : 45;

    if (!player) {
        console.log('[YT-Ext] no player found, using fallback');
        const fallback = 550;
        if (_lastAppliedHeight === fallback) return;
        _lastAppliedHeight = fallback;
        panel.style.maxHeight = `${fallback}px`;
        const body = panel.querySelector('.yt-accordion-body');
        if (body) body.style.maxHeight = '500px';
        return;
    }

    const playerH = player.getBoundingClientRect().height;
    console.log('[YT-Ext] playerH:', playerH, 'lastApplied:', _lastAppliedHeight);
    if (playerH <= 0) {
        const fallback = 550;
        if (_lastAppliedHeight === fallback) return;
        _lastAppliedHeight = fallback;
        panel.style.maxHeight = `${fallback}px`;
        const body = panel.querySelector('.yt-accordion-body');
        if (body) body.style.maxHeight = '500px';
        return;
    }

    const accordionMaxH = playerH + ACCORDION_OFFSET;
    console.log('[YT-Ext] accordionMaxH:', accordionMaxH, 'vs last:', _lastAppliedHeight, 'skip:', _lastAppliedHeight === accordionMaxH);
    if (_lastAppliedHeight === accordionMaxH) return;
    _lastAppliedHeight = accordionMaxH;

    panel.style.maxHeight = `${headerH + accordionMaxH}px`;
    const body = panel.querySelector('.yt-accordion-body');
    if (body) body.style.maxHeight = `${accordionMaxH}px`;
    console.log('[YT-Ext] applied panel:', headerH + accordionMaxH, 'body:', accordionMaxH);
}

function observePlayerResize() {
    disconnectPlayerObserver();
    _resizeHandler = () => {
        clearTimeout(_resizeTimer);
        _resizeTimer = setTimeout(() => {
            const player = findVideoPlayer();
            console.log('[YT-Ext] resize fired, player:', player?.tagName, 'height:', player?.getBoundingClientRect().height);
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

// Function to inject sidebar into the DOM
function injectSidebar(secondary) {
    if (document.querySelector('.yt-timestamps-container')) return;

    // Create container element
    const container = document.createElement('div');
    container.className = 'yt-timestamps-container';
    
    // Create panel element
    const panel = document.createElement('div');
    panel.className = 'yt-timestamps-panel';

    // Create panel header element
    const panelHeader = document.createElement('div');
    panelHeader.className = 'yt-timestamps-panel-header';
    
    // Create left group (title + model selector)
    const headerLeft = document.createElement('div');
    headerLeft.className = 'yt-timestamps-header-left';
    
    // Create header title element
    const headerTitle = document.createElement('h3');
    headerTitle.className = 'yt-timestamps-panel-header-title';
    headerTitle.textContent = 'Timestamped Summary';
    
    // Create model selection dropdown
    const headerModelSelect = document.createElement('select');
    headerModelSelect.id = 'header-model-select';
    headerModelSelect.className = 'yt-timestamps-model-select';
    
    const autoOption = document.createElement('option');
    autoOption.value = 'auto';
    autoOption.textContent = 'Auto';
    
    const geminiOption = document.createElement('option');
    geminiOption.value = 'gemini';
    geminiOption.textContent = 'Gemini';
    
    const mistralOption = document.createElement('option');
    mistralOption.value = 'mistral';
    mistralOption.textContent = 'Mistral';
    
    headerModelSelect.appendChild(autoOption);
    headerModelSelect.appendChild(geminiOption);
    headerModelSelect.appendChild(mistralOption);
    
    // Create gear icon element
    const gearIcon = document.createElement('span');
    gearIcon.className = 'gear-icon';
    gearIcon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 1 1 1.51 1.65 1.65 0 0 0 1.82.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
    gearIcon.onclick = () => {
        chrome.runtime.sendMessage({ action: "OPEN_OPTIONS" });
    };
    
    // Append elements
    headerLeft.appendChild(headerTitle);
    headerLeft.appendChild(headerModelSelect);
    panelHeader.appendChild(headerLeft);
    panelHeader.appendChild(gearIcon);
    panel.appendChild(panelHeader);
    
    // Add event listener to header model selection
    headerModelSelect.addEventListener('change', (e) => {
        const selectedModel = e.target.value;
        chrome.storage.local.set({ SELECTED_MODEL: selectedModel });
    });
    
    // Set default selection and disable unavailable models
    updateModelDropdown(headerModelSelect);
    
    // Create panel body (empty state before generation)
    const panelBody = document.createElement('div');
    panelBody.className = 'yt-timestamps-panel-body';
    
    const emptyState = document.createElement('div');
    emptyState.className = 'yt-timestamps-empty-state';
    emptyState.innerHTML = `
        <div class="yt-empty-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
            </svg>
        </div>
        <div class="yt-empty-text">Generate an AI-powered summary with timestamps</div>
    `;
    panelBody.appendChild(emptyState);
    
    // Create action area element
    const actionArea = document.createElement('div');
    actionArea.id = 'action-area';
    actionArea.className = 'yt-timestamps-action-area';
    
    // Create generate button element
    const genBtn = document.createElement('button');
    genBtn.textContent = 'Generate summary';
    genBtn.className = 'yt-timestamps-generate-button';
    genBtn.onclick = () => {
        console.log('Generate button clicked');
        updateGenerateButton('extracting');
        
        const headerModelSelect = document.getElementById('header-model-select');
        const selectedModel = headerModelSelect ? headerModelSelect.value : 'auto';
        
        // Send analysis request with timeout
        const sendAnalysis = (model, timeout = 120000) => {
            return new Promise((resolve) => {
                console.log(`Prompt sent to ${model}`);
                let resolved = false;
                
                const timer = setTimeout(() => {
                    if (!resolved) {
                        console.log(`Request to ${model} timed out`);
                        resolved = true;
                        resolve({ success: false, error: `Request timed out` });
                    }
                }, timeout);
                
                chrome.runtime.sendMessage({ action: "START_GEMINI_ANALYSIS", model: model }, (res) => {
                    if (!resolved) {
                        resolved = true;
                        clearTimeout(timer);
                        console.log(`Response received:`, res);
                        if (chrome.runtime.lastError) {
                            console.warn(`Error:`, chrome.runtime.lastError.message);
                            resolve({ success: false, error: chrome.runtime.lastError.message });
                        } else {
                            resolve(res || { success: false, error: 'No response from background' });
                        }
                    }
                });
            });
        };
        
        // Main execution
        (async () => {
            try {
                const result = await sendAnalysis(selectedModel);
                
                if (result && result.success) {
                    console.log(`Summary received via ${result.model || selectedModel}`);
                    updateGenerateButton('done');
                } else {
                    console.log(`Error: ${result?.error || 'Unknown'}`);
                    updateGenerateButton('error', result?.error || 'Unknown error', result?.keepOpen);
                }
            } catch (e) {
                console.warn('Extension context invalidated:', e);
                updateGenerateButton('error', 'Extension context invalidated');
            }
        })();
    };
    
    // Append elements to action area
    actionArea.appendChild(genBtn);
    panelBody.appendChild(actionArea);
    panel.appendChild(panelBody);
    
    // Append panel to container
    container.appendChild(panel);
    
    // Insert container into secondary
    secondary.insertBefore(container, secondary.firstChild);

    // Apply initial height and observe player for resizes (must be after DOM insertion)
    applyPlayerHeight();
    observePlayerResize();
    // Re-apply after a short delay to catch late layout shifts
    setTimeout(applyPlayerHeight, 500);

    // Restore cached summary if available (e.g. after miniplayer toggle)
    const cachedSummary = getCachedSummary(getCurrentVideoId());
    if (cachedSummary) {
        renderTimestampsUI(cachedSummary);
    }
}

// Function to update model dropdown: disable options for missing/invalid keys, add tooltips
function updateModelDropdown(selectEl) {
    if (!selectEl) return;
    chrome.storage.local.get(['GEMINI_API_KEY', 'MISTRAL_API_KEY', 'SELECTED_MODEL'], (result) => {
        const geminiOption = selectEl.querySelector('option[value="gemini"]');
        const mistralOption = selectEl.querySelector('option[value="mistral"]');
        const autoOption = selectEl.querySelector('option[value="auto"]');

        if (geminiOption) {
            if (!result.GEMINI_API_KEY) {
                geminiOption.disabled = true;
                geminiOption.title = 'No Gemini API key set — add one in settings';
            } else {
                geminiOption.disabled = false;
                geminiOption.title = '';
            }
        }

        if (mistralOption) {
            if (!result.MISTRAL_API_KEY) {
                mistralOption.disabled = true;
                mistralOption.title = 'No Mistral API key set — add one in settings';
            } else {
                mistralOption.disabled = false;
                mistralOption.title = '';
            }
        }

        if (autoOption) {
            autoOption.disabled = false;
            autoOption.title = '';
        }

        // Resolve selected model
        let defaultModel = result.SELECTED_MODEL || 'auto';
        const selectedOption = selectEl.querySelector(`option[value="${defaultModel}"]`);
        if (selectedOption && selectedOption.disabled) {
            defaultModel = 'auto';
        }
        selectEl.value = defaultModel;
    });
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
    
    // Clear existing content
    container.innerHTML = '';
    container.classList.add('yt-has-summary');
    
    // Create panel elements
    const panel = document.createElement('div');
    panel.className = 'yt-timestamps-panel';
    
    const panelHeader = document.createElement('div');
    panelHeader.className = 'yt-timestamps-panel-header';
    panelHeader.style.cursor = 'pointer';
    
    const headerTitle = document.createElement('h3');
    headerTitle.className = 'yt-timestamps-panel-header-title';
    headerTitle.textContent = 'Timestamped Summary';
    
    const toggleIcon = document.createElement('span');
    toggleIcon.className = 'yt-accordion-toggle-icon';
    toggleIcon.textContent = '›';
    
    panelHeader.appendChild(headerTitle);
    panelHeader.appendChild(toggleIcon);
    panel.appendChild(panelHeader);
    
    // Create panel content (accordion body)
    const panelContent = document.createElement('div');
    panelContent.className = 'yt-timestamps-panel-content yt-accordion-body';
    
    const timestampsList = document.createElement('div');
    timestampsList.className = 'yt-timestamps-list';
    
    // Process summary text
    const lines = summaryText.split('\n').map(l => l.trim()).filter(Boolean);
    
    lines.forEach(line => {
        const cleanLine = line.replace(/```/g, '').trim();
        if (cleanLine.startsWith('#')) {
            const sectionHeader = document.createElement('div');
            sectionHeader.className = 'yt-section-header';
            sectionHeader.textContent = cleanLine.substring(1).trim();
            timestampsList.appendChild(sectionHeader);
            return;
        }
        
        const timeMatch = cleanLine.match(/^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*-\s*(.+?):\s*(.+)$/);
        if (timeMatch) {
            const time = timeMatch[1];
            const title = timeMatch[2];
            const description = timeMatch[3]; 
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
                isExpanded = !isExpanded;
                expandBtn.textContent = isExpanded ? '−' : '+';
                if (isExpanded) {
                    accordionContent.classList.add('expanded');
                } else {
                    accordionContent.classList.remove('expanded');
                }
            };
            
            tsDiv.onmouseover = () => { tsDiv.style.background = '#262626'; glowBorder.style.opacity = '1'; };
            tsDiv.onmouseout = () => { tsDiv.style.background = '#1a1a1a'; glowBorder.style.opacity = '0'; };
            tsDiv.onclick = () => {
                const video = document.querySelector('video');
                if (video) video.currentTime = sec;
            };
            
            timestampsList.appendChild(tsDiv);
            timestampsList.appendChild(accordionContent);
        }
    });
    
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