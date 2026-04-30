// options/options.js

import { GeminiClient } from '../scripts/gemini-client.js';
import { MistralClient } from '../scripts/mistral-client.js';

const geminiClient = new GeminiClient();
const mistralClient = new MistralClient();

document.addEventListener('DOMContentLoaded', () => {
  const geminiInput = document.getElementById('gemini-api-key');
  const mistralInput = document.getElementById('mistral-api-key');
  const saveGeminiBtn = document.getElementById('save-gemini-key');
  const saveMistralBtn = document.getElementById('save-mistral-key');
  const geminiStatus = document.getElementById('gemini-status');
  const mistralStatus = document.getElementById('mistral-status');
  const toast = document.getElementById('toast');
  const toastMessage = document.getElementById('toast-message');

  // Load saved keys
  chrome.storage.local.get(['GEMINI_API_KEY', 'MISTRAL_API_KEY'], (result) => {
    if (result.GEMINI_API_KEY) {
      geminiInput.value = result.GEMINI_API_KEY;
      geminiInput.classList.add('secured');
      updateStatus(geminiStatus, true);
    }
    if (result.MISTRAL_API_KEY) {
      mistralInput.value = result.MISTRAL_API_KEY;
      mistralInput.classList.add('secured');
      updateStatus(mistralStatus, true);
    }
  });

  // Toggle password visibility
  document.querySelectorAll('.toggle-visibility').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const input = document.getElementById(targetId);
      const eyeOpen = btn.querySelector('.eye-open');
      const eyeClosed = btn.querySelector('.eye-closed');

      if (input.type === 'password') {
        input.type = 'text';
        input.classList.remove('secured');
        eyeOpen.style.display = 'none';
        eyeClosed.style.display = 'block';
      } else {
        input.type = 'password';
        input.classList.add('secured');
        eyeOpen.style.display = 'block';
        eyeClosed.style.display = 'none';
      }
    });
  });

  // Save Gemini key
  saveGeminiBtn.addEventListener('click', async () => {
    const key = geminiInput.value.trim();
    if (!key) {
      geminiInput.focus();
      geminiInput.style.borderColor = 'rgba(239, 68, 68, 0.5)';
      setTimeout(() => { geminiInput.style.borderColor = ''; }, 1500);
      return;
    }
    saveGeminiBtn.disabled = true;
    saveGeminiBtn.querySelector('.btn-content').innerHTML = `
      <svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:currentColor;animation:spin 0.6s linear infinite"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z" opacity=".3"/><path d="M12 2a10 10 0 0 1 10 10h-3a7 7 0 0 0-7-7z"/></svg>
      Validating...
    `;
    const valid = await geminiClient.validateKey(key);
    if (!valid) {
      saveGeminiBtn.disabled = false;
      saveGeminiBtn.querySelector('.btn-content').innerHTML = `
        <svg viewBox="0 0 24 24"><path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/></svg>
        Save
      `;
      updateStatus(geminiStatus, 'invalid');
      showToast('Invalid API key');
      geminiInput.style.borderColor = 'rgba(239, 68, 68, 0.5)';
      setTimeout(() => { geminiInput.style.borderColor = ''; }, 1500);
      return;
    }
    saveKey(saveGeminiBtn, { GEMINI_API_KEY: key }, () => {
      updateStatus(geminiStatus, true);
      showToast('Gemini key saved');
    });
  });

  // Save Mistral key
  saveMistralBtn.addEventListener('click', async () => {
    const key = mistralInput.value.trim();
    if (!key) {
      mistralInput.focus();
      mistralInput.style.borderColor = 'rgba(239, 68, 68, 0.5)';
      setTimeout(() => { mistralInput.style.borderColor = ''; }, 1500);
      return;
    }
    saveMistralBtn.disabled = true;
    saveMistralBtn.querySelector('.btn-content').innerHTML = `
      <svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:currentColor;animation:spin 0.6s linear infinite"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z" opacity=".3"/><path d="M12 2a10 10 0 0 1 10 10h-3a7 7 0 0 0-7-7z"/></svg>
      Validating...
    `;
    const valid = await mistralClient.validateKey(key);
    if (!valid) {
      saveMistralBtn.disabled = false;
      saveMistralBtn.querySelector('.btn-content').innerHTML = `
        <svg viewBox="0 0 24 24"><path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/></svg>
        Save
      `;
      updateStatus(mistralStatus, 'invalid');
      showToast('Invalid API key');
      mistralInput.style.borderColor = 'rgba(239, 68, 68, 0.5)';
      setTimeout(() => { mistralInput.style.borderColor = ''; }, 1500);
      return;
    }
    saveKey(saveMistralBtn, { MISTRAL_API_KEY: key }, () => {
      updateStatus(mistralStatus, true);
      showToast('Mistral key saved');
    });
  });

  function saveKey(btn, data, callback) {
    btn.classList.add('saving');
    btn.querySelector('.btn-content').innerHTML = `
      <svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:currentColor;animation:spin 0.6s linear infinite"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z" opacity=".3"/><path d="M12 2a10 10 0 0 1 10 10h-3a7 7 0 0 0-7-7z"/></svg>
      Saving...
    `;
    chrome.storage.local.set(data, () => {
      setTimeout(() => {
        btn.classList.remove('saving');
        btn.querySelector('.btn-content').innerHTML = `
          <svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>
          Saved
        `;
        setTimeout(() => {
          btn.querySelector('.btn-content').innerHTML = `
            <svg viewBox="0 0 24 24"><path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/></svg>
            Save
          `;
          if (callback) callback();
        }, 1500);
      }, 400);
    });
  }

  function updateStatus(badge, state) {
    if (state === true) {
      badge.className = 'status-badge configured';
      badge.textContent = 'Active';
    } else if (state === 'invalid') {
      badge.className = 'status-badge invalid';
      badge.textContent = 'Invalid key';
    } else {
      badge.className = 'status-badge not-configured';
      badge.textContent = 'Not set';
    }
  }

  let toastTimeout;
  function showToast(message) {
    clearTimeout(toastTimeout);
    toastMessage.textContent = message;
    toast.classList.add('show');
    toastTimeout = setTimeout(() => toast.classList.remove('show'), 2500);
  }
});
