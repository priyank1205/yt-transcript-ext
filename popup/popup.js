document.getElementById('fetchBtn').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const status = document.getElementById('status');
  const resultArea = document.getElementById('resultArea');
  const copyBtn = document.getElementById('copyBtn');

  status.textContent = 'Initializing...';
  resultArea.value = '';
  copyBtn.disabled = true;

  // Helper to send message
  const sendMessage = (tabId) => {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, { action: "GET_TRANSCRIPT" }, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      });
    });
  };

  try {
    status.textContent = 'Opening transcript...';
    let response;
    try {
      response = await sendMessage(tab.id);
    } catch (err) {
      // Script might not be injected, try injecting it
      status.textContent = 'Connecting to page...';
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['scripts/content.js']
      });
      // Try again after a short delay
      await new Promise(r => setTimeout(r, 500));
      response = await sendMessage(tab.id);
    }
    
    if (response && response.success) {
      resultArea.value = response.data;
      status.textContent = 'Done!';
      copyBtn.disabled = false;
    } else {
      status.textContent = 'Error: ' + (response ? response.error : 'Unknown error');
    }
  } catch (err) {
    status.textContent = 'Error: ' + err.message;
    console.error(err);
  }
});

document.getElementById('copyBtn').addEventListener('click', () => {
  const resultArea = document.getElementById('resultArea');
  resultArea.select();
  document.execCommand('copy');
  
  const copyBtn = document.getElementById('copyBtn');
  const originalText = copyBtn.textContent;
  copyBtn.textContent = 'Copied!';
  setTimeout(() => {
    copyBtn.textContent = originalText;
  }, 2000);
});
