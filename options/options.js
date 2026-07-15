// options/options.js

import { PROVIDERS } from '../scripts/providers.js';
import { OpenAICompatibleClient } from '../scripts/openai-compatible-client.js';

// Reusable button-content markup
const SAVE_ICON = '<svg viewBox="0 0 24 24"><path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/></svg>';
const SPINNER = '<svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:currentColor;animation:spin 0.6s linear infinite"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z" opacity=".3"/><path d="M12 2a10 10 0 0 1 10 10h-3a7 7 0 0 0-7-7z"/></svg>';
const CHECK_ICON = '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>';
const TRASH_ICON = '<svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';

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

  let configured = {};
  let providerElements = {};
  let ALL_PROVIDERS = {};


  const providersList = document.getElementById('providers-list');
  const addProviderBtn = document.getElementById('add-provider-btn');
  
  const providerSetupModal = document.getElementById('provider-setup-modal');
  const providerListView = document.getElementById('provider-list-view');
  const unconfiguredProvidersList = document.getElementById('unconfigured-providers-list');
  const addCustomProviderItem = document.getElementById('add-custom-provider-item');
  
  const providerConfigView = document.getElementById('provider-config-view');
  const providerConfigBody = document.getElementById('provider-config-body');
  const providerConfigTitle = document.getElementById('provider-config-title');
  const providerConfigBackBtn = document.getElementById('provider-config-back-btn');
  const closeProviderSetupBtn = document.getElementById('close-provider-setup-btn');
  const closeProviderConfigBtn = document.getElementById('close-provider-config-btn');
  
  const customProviderTemplate = document.getElementById('custom-provider-form-template');

  
  // Model selector elements
  const modelSelectorContainer = document.getElementById('model-selector-container');
  const modelSelectorBtn = document.getElementById('model-selector-btn');
  const activeModelText = document.getElementById('active-model-text');
  const activeModelIcon = document.getElementById('active-model-icon');
  
  const selectorModal = document.getElementById('selector-modal');
  const closeSelectorBtn = document.getElementById('close-selector-btn');
  const selectorSearch = document.getElementById('selector-search');
  const selectorList = document.getElementById('selector-list');

  async function loadAndRenderProviders() {
    const res = await new Promise(resolve => chrome.storage.local.get(null, resolve));
    
    customProvidersList = res.CUSTOM_PROVIDERS || [];
    ALL_PROVIDERS = { ...PROVIDERS };
    
    customProvidersList.forEach(cp => {
      ALL_PROVIDERS[cp.id] = {
        ...cp,
        clientClass: OpenAICompatibleClient
      };
    });

    providersList.innerHTML = '';
    unconfiguredProvidersList.innerHTML = '';
    providerElements = {};
    configured = {};

    Object.values(ALL_PROVIDERS).forEach(p => {
      const isConfig = !!res[p.storageKey] || (p.isCustom && res[p.storageKey] === '');
      configured[p.id] = isConfig;

      if (isConfig) {
        renderConfiguredCard(p, res);
      } else {
        renderUnconfiguredItem(p);
      }
    });

    updateBanner();
    setActiveModel(res.SELECTED_MODEL || 'auto');
    updateModelSelector();
    bindDeleteCustomBtns();
  }

  function getProviderFormHTML(p, inModal = false) {
    return `
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
      <div class="action-row" ${inModal ? 'style="margin-top: 16px;"' : ''}>
        <button class="save-btn" id="save-${p.id}-key">
          <span class="btn-content">${SAVE_ICON} Save</span>
        </button>
        ${!inModal ? `<button class="remove-btn" id="remove-${p.id}-key" hidden>Remove</button>` : ''}
      </div>
      
      ${(!p.isCustom && !inModal) ? `
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
      </div>` : ''}
    `;
  }

  function renderConfiguredCard(p, res) {
    const svgIcon = p.svgIcon || `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`;

    const cardHTML = `
      <div class="model-card" id="card-${p.id}">
        <div class="card-header">
          <div class="model-icon ${p.cssClass || 'openai'}">
            ${svgIcon}
          </div>
          <div class="model-info">
            <div class="model-name">${p.name}</div>
            <div class="model-desc">${p.description}</div>
          </div>
          <span class="status-badge not-configured" id="${p.id}-status">Not set</span>
          ${p.isCustom ? `<button class="delete-custom-btn" data-id="${p.id}" title="Delete Provider">${TRASH_ICON}</button>` : ''}
        </div>
        ${getProviderFormHTML(p, false)}
      </div>
    `;
    
    providersList.insertAdjacentHTML('beforeend', cardHTML);
    bindProviderLogic(p, res);
  }

  function renderUnconfiguredItem(p) {
    const svgIcon = p.svgIcon || `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`;
    
    const item = document.createElement('div');
    item.className = 'command-item';
    item.innerHTML = `
      <div class="command-item-icon ${p.cssClass || 'openai'}">${svgIcon}</div>
      <div class="command-item-name">${p.name}</div>
    `;
    
    item.addEventListener('click', () => {
      openProviderConfig(p);
    });
    
    unconfiguredProvidersList.appendChild(item);
  }

  function bindProviderLogic(p, res = null) {
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

    const pe = providerElements[p.id];
    
    if (res) {
      applyKeyState(pe, res[p.storageKey]);
      if (configured[p.id]) {
        fetchAndPopulateModels(pe, res[p.storageKey] || '', res[`${p.id}_MODEL`]);
      }
    }

    pe.saveBtn.addEventListener('click', () => handleSave(pe));
    if (pe.removeBtn) {
      pe.removeBtn.addEventListener('click', () => handleRemove(pe));
    }
    
    if (pe.helpToggle) {
      pe.helpToggle.addEventListener('click', () => {
        const open = pe.helpToggle.getAttribute('aria-expanded') === 'true';
        setAccordion(pe, !open);
      });
    }
    
    pe.modelSelect.addEventListener('change', () => {
      chrome.storage.local.set({ [`${p.id}_MODEL`]: pe.modelSelect.value });
      showToast('Model saved');
    });
  }

  function openProviderConfig(p) {
    providerConfigTitle.textContent = p.name;
    providerConfigBody.innerHTML = getProviderFormHTML(p, true);
    
    bindProviderLogic(p, null);
    
    providerListView.hidden = true;
    providerConfigView.hidden = false;
  }

  function bindDeleteCustomBtns() {
    document.querySelectorAll('.delete-custom-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        deleteCustomProvider(id);
      });
    });
  }
  
  let customProvidersList = [];

  // Initial load

  // Render default providers instantly for snappy UI
  loadAndRenderProviders();

  async function fetchAndPopulateModels(p, apiKey, savedModel) {
    p.modelSelect.disabled = true;
    
    // 1. Try to load from cache first for instant UI
    const cacheKey = `${p.id}_CACHED_MODELS`;
    chrome.storage.local.get([cacheKey], async (res) => {
      let cachedModels = res[cacheKey] || [];
      
      // If we have no cache and it's custom with a fallback list
      if (cachedModels.length === 0 && p.isCustom && p.modelsList) {
        cachedModels = p.modelsList.split(',').map(m => m.trim()).filter(m => m).map(m => ({ id: m, name: m }));
      }

      // Render cached models immediately
      if (cachedModels.length === 0) {
        p.modelSelect.innerHTML = `<option value="${p.defaultModel}">${p.defaultModel}</option>`;
      } else {
        renderSelectOptions(p, cachedModels, savedModel);
      }

      // 2. Fetch in background to update if we have an API key or if it's a custom provider (which might not need one)
      if (apiKey || p.isCustom) {
        // Show loading state ONLY if we had no cache
        if (cachedModels.length === 0) {
          p.modelSelect.innerHTML = `<option value="">Loading models...</option>`;
        }
        
        try {
          const freshModels = await p.client.fetchModels(apiKey);
          if (freshModels && freshModels.length > 0) {
            chrome.storage.local.set({ [cacheKey]: freshModels });
            renderSelectOptions(p, freshModels, savedModel);
          }
        } catch (e) {
          console.error(`Failed to fetch fresh models for ${p.id}`, e);
          // If fetch fails but we had cache, we just keep the cache.
          // If we had no cache and fetch fails, fall back to default:
          if (cachedModels.length === 0) {
             p.modelSelect.innerHTML = `<option value="${p.defaultModel}">${p.defaultModel}</option>`;
             p.modelSelect.disabled = false;
          }
        }
      } else {
        p.modelSelect.disabled = false;
      }
    });
  }

  function renderSelectOptions(p, modelsList, savedModel) {
    p.modelSelect.innerHTML = '';
    modelsList.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name;
      p.modelSelect.appendChild(opt);
    });
    
    if (savedModel && modelsList.find(m => m.id === savedModel)) {
      p.modelSelect.value = savedModel;
    } else if (modelsList.find(m => m.id === p.defaultModel)) {
      p.modelSelect.value = p.defaultModel;
    } else if (modelsList.length > 0) {
      p.modelSelect.value = modelsList[0].id;
    }
    p.modelSelect.disabled = false;
  }

  function bindProviderEvents() {
    Object.values(providerElements).forEach((p) => {
      p.saveBtn.addEventListener('click', () => handleSave(p));
      p.removeBtn.addEventListener('click', () => handleRemove(p));
      if (p.helpToggle) {
        p.helpToggle.addEventListener('click', () => {
          const open = p.helpToggle.getAttribute('aria-expanded') === 'true';
          setAccordion(p, !open);
        });
      }
      p.modelSelect.addEventListener('change', () => {
        chrome.storage.local.set({ [`${p.id}_MODEL`]: p.modelSelect.value });
        showToast('Model saved');
      });
    });

    document.querySelectorAll('.delete-custom-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        deleteCustomProvider(id);
      });
    });
  }

  // --- Model Selector Logic ---
  let activeModelId = 'auto';

  function setActiveModel(model) {
    activeModelId = model;
    
    if (model === 'auto') {
      activeModelText.textContent = 'Auto';
      activeModelIcon.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`;
    } else {
      const p = ALL_PROVIDERS[model];
      if (p) {
        activeModelText.textContent = p.name;
        activeModelIcon.innerHTML = p.svgIcon || `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`;
      }
    }
    
    // Update active class in selector list if it's open
    const items = selectorList.querySelectorAll('.command-item');
    items.forEach(item => {
      item.classList.toggle('active', item.dataset.model === activeModelId);
    });
  }

  function updateModelSelector() {
    const configuredCount = Object.values(configured).filter(v => v).length;
    
    // Check if the current active model is disabled
    if (activeModelId !== 'auto' && !configured[activeModelId]) {
      setActiveModel('auto');
      chrome.storage.local.set({ SELECTED_MODEL: 'auto' });
    }
    
    // Hide selector completely if < 2 models are configured
    if (configuredCount < 2) {
      modelSelectorContainer.hidden = true;
    } else {
      modelSelectorContainer.hidden = false;
    }
  }
  
  // Model Selector Modal Events
  modelSelectorBtn.addEventListener('click', () => {
    // Populate modal list
    selectorList.innerHTML = '';
    
    // Auto Option
    const autoItem = document.createElement('div');
    autoItem.className = `command-item ${activeModelId === 'auto' ? 'active' : ''}`;
    autoItem.dataset.model = 'auto';
    autoItem.innerHTML = `
      <div class="command-item-icon">
        <svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
      </div>
      <div class="command-item-name">Auto (Fallbacks between all providers)</div>
    `;
    autoItem.addEventListener('click', () => selectModel('auto'));
    selectorList.appendChild(autoItem);
    
    // Configured Providers
    Object.values(ALL_PROVIDERS).forEach(p => {
      if (configured[p.id]) {
        const item = document.createElement('div');
        item.className = `command-item ${activeModelId === p.id ? 'active' : ''}`;
        item.dataset.model = p.id;
        const svgIcon = p.svgIcon || `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`;
        item.innerHTML = `
          <div class="command-item-icon ${p.cssClass || 'openai'}">${svgIcon}</div>
          <div class="command-item-name">${p.name}</div>
        `;
        item.addEventListener('click', () => selectModel(p.id));
        selectorList.appendChild(item);
      }
    });
    
    selectorSearch.value = '';
    selectorModal.hidden = false;
    selectorSearch.focus();
  });
  
  function selectModel(modelId) {
    setActiveModel(modelId);
    chrome.storage.local.set({ SELECTED_MODEL: modelId });
    showToast('Provider updated');
    selectorModal.hidden = true;
  }
  
  closeSelectorBtn.addEventListener('click', () => {
    selectorModal.hidden = true;
  });
  
  selectorSearch.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    const items = Array.from(selectorList.querySelectorAll('.command-item'));
    items.forEach(item => {
      const text = item.textContent.toLowerCase();
      item.style.display = text.includes(q) ? 'flex' : 'none';
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
    if (!key && !p.isCustom) {
      p.input.focus();
      flashInvalid(p.input);
      return;
    }

    p.saveBtn.disabled = true;
    setBtn(p.saveBtn, SPINNER, 'Validating...');

    // Custom providers with empty key shouldn't fail validation immediately if local
    const valid = p.isCustom && !key ? true : await p.client.validateKey(key);
    if (!valid && !p.isCustom) {
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
        updateModelSelector();
        showToast(`${p.name} key saved`);
        chrome.runtime.sendMessage({ action: 'KEYS_CHANGED' });
        
        providerSetupModal.hidden = true;
        loadAndRenderProviders();
      }, 400);
    });
  }

  function handleRemove(p) {
    chrome.storage.local.remove([p.storageKey, `${p.id}_MODEL`], () => {
      configured[p.id] = false;
      resetVisibility(p.input);
      applyKeyState(p, null);
      updateBanner();
      updateModelSelector();
      showToast(`${p.name} key removed`);
      chrome.runtime.sendMessage({ action: 'KEYS_CHANGED' });
      loadAndRenderProviders();
    });
  }

  function applyKeyState(p, key) {
    if (key || (p.isCustom && configured[p.id])) {
      p.input.value = key || '';
      if (key) p.input.classList.add('secured');
      updateStatus(p.status, true);
      if (key) {
        p.hint.textContent = `Saved ••••••••${String(key).slice(-4)}`;
      } else {
        p.hint.textContent = `Saved without key`;
      }
      p.hint.hidden = false;
      if (p.removeBtn) p.removeBtn.hidden = false;
      if (p.helpToggle) setAccordion(p, false);
    } else {
      p.input.value = '';
      p.input.classList.remove('secured');
      updateStatus(p.status, false);
      p.hint.hidden = true;
      if (p.removeBtn) p.removeBtn.hidden = true;
      if (p.helpToggle) setAccordion(p, true);
    }
  }

  function setAccordion(p, open) {
    if (!p.helpToggle) return;
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
    if (!badge) return;
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

  // --- Custom Providers Modal Logic ---

  if (addProviderBtn) {
    addProviderBtn.addEventListener('click', () => {
      providerSetupModal.hidden = false;
      providerListView.hidden = false;
      providerConfigView.hidden = true;
    });
  }

  const hideSetupModal = () => { providerSetupModal.hidden = true; };
  if (closeProviderSetupBtn) closeProviderSetupBtn.addEventListener('click', hideSetupModal);
  if (closeProviderConfigBtn) closeProviderConfigBtn.addEventListener('click', hideSetupModal);

  if (providerConfigBackBtn) {
    providerConfigBackBtn.addEventListener('click', () => {
      providerConfigView.hidden = true;
      providerListView.hidden = false;
    });
  }

  if (addCustomProviderItem) {
    addCustomProviderItem.addEventListener('click', () => {
      providerConfigTitle.textContent = 'Custom Provider';
      providerConfigBody.innerHTML = '';
      providerConfigBody.appendChild(customProviderTemplate.content.cloneNode(true));
      
      providerListView.hidden = true;
      providerConfigView.hidden = false;
      
      document.getElementById('save-custom-provider-btn').addEventListener('click', handleSaveCustomProvider);
    });
  }


  function handleSaveCustomProvider() {
    const cpName = document.getElementById('cp-name');
    const cpEndpoint = document.getElementById('cp-endpoint');
    const cpApiKey = document.getElementById('cp-api-key');
    const cpModels = document.getElementById('cp-models');
    const cpHeaders = document.getElementById('cp-headers');
    const name = cpName.value.trim();
    let endpoint = cpEndpoint.value.trim();
    if (endpoint && !endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
      endpoint = 'https://' + endpoint;
    }
    const modelsList = cpModels.value.trim();
    if (!name || !endpoint || !modelsList) {
      if (!name) flashInvalid(cpName);
      if (!endpoint) flashInvalid(cpEndpoint);
      if (!modelsList) flashInvalid(cpModels);
      return;
    }
    
    let parsedHeaders = {};
    if (cpHeaders.value.trim()) {
      try {
        parsedHeaders = JSON.parse(cpHeaders.value.trim());
      } catch (e) {
        flashInvalid(cpHeaders);
        showToast('Invalid JSON in headers');
        return;
      }
    }

    const id = 'custom_' + Date.now();
    const defaultModel = modelsList ? modelsList.split(',')[0].trim() : 'gpt-3.5-turbo';

    const newProvider = {
      id: id,
      name: name,
      description: 'Custom Provider',
      isCustom: true,
      storageKey: `CUSTOM_${id.toUpperCase()}_API_KEY`,
      endpoint: endpoint,
      defaultModel: defaultModel,
      modelsList: modelsList,
      headers: Object.keys(parsedHeaders).length > 0 ? parsedHeaders : undefined
    };

    chrome.storage.local.get(['CUSTOM_PROVIDERS'], (res) => {
      const customProviders = res.CUSTOM_PROVIDERS || [];
      customProviders.push(newProvider);
      
      const saveObj = {
        CUSTOM_PROVIDERS: customProviders
      };
      
      // Auto-save the key if provided
      if (cpApiKey.value.trim()) {
        saveObj[newProvider.storageKey] = cpApiKey.value.trim();
      } else {
        saveObj[newProvider.storageKey] = ''; // explicit empty string for local
      }

      chrome.storage.local.set(saveObj, () => {
        providerSetupModal.hidden = true;
        loadAndRenderProviders();
        showToast('Custom provider added');
        chrome.runtime.sendMessage({ action: 'KEYS_CHANGED' });
      });
    });
  }

  function deleteCustomProvider(id) {
    chrome.storage.local.get(['CUSTOM_PROVIDERS'], (res) => {
      let customProviders = res.CUSTOM_PROVIDERS || [];
      const providerIndex = customProviders.findIndex(cp => cp.id === id);
      if (providerIndex > -1) {
        const cp = customProviders[providerIndex];
        customProviders.splice(providerIndex, 1);
        chrome.storage.local.remove([cp.storageKey, `${cp.id}_MODEL`], () => {
          chrome.storage.local.set({ CUSTOM_PROVIDERS: customProviders }, () => {
            loadAndRenderProviders();
            showToast('Custom provider deleted');
            chrome.runtime.sendMessage({ action: 'KEYS_CHANGED' });
          });
        });
      }
    });
  }
});
