// scripts/dom-observer.js

// Function to observe DOM changes using MutationObserver
function observeDOM() {
    const secondary = document.querySelector('ytd-watch-flexy #secondary');
    if (secondary) {
        injectSidebar(secondary);
        return;
    }
    
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === 1 && node.querySelector && node.querySelector('ytd-watch-flexy #secondary')) {
                    const secondary = node.querySelector('ytd-watch-flexy #secondary');
                    if (secondary) {
                        injectSidebar(secondary);
                        observer.disconnect();
                    }
                }
            });
        });
    });
    
    observer.observe(document.body, { childList: true, subtree: true });
}

// Function to inject sidebar with model selection
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
    headerTitle.textContent = 'Gemini Summary';
    
    // Create gear icon element
    const gearIcon = document.createElement('span');
    gearIcon.className = 'gear-icon';
    gearIcon.textContent = '⚙️';
    gearIcon.onclick = toggleSettings;
    
    // Append elements to panel header
    panelHeader.appendChild(headerTitle);
    panelHeader.appendChild(gearIcon);
    panel.appendChild(panelHeader);
    
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
    
    const geminiOption = document.createElement('option');
    geminiOption.value = 'gemini';
    geminiOption.textContent = 'Gemini';
    
    const mistralOption = document.createElement('option');
    mistralOption.value = 'mistral';
    mistralOption.textContent = 'Mistral';
    
    modelSelect.appendChild(geminiOption);
    modelSelect.appendChild(mistralOption);
    
    // Set the selected model from storage
    chrome.storage.local.get(['SELECTED_MODEL'], (result) => {
        if (result.SELECTED_MODEL) {
            modelSelect.value = result.SELECTED_MODEL;
            // Show/hide API key fields based on selection
            if (result.SELECTED_MODEL === 'gemini') {
                document.getElementById('gemini-api-key-input').style.display = 'block';
                document.getElementById('mistral-api-key-input').style.display = 'none';
            } else {
                document.getElementById('gemini-api-key-input').style.display = 'none';
                document.getElementById('mistral-api-key-input').style.display = 'block';
            }
        }
    });
    
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
        
        // Update the current model
        updateCurrentModel(selectedModel);
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
    
    // Append settings panel to panel
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
            const selectedModel = modelSelect.value;
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