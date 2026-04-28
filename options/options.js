// options/options.js

// Load saved API keys
document.addEventListener('DOMContentLoaded', () => {
  const geminiKeyInput = document.getElementById('gemini-api-key');
  const mistralKeyInput = document.getElementById('mistral-api-key');
  const saveGeminiKeyButton = document.getElementById('save-gemini-key');
  const saveMistralKeyButton = document.getElementById('save-mistral-key');
  
  // Load saved API keys
  chrome.storage.local.get(['GEMINI_API_KEY', 'MISTRAL_API_KEY'], (result) => {
    if (result.GEMINI_API_KEY) {
      geminiKeyInput.value = result.GEMINI_API_KEY;
    }
    if (result.MISTRAL_API_KEY) {
      mistralKeyInput.value = result.MISTRAL_API_KEY;
    }
  });
  
  // Save the Gemini API key
  saveGeminiKeyButton.addEventListener('click', () => {
    const apiKey = geminiKeyInput.value;
    if (apiKey) {
      chrome.storage.local.set({ GEMINI_API_KEY: apiKey }, () => {
        saveGeminiKeyButton.textContent = 'Saved!';
        setTimeout(() => {
          saveGeminiKeyButton.textContent = 'Save Gemini Key';
        }, 1000);
      });
    }
  });
  
  // Save the Mistral API key
  saveMistralKeyButton.addEventListener('click', () => {
    const apiKey = mistralKeyInput.value;
    if (apiKey) {
      chrome.storage.local.set({ MISTRAL_API_KEY: apiKey }, () => {
        saveMistralKeyButton.textContent = 'Saved!';
        setTimeout(() => {
          saveMistralKeyButton.textContent = 'Save Mistral Key';
        }, 1000);
      });
    }
  });
});