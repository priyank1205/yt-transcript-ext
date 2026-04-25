const STYLE_CSS = `
  @keyframes gradientFlash{0%{background:linear-gradient(90deg,transparent 0%,transparent 40%,transparent 100%);box-shadow:0 4px 16px rgba(255,0,0,0.1)}25%{background:linear-gradient(90deg,transparent 0%,rgba(255,0,0,0.4) 50%,transparent 100%);box-shadow:0 4px 20px rgba(255,0,0,0.5)}50%{background:linear-gradient(90deg,transparent 0%,rgba(255,0,0,0.6) 50%,transparent 100%);box-shadow:0 4px 24px rgba(255,0,0,0.7)}75%{background:linear-gradient(90deg,transparent 0%,rgba(255,0,0,0.3) 50%,transparent 100%);box-shadow:0 4px 20px rgba(255,0,0,0.4)}100%{background:#1a1a1a;box-shadow:none}}
  .yt-section-header{font-size:12px;font-weight:700;color:#FFFFFF;opacity:0.5;text-transform:uppercase;letter-spacing:0.5px;padding:8px 0;border-bottom:1px solid #333;margin-top:12px;margin-bottom:8px}
  .yt-accordion-content{max-height:0;overflow:hidden;transition:max-height 0.3s cubic-bezier(0.4,0,0.2,1);background:#262626;border:1px solid #333;border-top:none;border-radius:0 0 6px 6px;padding:0;font-size:14px;color:#c4bebe;line-height:1.6;margin-bottom:6px;opacity:0;transition:max-height 0.3s cubic-bezier(0.4,0,0.2,1), opacity 0.3s cubic-bezier(0.4,0,0.2,1), padding 0.3s cubic-bezier(0.4,0,0.2,1)}
  .yt-accordion-content.expanded{max-height:500px;opacity:1;padding:12px 14px}
  .yt-gradient-flash{animation:gradientFlash 0.8s cubic-bezier(0.34,1.56,0.64,1)}
  .yt-timestamp-settings-panel{position:absolute;top:40px;right:0;background:#1a1a1a;border:1px solid #333;padding:10px;border-radius:6px;z-index:999;display:none}
`;

// Initialize
window.addEventListener('yt-navigate-finish', initSidebar);
initSidebar();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "GET_TRANSCRIPT") {
        extractTranscript().then(sendResponse);
        return true;
    } else if (request.action === "RENDER_TIMESTAMPS") {
        renderTimestamps(request.data);
        sendResponse({ success: true });
        return true;
    }
});

function ensureStyles() {
    if (!document.getElementById('yt-timestamp-styles')) {
        const style = document.createElement('style');
        style.id = 'yt-timestamp-styles';
        style.textContent = STYLE_CSS;
        document.head.appendChild(style);
    }
}

function initSidebar() {
    ensureStyles();
    const observer = new MutationObserver((mutations, obs) => {
        const secondary = document.querySelector('ytd-watch-flexy #secondary');
        if (secondary) {
            injectSidebar(secondary);
            obs.disconnect();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

function injectSidebar(secondary) {
    if (document.querySelector('.yt-timestamps-container')) return;

    const container = document.createElement('div');
    container.className = 'yt-timestamps-container';
    container.style.cssText = `margin-bottom:16px;padding:0`;
    secondary.insertBefore(container, secondary.firstChild);

    const panel = document.createElement('div');
    panel.style.cssText = `position:relative;background:#0d0d0d;border:1px solid #333;border-radius:10px;padding:0;box-shadow:0 4px 12px rgba(0,0,0,0.7)`;

    const panelHeader = document.createElement('div');
    panelHeader.style.cssText = `background:linear-gradient(135deg,#000 0%,#1a1a1a 100%);padding:14px 16px;border-bottom:2px solid #FF0000;display:flex;justify-content:space-between;align-items:center`;
    
    const headerTitle = document.createElement('h3');
    headerTitle.textContent = 'Gemini Summary';
    headerTitle.style.cssText = `margin:0;font-size:15px;font-weight:700;color:#fff`;
    
    const gearIcon = document.createElement('span');
    gearIcon.innerHTML = '⚙️';
    gearIcon.style.cssText = 'cursor:pointer;font-size:16px';
    gearIcon.onclick = toggleSettings;

    panelHeader.appendChild(headerTitle);
    panelHeader.appendChild(gearIcon);
    panel.appendChild(panelHeader);

    const settingsPanel = document.createElement('div');
    settingsPanel.className = 'yt-timestamp-settings-panel';
    settingsPanel.innerHTML = '<input type="text" id="api-key-input" placeholder="Enter Gemini API Key" style="width:100%;background:#000;color:#fff;border:1px solid #333;padding:5px;">';
    panel.appendChild(settingsPanel);
    
    const actionArea = document.createElement('div');
    actionArea.id = 'action-area';
    actionArea.style.padding = '14px';
    
    const genBtn = document.createElement('button');
    genBtn.textContent = 'Generate timestamped summary';
    genBtn.style.cssText = 'width:100%;padding:10px;background:#FF0000;color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:bold';
    genBtn.onclick = () => {
        genBtn.textContent = 'Analyzing...';
        chrome.runtime.sendMessage({ action: "START_GEMINI_ANALYSIS" }, (res) => {
            if(!res || !res.success) {
                genBtn.textContent = 'Error: ' + (res?.error || 'Unknown');
                setTimeout(() => genBtn.textContent = 'Generate timestamped summary', 3000);
            }
        });
    };
    actionArea.appendChild(genBtn);
    panel.appendChild(actionArea);

    container.appendChild(panel);
}

function toggleSettings() {
    const panel = document.querySelector('.yt-timestamp-settings-panel');
    panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
    
    const input = document.getElementById('api-key-input');
    chrome.storage.local.get(['GEMINI_API_KEY'], (res) => { input.value = res.GEMINI_API_KEY || '' });
    input.onchange = (e) => chrome.storage.local.set({ GEMINI_API_KEY: e.target.value });
}

async function renderTimestamps(summaryText) {
    const container = document.querySelector('.yt-timestamps-container');
    if (!container) return;
    container.innerHTML = ''; 

    const panel = document.createElement('div');
    panel.style.cssText = `position:relative;background:#0d0d0d;border:1px solid #333;border-radius:10px;padding:0;box-shadow:0 4px 12px rgba(0,0,0,0.7)`;

    const panelHeader = document.createElement('div');
    panelHeader.style.cssText = `background:linear-gradient(135deg,#000 0%,#1a1a1a 100%);padding:14px 16px;border-bottom:2px solid #FF0000;display:flex;justify-content:space-between;align-items:center`;
    panelHeader.innerHTML = '<h3 style="margin:0;font-size:15px;font-weight:700;color:#fff">Summary</h3>';
    panel.appendChild(panelHeader);
    
    const panelContent = document.createElement('div');
    panelContent.style.cssText = `padding:14px;max-height:500px;overflow-y:auto`;
    const timestampsList = document.createElement('div');
    timestampsList.style.cssText = `display:flex;flex-direction:column;gap:6px`;

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
            tsDiv.style.cssText = `padding:12px 14px;background:#1a1a1a;border:1px solid #333;border-radius:6px;cursor:pointer;font-size:13px;color:#e2e8f0;position:relative;display:flex;justify-content:space-between;align-items:center;transition:all 0.25s;margin-bottom:2px`;
            
            const glowBorder = document.createElement('div');
            glowBorder.style.cssText = `position:absolute;left:0;top:0;bottom:0;width:3px;background:linear-gradient(180deg,#FF0000 0%,#cc0000 100%);opacity:0;transition:opacity 0.25s`;
            tsDiv.appendChild(glowBorder);

            const timeLabel = document.createElement('span');
            timeLabel.style.cssText = `flex:1;z-index:1;position:relative`;
            timeLabel.innerHTML = \`<span style="color:#FF0000;margin-right:8px;font-weight:600">[\${time}]</span><span style="color:#e2e8f0">\${title}</span>\`;
            
            const expandBtn = document.createElement('span');
            expandBtn.textContent = '▼';
            expandBtn.style.cssText = \`color:#FF0000;font-size:10px;opacity:0.7;transform:rotate(-90deg);transition:all 0.3s;cursor:pointer;z-index:2;padding:12px;margin:-12px;display:flex;align-items:center;justify-content:center;min-width:34px;min-height:34px\`;

            tsDiv.appendChild(timeLabel);
            tsDiv.appendChild(expandBtn);

            const accordionContent = document.createElement('div');
            accordionContent.className = 'yt-accordion-content';
            accordionContent.textContent = description;

            let isExpanded = false;
            expandBtn.onclick = e => {
                e.stopPropagation();
                isExpanded = !isExpanded;
                accordionContent.classList.toggle('expanded', isExpanded);
                expandBtn.style.transform = isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)';
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

async function extractTranscript() {
  try {
    let transcriptBtn = findTranscriptButton();
    if (!transcriptBtn) {
      const expandBtn = document.querySelector('tp-yt-paper-button#expand, #expand-button');
      if (expandBtn) {
        expandBtn.click();
        await sleep(1000);
        transcriptBtn = findTranscriptButton();
      }
    }
    if (!transcriptBtn) return { success: false, error: "Transcript button not found." };
    transcriptBtn.click();
    await sleep(1000);
    const panel = document.querySelector('ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]');
    if (!panel) return { success: false, error: "Transcript panel container not found." };
    const originalVisibility = panel.getAttribute('visibility');
    panel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED');
    await sleep(1000);
    const segments = Array.from(document.querySelectorAll('ytd-transcript-segment-renderer'));
    if (originalVisibility) panel.setAttribute('visibility', originalVisibility); else panel.removeAttribute('visibility');
    if (segments.length === 0) return { success: false, error: "Panel opened but no segments found." };
    return extractFromSegments(segments);
  } catch (err) { return { success: false, error: "Extraction error: " + err.message }; }
}

function extractFromSegments(segments) {
    let output = "";
    segments.forEach(segment => {
      const timestamp = segment.querySelector('.segment-timestamp, #timestamp')?.textContent.trim();
      const text = segment.querySelector('.segment-text, #content')?.textContent.trim();
      if (timestamp && text) output += \`[\${timestamp}] \${text}\\n\`;
    });
    return { success: true, data: output };
}

function findTranscriptButton() {
  const allButtons = Array.from(document.querySelectorAll('button, ytd-button-renderer'));
  return allButtons.find(btn => btn.textContent.toLowerCase().includes('show transcript'));
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
