// scripts/ui-builder.js

// Function to inject sidebar into the DOM
function injectSidebar(secondary) {
    if (document.querySelector('.yt-timestamps-container')) return;

    // Create container element
    const container = document.createElement('div');
    container.className = 'yt-timestamps-container';
    
    // Create panel element
    const panel = document.createElement('div');
    panel.className = 'yt-timestamps-panel';
    
    // Set panel height to match YouTube player height
    const videoPlayer = document.querySelector('#player .html5-video-container') || 
                     document.querySelector('ytd-player') || 
                     document.querySelector('.html5-video-player');
    
    if (videoPlayer) {
        // Use a more reliable method to get the player height
        const playerHeight = videoPlayer.offsetHeight;
        if (playerHeight > 0) {
            panel.style.maxHeight = `${playerHeight}px`;
        } else {
            // Fallback to a reasonable default
            panel.style.maxHeight = '500px';
        }
    } else {
        // Fallback to a reasonable default
        panel.style.maxHeight = '500px';
    }

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
    gearIcon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
    gearIcon.onclick = toggleSettings;
    
    // Append elements
    headerLeft.appendChild(headerTitle);
    headerLeft.appendChild(headerModelSelect);
    panelHeader.appendChild(headerLeft);
    panelHeader.appendChild(gearIcon);
    panel.appendChild(panelHeader);
    
    // Add event listener to header model selection
    headerModelSelect.addEventListener('change', (e) => {
        const selectedModel = e.target.value;
        // Sync with settings model select
        const settingsModelSelect = document.getElementById('model-select');
        if (settingsModelSelect) {
            settingsModelSelect.value = selectedModel;
        }
        // Save selection
        chrome.storage.local.set({ SELECTED_MODEL: selectedModel });
    });
    
    // Set default selection based on saved API keys
    chrome.storage.local.get(['GEMINI_API_KEY', 'MISTRAL_API_KEY', 'SELECTED_MODEL'], (result) => {
        // Default to auto
        let defaultModel = 'auto';
        
        // If a specific model was previously saved, use it
        if (result.SELECTED_MODEL) {
            defaultModel = result.SELECTED_MODEL;
        }
        
        // Set the default model in both dropdowns
        headerModelSelect.value = defaultModel;
    });
    
    // Create settings panel element
    const settingsPanel = document.createElement('div');
    settingsPanel.className = 'yt-timestamp-settings-panel';
    
    // Create model selection dropdown
    const modelLabel = document.createElement('div');
    modelLabel.className = 'yt-timestamp-settings-label';
    modelLabel.textContent = 'Model';
    
    const modelSelect = document.createElement('select');
    modelSelect.id = 'model-select';
    modelSelect.className = 'yt-timestamp-settings-input';
    
    const geminiOptionSelect = document.createElement('option');
    geminiOptionSelect.value = 'gemini';
    geminiOptionSelect.textContent = 'Gemini';
    
    const mistralOptionSelect = document.createElement('option');
    mistralOptionSelect.value = 'mistral';
    mistralOptionSelect.textContent = 'Mistral';
    
    modelSelect.appendChild(geminiOptionSelect);
    modelSelect.appendChild(mistralOptionSelect);
    
    // Create API key fields
    const geminiKeyLabel = document.createElement('div');
    geminiKeyLabel.className = 'yt-timestamp-settings-label';
    geminiKeyLabel.textContent = 'Gemini API Key';
    
    const geminiKeyInput = document.createElement('input');
    geminiKeyInput.type = 'text';
    geminiKeyInput.id = 'gemini-api-key-input';
    geminiKeyInput.placeholder = 'Enter Gemini API Key';
    geminiKeyInput.className = 'yt-timestamp-settings-input';
    
    const mistralKeyLabel = document.createElement('div');
    mistralKeyLabel.className = 'yt-timestamp-settings-label';
    mistralKeyLabel.textContent = 'Mistral API Key';
    mistralKeyLabel.style.display = 'none';
    
    const mistralKeyInput = document.createElement('input');
    mistralKeyInput.type = 'text';
    mistralKeyInput.id = 'mistral-api-key-input';
    mistralKeyInput.placeholder = 'Enter Mistral API Key';
    mistralKeyInput.className = 'yt-timestamp-settings-input';
    mistralKeyInput.style.display = 'none';
    
    // Add event listener to model selection
    modelSelect.addEventListener('change', (e) => {
        const selectedModel = e.target.value;
        
        // Show/hide API key fields based on selection
        if (selectedModel === 'gemini') {
            geminiKeyLabel.style.display = 'block';
            geminiKeyInput.style.display = 'block';
            mistralKeyLabel.style.display = 'none';
            mistralKeyInput.style.display = 'none';
        } else {
            geminiKeyLabel.style.display = 'none';
            geminiKeyInput.style.display = 'none';
            mistralKeyLabel.style.display = 'block';
            mistralKeyInput.style.display = 'block';
        }
        
        // Sync with header model select
        const headerModelSelectElement = document.getElementById('header-model-select');
        if (headerModelSelectElement) {
            headerModelSelectElement.value = selectedModel;
        }
        
        // Save selection
        chrome.storage.local.set({ SELECTED_MODEL: selectedModel });
    });
    
    // Create save button
    const saveBtn = document.createElement('button');
    saveBtn.id = 'save-key-btn';
    saveBtn.textContent = 'Save';
    saveBtn.className = 'yt-timestamp-settings-button';
    saveBtn.disabled = true;
    
    // Add input event listeners
    geminiKeyInput.addEventListener('input', () => {
        const hasValue = geminiKeyInput.value.trim().length > 0;
        saveBtn.disabled = !hasValue;
    });
    
    mistralKeyInput.addEventListener('input', () => {
        const hasValue = mistralKeyInput.value.trim().length > 0;
        saveBtn.disabled = !hasValue;
    });
    
    // Add save button event listener
    saveBtn.onclick = () => {
        try {
            const selectedModel = modelSelect.value;
            const storageKey = `${selectedModel.toUpperCase()}_API_KEY`;
            const inputId = `${selectedModel}-api-key-input`;
            const apiKey = document.getElementById(inputId).value;
            
            chrome.storage.local.set({ [storageKey]: apiKey }, () => {
                if (chrome.runtime.lastError) {
                    console.error('Error saving API key:', chrome.runtime.lastError);
                    return;
                }
                saveBtn.textContent = 'Saved!';
                setTimeout(() => {
                    saveBtn.textContent = 'Save';
                    toggleSettings(); // Close panel after saving
                }, 1000);
            });
        } catch (e) {
            console.error('Extension context invalidated:', e);
        }
    };
    
    // Append elements to settings panel
    settingsPanel.appendChild(modelLabel);
    settingsPanel.appendChild(modelSelect);
    settingsPanel.appendChild(geminiKeyLabel);
    settingsPanel.appendChild(geminiKeyInput);
    settingsPanel.appendChild(mistralKeyLabel);
    settingsPanel.appendChild(mistralKeyInput);
    settingsPanel.appendChild(saveBtn);
    
    panel.appendChild(settingsPanel);
    
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
        // Close settings panel if open
        const settingsPanel = document.querySelector('.yt-timestamp-settings-panel');
        if (settingsPanel && settingsPanel.style.display === 'block') {
            settingsPanel.style.display = 'none';
        }
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
                            console.error(`Error:`, chrome.runtime.lastError.message);
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
                    updateGenerateButton('error', result?.error || 'Unknown error');
                }
            } catch (e) {
                console.error('Extension context invalidated:', e);
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
}

// Function to update the generate button state
let _buttonResetTimeout = null;
function updateGenerateButton(phase, message) {
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
            genBtn.disabled = false;
            _buttonResetTimeout = setTimeout(resetButton, 3000);
            break;
        case 'done':
            resetButton();
            break;
    }
}

// Function to toggle settings panel visibility
function toggleSettings() {
    const settingsPanel = document.querySelector('.yt-timestamp-settings-panel');
    if (settingsPanel) {
        const isVisible = settingsPanel.style.display === 'block';
        settingsPanel.style.display = isVisible ? 'none' : 'block';
    }
}

// Function to render timestamps UI from processed data
function renderTimestampsUI(summaryText) {
    // This function will build the UI for timestamps
    const container = document.querySelector('.yt-timestamps-container');
    if (!container) return;
    
    // Clear existing content
    container.innerHTML = '';
    
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
    toggleSettings,
    renderTimestampsUI,
    updateGenerateButton
  };
}