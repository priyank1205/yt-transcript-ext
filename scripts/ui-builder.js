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
    
    // Create header title element
    const headerTitle = document.createElement('h3');
    headerTitle.className = 'yt-timestamps-panel-header-title';
    headerTitle.textContent = 'Summary';
    
    // Create model selection dropdown
    const headerModelSelect = document.createElement('select');
    headerModelSelect.id = 'header-model-select';
    headerModelSelect.className = 'yt-timestamps-model-select';
    
    const geminiOption = document.createElement('option');
    geminiOption.value = 'gemini';
    geminiOption.textContent = 'Gemini';
    
    const mistralOption = document.createElement('option');
    mistralOption.value = 'mistral';
    mistralOption.textContent = 'Mistral';
    
    headerModelSelect.appendChild(geminiOption);
    headerModelSelect.appendChild(mistralOption);
    
    // Create gear icon element
    const gearIcon = document.createElement('span');
    gearIcon.className = 'gear-icon';
    gearIcon.textContent = '⚙️';
    gearIcon.onclick = toggleSettings;
    
    // Append elements to panel header
    panelHeader.appendChild(headerTitle);
    panelHeader.appendChild(headerModelSelect);
    panelHeader.appendChild(gearIcon);
    panel.appendChild(panelHeader);
    
    // Add event listener to header model selection
    headerModelSelect.addEventListener('change', (e) => {
        const selectedModel = e.target.value;
        // Update header title based on selected model
        headerTitle.textContent = `${selectedModel.charAt(0).toUpperCase() + selectedModel.slice(1)} Summary`;
    });
    
    // Set default selection based on saved API keys
    chrome.storage.local.get(['GEMINI_API_KEY', 'MISTRAL_API_KEY', 'SELECTED_MODEL'], (result) => {
        // Default to Gemini if no model is selected
        let defaultModel = 'gemini';
        
        // Check if we have saved API keys
        const hasGeminiKey = !!result.GEMINI_API_KEY;
        const hasMistralKey = !!result.MISTRAL_API_KEY;
        
        // Default selection logic:
        // 1. If only one model has a saved API key, select that model
        // 2. If both models have saved API keys, select Gemini by default
        // 3. If neither has a saved API key, default to Gemini
        if (hasGeminiKey && !hasMistralKey) {
            defaultModel = 'gemini';
        } else if (!hasGeminiKey && hasMistralKey) {
            defaultModel = 'mistral';
        } else if (hasGeminiKey && hasMistralKey) {
            defaultModel = 'gemini'; // Both have keys, default to Gemini
        } else if (!hasGeminiKey && !hasMistralKey) {
            defaultModel = 'gemini'; // Neither has keys, default to Gemini
        }
        
        // Set the default model in both dropdowns
        headerModelSelect.value = defaultModel;
        headerTitle.textContent = `${defaultModel.charAt(0).toUpperCase() + defaultModel.slice(1)} Summary`;
        
        // Add tooltip functionality for missing API keys
        if (!hasGeminiKey) {
            const geminiOptionElement = headerModelSelect.querySelector('option[value="gemini"]');
            if (geminiOptionElement) {
                geminiOptionElement.title = "API key required";
            }
        }
        if (!hasMistralKey) {
            const mistralOptionElement = headerModelSelect.querySelector('option[value="mistral"]');
            if (mistralOptionElement) {
                mistralOptionElement.title = "API key required";
            }
        }
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
        genBtn.textContent = 'Analyzing...';
        try {
            const headerModelSelect = document.getElementById('header-model-select');
            const selectedModel = headerModelSelect ? headerModelSelect.value : 'gemini';
            console.log(`Prompt sent to ${selectedModel}`);
            chrome.runtime.sendMessage({ action: "START_GEMINI_ANALYSIS", model: selectedModel }, (res) => {
                if (chrome.runtime.lastError) {
                    console.error('Extension context error:', chrome.runtime.lastError);
                    genBtn.textContent = 'Error: Context invalidated';
                    setTimeout(() => genBtn.textContent = 'Generate summary', 3000);
                    return;
                }
                if (!res || !res.success) {
                    console.log(`Error occurred: ${res?.error || 'Unknown'}`);
                    genBtn.textContent = 'Error: ' + (res?.error || 'Unknown');
                    setTimeout(() => genBtn.textContent = 'Generate summary', 3000);
                } else {
                    console.log(`Summary received from ${selectedModel}`);
                }
            });
        } catch (e) {
            console.error('Extension context invalidated:', e);
            genBtn.textContent = 'Error: Extension context invalidated';
            setTimeout(() => genBtn.textContent = 'Generate summary', 3000);
        }
    };
    
    // Append elements to action area
    actionArea.appendChild(genBtn);
    panel.appendChild(actionArea);
    
    // Append panel to container
    container.appendChild(panel);
    
    // Insert container into secondary
    secondary.insertBefore(container, secondary.firstChild);
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
    
    const headerTitle = document.createElement('h3');
    headerTitle.className = 'yt-timestamps-panel-header-title';
    headerTitle.textContent = 'Summary';
    panelHeader.appendChild(headerTitle);
    
    panel.appendChild(panelHeader);
    container.appendChild(panel);
    
    // Create panel content
    const panelContent = document.createElement('div');
    panelContent.className = 'yt-timestamps-panel-content';
    
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
            expandBtn.textContent = '▼';
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
                if (isExpanded) {
                    accordionContent.classList.add('expanded');
                    expandBtn.style.transform = 'rotate(180deg)';
                } else {
                    accordionContent.classList.remove('expanded');
                    expandBtn.style.transform = 'rotate(0deg)';
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
}

// Export functions for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    injectSidebar,
    toggleSettings,
    renderTimestampsUI
  };
}