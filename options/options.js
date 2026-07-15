// options/options.js

import { PROVIDERS } from '../scripts/providers.js';

// Reusable button-content markup
const SAVE_ICON = '<svg viewBox="0 0 24 24"><path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/></svg>';
const SPINNER = '<svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:currentColor;animation:spin 0.6s linear infinite"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z" opacity=".3"/><path d="M12 2a10 10 0 0 1 10 10h-3a7 7 0 0 0-7-7z"/></svg>';
const CHECK_ICON = '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>';

// Banner icon paths
const INFO_PATH = 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z';
const CHECK_PATH = 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z';

document.addEventListener('DOMContentLoaded', async () => {
  const toast = document.getElementById('toast');
  const toastMessage = document.getElementById('toast-message');
  const banner = document.getElementById('intro-banner');
  const bannerIcon = document.getElementById('banner-icon');
  const bannerText = document.getElementById('intro-banner-text');

  // --- Sidebar navigation (switch content panes) ---
  const navItems = Array.from(document.querySelectorAll('.nav-item'));
  const panes = Array.from(document.querySelectorAll('.pane'));
  function showPane(name) {
    navItems.forEach((n) => {
      const on = n.dataset.pane === name;
      n.classList.toggle('active', on);
      n.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    panes.forEach((p) => p.classList.toggle('active', p.id === `pane-${name}`));
  }
  navItems.forEach((n) => n.addEventListener('click', () => showPane(n.dataset.pane)));

  const configured = {};
  const providerElements = {};

  // Build the model selector segmented UI dynamically
  const modelSegmented = document.getElementById('model-segmented');
  modelSegmented.innerHTML = '<button class="segmented-option" data-model="auto" role="radio" aria-checked="true">Auto</button>';
  
  Object.values(PROVIDERS).forEach(p => {
    const btn = document.createElement('button');
    btn.className = 'segmented-option';
    btn.dataset.model = p.id;
    btn.role = 'radio';
    btn.setAttribute('aria-checked', 'false');
    btn.textContent = p.name;
    modelSegmented.appendChild(btn);
  });

  // Build the provider list dynamically
  const providersList = document.getElementById('providers-list');
  
  Object.values(PROVIDERS).forEach(p => {
    configured[p.id] = false;
    
    // Create card HTML
    const cardHTML = `
      <div class="model-card" id="card-${p.id}">
        <div class="card-header">
          <div class="model-icon ${p.cssClass}">
            ${p.svgIcon}
          </div>
          <div class="model-info">
            <div class="model-name">${p.name}</div>
            <div class="model-desc">${p.description}</div>
          </div>
          <span class="status-badge not-configured" id="${p.id}-status">Not set</span>
        </div>
        <div class="input-group">
          <label for="${p.id}-api-key">API Key</label>
          <div class="input-wrapper">
            <input type="password" id="${p.id}-api-key" placeholder="Paste your ${p.name} API key" autocomplete="off" spellcheck="false">
            <button class="toggle-visibility" data-target="${p.id}-api-key" title="Toggle visibility">
              <svg class="eye-open" viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
              <svg class="eye-closed" viewBox="0 0 24 24" style="display:none"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>
            </button>
          </div>
        </div>
        
        <div class="input-group">
          <label for="${p.id}-model">Model</label>
          <div class="input-wrapper">
            <select id="${p.id}-model" disabled>
              <option value="${p.defaultModel}">${p.defaultModel}</option>
            </select>
          </div>
        </div>

        <div class="key-hint" id="${p.id}-key-hint" hidden></div>
        <div class="action-row">
          <button class="save-btn" id="save-${p.id}-key">
            <span class="btn-content">${SAVE_ICON} Save</span>
          </button>
          <button class="remove-btn" id="remove-${p.id}-key" hidden>Remove</button>
        </div>
        
        <div class="help">
          <button class="help-toggle" id="${p.id}-help-toggle" aria-expanded="false" aria-controls="${p.id}-help">
            <span class="help-toggle-label">
              <svg viewBox="0 0 24 24"><path d="M12.65 10A5.99 5.99 0 0 0 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6a5.99 5.99 0 0 0 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/></svg>
              ${p.helpTitle}
            </span>
            <svg class="help-chevron" viewBox="0 0 24 24"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z"/></svg>
          </button>
          <div class="help-body" id="${p.id}-help">
            <div class="help-body-inner">
              <ol class="help-steps">
                ${p.helpSteps.map(step => `<li>${step}</li>`).join('')}
              </ol>
            </div>
          </div>
        </div>
      </div>
    `;
    
    providersList.insertAdjacentHTML('beforeend', cardHTML);
    
    providerElements[p.id] = {
      ...p,
      client: new p.clientClass(p),
      input: document.getElementById(`${p.id}-api-key`),
      modelSelect: document.getElementById(`${p.id}-model`),
      saveBtn: document.getElementById(`save-${p.id}-key`),
      removeBtn: document.getElementById(`remove-${p.id}-key`),
      status: document.getElementById(`${p.id}-status`),
      hint: document.getElementById(`${p.id}-key-hint`),
      helpToggle: document.getElementById(`${p.id}-help-toggle`),
      helpBody: document.getElementById(`${p.id}-help`),
    };
  });

  const storageKeysToFetch = Object.values(PROVIDERS).map(p => p.storageKey);
  const modelKeysToFetch = Object.values(PROVIDERS).map(p => `${p.id}_MODEL`);
  storageKeysToFetch.push('SELECTED_MODEL');
  storageKeysToFetch.push(...modelKeysToFetch);

  // Load saved keys and paint each card's state
  chrome.storage.local.get(storageKeysToFetch, (result) => {
    Object.values(providerElements).forEach(p => {
      configured[p.id] = !!result[p.storageKey];
      applyKeyState(p, result[p.storageKey] || null);
      
      const savedModel = result[`${p.id}_MODEL`];
      if (configured[p.id] && result[p.storageKey]) {
        // Fetch models to populate dropdown
        fetchAndPopulateModels(p, result[p.storageKey], savedModel);
      }
    });

    updateBanner();
    setActiveModel(result.SELECTED_MODEL || 'auto');
    updateModelSegmented();
  });

  async function fetchAndPopulateModels(p, apiKey, savedModel) {
    p.modelSelect.innerHTML = `<option value="">Loading models...</option>`;
    p.modelSelect.disabled = true;
    
    const models = await p.client.fetchModels(apiKey);
    p.modelSelect.innerHTML = '';
    
    if (models.length === 0) {
      // Fallback
      p.modelSelect.innerHTML = `<option value="${p.defaultModel}">${p.defaultModel}</option>`;
    } else {
      models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.name;
        p.modelSelect.appendChild(opt);
      });
      if (savedModel && models.find(m => m.id === savedModel)) {
        p.modelSelect.value = savedModel;
      } else {
        p.modelSelect.value = p.defaultModel;
        // if default model is not in the list, just pick the first one
        if (!models.find(m => m.id === p.defaultModel) && models.length > 0) {
          p.modelSelect.value = models[0].id;
        }
      }
    }
    p.modelSelect.disabled = false;
  }

  // Wire up each provider
  Object.values(providerElements).forEach((p) => {
    p.saveBtn.addEventListener('click', () => handleSave(p));
    p.removeBtn.addEventListener('click', () => handleRemove(p));
    p.helpToggle.addEventListener('click', () => {
      const open = p.helpToggle.getAttribute('aria-expanded') === 'true';
      setAccordion(p, !open);
    });
    p.modelSelect.addEventListener('change', () => {
      chrome.storage.local.set({ [`${p.id}_MODEL`]: p.modelSelect.value });
      showToast('Model saved');
    });
  });

  const modelOptions = Array.from(modelSegmented.querySelectorAll('.segmented-option'));

  function setActiveModel(model) {
    modelOptions.forEach((o) =>
      o.setAttribute('aria-checked', o.dataset.model === model ? 'true' : 'false')
    );
  }

  function updateModelSegmented() {
    modelOptions.forEach((o) => {
      const m = o.dataset.model;
      if (m === 'auto') return;
      const ok = !!configured[m];
      o.disabled = !ok;
      o.title = ok ? '' : `No ${o.textContent} API key set — add one below`;
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
      showToast(`Provider: ${o.textContent}`);
    });
  });

  // --- Appearance (panel theme) ---
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

  const statSummaries = document.getElementById('stat-summaries');
  const statTimeSaved = document.getElementById('stat-time-saved');
  if (statSummaries && statTimeSaved) {
    chrome.storage.local.get(['SUMMARIES_COUNT', 'SECONDS_SAVED'], (res) => {
      statSummaries.textContent = String(res.SUMMARIES_COUNT || 0);
      statTimeSaved.textContent = formatDuration(res.SECONDS_SAVED || 0);
    });
  }

  function formatDuration(seconds) {
    const s = Math.max(0, Math.round(seconds));
    if (s === 0) return '0m';
    if (s < 60) return '<1m';
    const totalMin = Math.floor(s / 60);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h === 0) return `${m}m`;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  }

  // Toggle password visibility (dynamic delegate)
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.toggle-visibility');
    if (!btn) return;
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

        configured[p.id] = true;
        applyKeyState(p, key);
        updateBanner();
        updateModelSegmented();
        showToast(`${p.name} key saved`);
        chrome.runtime.sendMessage({ action: 'KEYS_CHANGED' });
        
        fetchAndPopulateModels(p, key, null);
      }, 400);
    });
  }

  function handleRemove(p) {
    chrome.storage.local.remove([p.storageKey, `${p.id}_MODEL`], () => {
      configured[p.id] = false;
      resetVisibility(p.input);
      applyKeyState(p, null);
      updateBanner();
      updateModelSegmented();
      showToast(`${p.name} key removed`);
      chrome.runtime.sendMessage({ action: 'KEYS_CHANGED' });
      p.modelSelect.innerHTML = `<option value="${p.defaultModel}">${p.defaultModel}</option>`;
      p.modelSelect.disabled = true;
    });
  }

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
    const activeCount = Object.values(configured).filter(v => v).length;
    const ready = activeCount > 0;
    banner.classList.toggle('ready', ready);
    bannerIcon.innerHTML = `<svg viewBox="0 0 24 24"><path d="${ready ? CHECK_PATH : INFO_PATH}"/></svg>`;
    
    if (activeCount > 1) {
      bannerText.innerHTML = '<strong>Multiple providers configured.</strong> Auto mode will fallback gracefully between them.';
    } else if (activeCount === 1) {
      bannerText.innerHTML = "<strong>You're all set.</strong> Add another provider for automatic fallback.";
    } else {
      bannerText.innerHTML = 'Add an API key from <strong>any provider</strong> below to start generating summaries.';
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
