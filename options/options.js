// options/options.js

import { GeminiClient } from '../scripts/gemini-client.js';
import { MistralClient } from '../scripts/mistral-client.js';

const geminiClient = new GeminiClient();
const mistralClient = new MistralClient();

// Reusable button-content markup
const SAVE_ICON = '<svg viewBox="0 0 24 24"><path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/></svg>';
const SPINNER = '<svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:currentColor;animation:spin 0.6s linear infinite"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z" opacity=".3"/><path d="M12 2a10 10 0 0 1 10 10h-3a7 7 0 0 0-7-7z"/></svg>';
const CHECK_ICON = '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>';

// Banner icon paths
const INFO_PATH = 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z';
const CHECK_PATH = 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z';

document.addEventListener('DOMContentLoaded', () => {
  const toast = document.getElementById('toast');
  const toastMessage = document.getElementById('toast-message');
  const banner = document.getElementById('intro-banner');
  const bannerIcon = document.getElementById('banner-icon');
  const bannerText = document.getElementById('intro-banner-text');

  // Per-provider element + config map
  const providers = {
    gemini: {
      name: 'gemini',
      label: 'Gemini',
      storageKey: 'GEMINI_API_KEY',
      client: geminiClient,
      input: document.getElementById('gemini-api-key'),
      saveBtn: document.getElementById('save-gemini-key'),
      removeBtn: document.getElementById('remove-gemini-key'),
      status: document.getElementById('gemini-status'),
      hint: document.getElementById('gemini-key-hint'),
      helpToggle: document.getElementById('gemini-help-toggle'),
      helpBody: document.getElementById('gemini-help'),
    },
    mistral: {
      name: 'mistral',
      label: 'Mistral',
      storageKey: 'MISTRAL_API_KEY',
      client: mistralClient,
      input: document.getElementById('mistral-api-key'),
      saveBtn: document.getElementById('save-mistral-key'),
      removeBtn: document.getElementById('remove-mistral-key'),
      status: document.getElementById('mistral-status'),
      hint: document.getElementById('mistral-key-hint'),
      helpToggle: document.getElementById('mistral-help-toggle'),
      helpBody: document.getElementById('mistral-help'),
    },
  };

  const configured = { gemini: false, mistral: false };

  // Load saved keys and paint each card's state
  chrome.storage.local.get(['GEMINI_API_KEY', 'MISTRAL_API_KEY', 'SELECTED_MODEL'], (result) => {
    configured.gemini = !!result.GEMINI_API_KEY;
    configured.mistral = !!result.MISTRAL_API_KEY;
    applyKeyState(providers.gemini, result.GEMINI_API_KEY || null);
    applyKeyState(providers.mistral, result.MISTRAL_API_KEY || null);
    updateBanner();
    setActiveModel(result.SELECTED_MODEL || 'auto');
    updateModelSegmented();
  });

  // Wire up each provider
  Object.values(providers).forEach((p) => {
    p.saveBtn.addEventListener('click', () => handleSave(p));
    p.removeBtn.addEventListener('click', () => handleRemove(p));
    p.helpToggle.addEventListener('click', () => {
      const open = p.helpToggle.getAttribute('aria-expanded') === 'true';
      setAccordion(p, !open);
    });
  });

  // --- Model provider (which AI generates summaries) ---
  // Persists SELECTED_MODEL (global). The panel reads it at generate time.
  // Providers without a saved key are disabled; if the active provider loses its
  // key, we fall back to Auto.
  const modelSegmented = document.getElementById('model-segmented');
  const modelOptions = modelSegmented
    ? Array.from(modelSegmented.querySelectorAll('.segmented-option'))
    : [];

  function setActiveModel(model) {
    modelOptions.forEach((o) =>
      o.setAttribute('aria-checked', o.dataset.model === model ? 'true' : 'false')
    );
  }

  function updateModelSegmented() {
    const available = { auto: true, gemini: configured.gemini, mistral: configured.mistral };
    modelOptions.forEach((o) => {
      const m = o.dataset.model;
      const ok = !!available[m];
      o.disabled = !ok;
      o.title = ok ? '' : `No ${o.textContent} API key set — add one above`;
    });
    const active = modelOptions.find((o) => o.getAttribute('aria-checked') === 'true');
    if (active && active.disabled) {
      setActiveModel('auto');
      chrome.storage.local.set({ SELECTED_MODEL: 'auto' });
    }
  }

  modelOptions.forEach((o) => {
    o.addEventListener('click', () => {
      if (o.disabled) return;
      setActiveModel(o.dataset.model);
      chrome.storage.local.set({ SELECTED_MODEL: o.dataset.model });
      showToast(`Model: ${o.textContent}`);
    });
  });

  // --- Appearance (panel theme) ---
  // Persists THEME_PREF; the in-page panel reacts live via chrome.storage.onChanged.
  const themeSegmented = document.getElementById('theme-segmented');
  if (themeSegmented) {
    const themeOptions = themeSegmented.querySelectorAll('.segmented-option');
    const setActiveTheme = (pref) => {
      themeOptions.forEach((o) =>
        o.setAttribute('aria-checked', o.dataset.theme === pref ? 'true' : 'false')
      );
    };
    chrome.storage.local.get(['THEME_PREF'], (res) => setActiveTheme(res.THEME_PREF || 'system'));
    themeOptions.forEach((o) => {
      o.addEventListener('click', () => {
        const pref = o.dataset.theme;
        setActiveTheme(pref);
        chrome.storage.local.set({ THEME_PREF: pref });
        showToast(`Panel appearance: ${o.textContent}`);
      });
    });
  }

  // Toggle password visibility
  document.querySelectorAll('.toggle-visibility').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.getAttribute('data-target'));
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

  // --- Save flow (validate live, then persist) ---
  async function handleSave(p) {
    const key = p.input.value.trim();
    if (!key) {
      p.input.focus();
      flashInvalid(p.input);
      return;
    }

    p.saveBtn.disabled = true;
    setBtn(p.saveBtn, SPINNER, 'Validating...');

    const valid = await p.client.validateKey(key);
    if (!valid) {
      p.saveBtn.disabled = false;
      setBtn(p.saveBtn, SAVE_ICON, 'Save');
      updateStatus(p.status, 'invalid');
      showToast('Invalid API key');
      flashInvalid(p.input);
      return;
    }

    p.saveBtn.classList.add('saving');
    setBtn(p.saveBtn, SPINNER, 'Saving...');
    chrome.storage.local.set({ [p.storageKey]: key }, () => {
      setTimeout(() => {
        p.saveBtn.classList.remove('saving');
        setBtn(p.saveBtn, CHECK_ICON, 'Saved');
        setTimeout(() => {
          p.saveBtn.disabled = false;
          setBtn(p.saveBtn, SAVE_ICON, 'Save');
        }, 1500);

        configured[p.name] = true;
        applyKeyState(p, key);
        updateBanner();
        updateModelSegmented();
        showToast(`${p.label} key saved`);
        chrome.runtime.sendMessage({ action: 'KEYS_CHANGED' });
      }, 400);
    });
  }

  // --- Remove flow ---
  function handleRemove(p) {
    chrome.storage.local.remove(p.storageKey, () => {
      configured[p.name] = false;
      resetVisibility(p.input);
      applyKeyState(p, null);
      updateBanner();
      updateModelSegmented();
      showToast(`${p.label} key removed`);
      chrome.runtime.sendMessage({ action: 'KEYS_CHANGED' });
    });
  }

  // Paint a card for the given key (null = not configured)
  function applyKeyState(p, key) {
    if (key) {
      p.input.value = key;
      p.input.classList.add('secured');
      updateStatus(p.status, true);
      p.hint.textContent = `Saved ••••••••${String(key).slice(-4)}`;
      p.hint.hidden = false;
      p.removeBtn.hidden = false;
      setAccordion(p, false);
    } else {
      p.input.value = '';
      p.input.classList.remove('secured');
      updateStatus(p.status, false);
      p.hint.hidden = true;
      p.removeBtn.hidden = true;
      setAccordion(p, true);
    }
  }

  function setAccordion(p, open) {
    p.helpToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    p.helpBody.classList.toggle('open', open);
  }

  function updateBanner() {
    const g = configured.gemini;
    const m = configured.mistral;
    const ready = g || m;
    banner.classList.toggle('ready', ready);
    bannerIcon.innerHTML = `<svg viewBox="0 0 24 24"><path d="${ready ? CHECK_PATH : INFO_PATH}"/></svg>`;
    if (g && m) {
      bannerText.innerHTML = '<strong>Both providers configured.</strong> Auto mode uses Gemini first and falls back to Mistral.';
    } else if (ready) {
      bannerText.innerHTML = "<strong>You're all set.</strong> Add the other provider too for automatic fallback.";
    } else {
      bannerText.innerHTML = 'Add an API key from <strong>either provider</strong> below to start generating summaries — both offer a free tier.';
    }
  }

  function setBtn(btn, icon, label) {
    btn.querySelector('.btn-content').innerHTML = `${icon}\n${label}`;
  }

  function flashInvalid(input) {
    input.style.borderColor = 'rgba(239, 68, 68, 0.5)';
    setTimeout(() => { input.style.borderColor = ''; }, 1500);
  }

  function resetVisibility(input) {
    input.type = 'password';
    const btn = document.querySelector(`.toggle-visibility[data-target="${input.id}"]`);
    if (!btn) return;
    const eyeOpen = btn.querySelector('.eye-open');
    const eyeClosed = btn.querySelector('.eye-closed');
    if (eyeOpen) eyeOpen.style.display = 'block';
    if (eyeClosed) eyeClosed.style.display = 'none';
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
