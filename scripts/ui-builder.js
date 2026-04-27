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
    
    // Create settings panel content
    const label = document.createElement('div');
    label.className = 'yt-timestamp-settings-label';
    label.textContent = 'Gemini API Key';
    
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'api-key-input';
    input.placeholder = 'Enter API Key';
    input.className = 'yt-timestamp-settings-input';
    
    const saveBtn = document.createElement('button');
    saveBtn.id = 'save-key-btn';
    saveBtn.textContent = 'Save';
    saveBtn.className = 'yt-timestamp-settings-button';
    saveBtn.disabled = true;
    
    // Append elements to settings panel
    settingsPanel.appendChild(label);
    settingsPanel.appendChild(input);
    settingsPanel.appendChild(saveBtn);
    
    // Add input event listener
    input.addEventListener('input', () => {
        const hasValue = input.value.trim().length > 0;
        saveBtn.disabled = !hasValue;
        // Use CSS for disabled state instead of inline styles
    });
    
// Add save button event listener
    saveBtn.onclick = () => {
        try {
            chrome.storage.local.set({ GEMINI_API_KEY: input.value }, () => {
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
        genBtn.textContent = 'Analyzing...';
        try {
            chrome.runtime.sendMessage({ action: "START_GEMINI_ANALYSIS" }, (res) => {
                if (chrome.runtime.lastError) {
                    console.error('Extension context error:', chrome.runtime.lastError);
                    genBtn.textContent = 'Error: Context invalidated';
                    setTimeout(() => genBtn.textContent = 'Generate summary', 3000);
                    return;
                }
                if (!res || !res.success) {
                    genBtn.textContent = 'Error: ' + (res?.error || 'Unknown');
                    setTimeout(() => genBtn.textContent = 'Generate summary', 3000);
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