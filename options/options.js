// options/options.js

// Load saved API key
document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('api-key');
  const saveKeyButton = document.getElementById('save-key');
  
  // Load saved API key
  chrome.storage.local.get(['GEMINI_API_KEY'], (result) => {
    if (result.GEMINI_API_KEY) {
      apiKeyInput.value = result.GEMINI_API_KEY;
    }
  });
  
  // Save the API key
  saveKeyButton.addEventListener('click', () => {
    const apiKey = apiKeyInput.value;
    if (apiKey) {
      chrome.storage.local.set({ GEMINI_API_KEY: apiKey }, () => {
        saveKeyButton.textContent = 'Saved!';
        setTimeout(() => {
          saveKeyButton.textContent = 'Save';
        }, 1000);
      });
    }
  });
});