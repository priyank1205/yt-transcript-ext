// options/options.js

import { PROVIDERS, normalizeEndpoint, endpointOrigin, detectKeyProvider, modelLabel, configuredProviders } from '../scripts/providers.js';
import { OpenAICompatibleClient } from '../scripts/openai-compatible-client.js';

// Reusable button-content markup
const SAVE_ICON = '<svg viewBox="0 0 24 24"><path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/></svg>';
const SPINNER = '<svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:currentColor;animation:spin 0.6s linear infinite"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z" opacity=".3"/><path d="M12 2a10 10 0 0 1 10 10h-3a7 7 0 0 0-7-7z"/></svg>';
const CHECK_ICON = '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>';
const TRASH_ICON = '<svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';

// Escape a dynamic string for interpolation into an HTML template. Provider
// names, descriptions and model ids are user- or provider-supplied text, so
// they must never be able to close a tag or an attribute.
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
        // The card/list templates inject svgIcon and helpSteps as raw HTML, so
        // those fields are only ever taken from the built-in registry — a stored
        // custom provider falls back to the generic icon and no help section.
        svgIcon: undefined,
        helpTitle: undefined,
        helpSteps: undefined,
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

  function getProviderFormHTML(p, inModal = false, savedModel = null) {
    const id = escapeHtml(p.id);
    const name = escapeHtml(p.name);
    const defaultModel = escapeHtml(savedModel || p.defaultModel);
    const defaultModelLabel = escapeHtml(savedModel ? (savedModel === p.defaultModel ? (p.defaultModelName || savedModel) : savedModel) : (p.defaultModelName || p.defaultModel));
    return `
      <div class="input-group">
        <label for="${id}-api-key">API Key</label>
        <div class="input-wrapper">
          <input type="password" id="${id}-api-key" placeholder="Paste your ${name} API key" autocomplete="off" spellcheck="false">
          <button class="toggle-visibility" data-target="${id}-api-key" title="Toggle visibility">
            <svg class="eye-open" viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
            <svg class="eye-closed" viewBox="0 0 24 24" style="display:none"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>
          </button>
        </div>
      </div>
      
      <div class="input-group">
        <label for="${id}-model">Model</label>
        <div class="input-wrapper">
          <select id="${id}-model" disabled>
            <option value="${defaultModel}">${defaultModelLabel}</option>
          </select>
        </div>
      </div>

      <div class="key-hint" id="${id}-key-hint" hidden></div>
      <div class="action-row" ${inModal ? 'style="margin-top: 16px;"' : ''}>
        <button class="save-btn" id="save-${id}-key">
          <span class="btn-content">${SAVE_ICON} Save</span>
        </button>
        ${!inModal ? `<button class="remove-btn" id="remove-${id}-key" hidden>Remove</button>` : ''}
      </div>
      
      ${(!p.isCustom && !inModal) ? `
      <div class="help">
        <button class="help-toggle" id="${id}-help-toggle" aria-expanded="false" aria-controls="${id}-help">
          <span class="help-toggle-label">
            <svg viewBox="0 0 24 24"><path d="M12.65 10A5.99 5.99 0 0 0 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6a5.99 5.99 0 0 0 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/></svg>
            ${p.helpTitle}
          </span>
          <svg class="help-chevron" viewBox="0 0 24 24"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z"/></svg>
        </button>
        <div class="help-body" id="${id}-help">
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

    const id = escapeHtml(p.id);
    const cardHTML = `
      <div class="model-card" id="card-${id}">
        <div class="card-header">
          <div class="model-icon ${escapeHtml(p.cssClass || 'openai')}">
            ${svgIcon}
          </div>
          <div class="model-info">
            <div class="model-name">${escapeHtml(p.name)}</div>
            <div class="model-desc">${escapeHtml(p.description)}</div>
          </div>
          <span class="status-badge not-configured" id="${id}-status">Not set</span>
          ${p.isCustom ? `<button class="delete-custom-btn" data-id="${id}" title="Delete Provider">${TRASH_ICON}</button>` : ''}
        </div>
        ${getProviderFormHTML(p, false, res ? res[`${p.id}_MODEL`] : null)}
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
      <div class="command-item-icon ${escapeHtml(p.cssClass || 'openai')}">${svgIcon}</div>
      <div class="command-item-name">${escapeHtml(p.name)}</div>
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

  // The config view holds two different things: a built-in provider's key
  // form, and the custom-endpoint sheet. They do not look alike, so the view
  // says which one it is showing rather than styling both the same.
  function setConfigMode(custom) {
    providerConfigView.classList.toggle('cp-mode', custom);
    const icon = document.getElementById('provider-config-icon');
    const sub = document.getElementById('provider-config-subtitle');
    if (icon) icon.hidden = !custom;
    if (sub) {
      sub.textContent = custom
        ? 'Point it at any OpenAI-compatible endpoint'
        : 'Enter API details below';
    }
  }

  function openProviderConfig(p) {
    setConfigMode(false);
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
  
  
  const modalObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.attributeName === 'hidden') {
        const isHidden = mutation.target.hidden;
        if (!isHidden) {
          document.body.style.overflow = 'hidden';
        } else {
          // Check if ANY modal is open before unlocking
          if (providerSetupModal.hidden && selectorModal.hidden) {
            document.body.style.overflow = '';
          }
        }
      }
    });
  });
  
  modalObserver.observe(providerSetupModal, { attributes: true });
  modalObserver.observe(selectorModal, { attributes: true });

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
        const initialVal = savedModel || p.defaultModel;
        const initialLabel = savedModel ? (savedModel === p.defaultModel ? (p.defaultModelName || savedModel) : savedModel) : (p.defaultModelName || p.defaultModel);
        setSingleOption(p.modelSelect, initialVal, initialLabel);
      } else {
        renderSelectOptions(p, cachedModels, savedModel);
      }

      // 2. Fetch in background to update if we have an API key or if it's a custom provider (which might not need one)
      if (apiKey || p.isCustom) {
        // Show loading state ONLY if we had no cache
        if (cachedModels.length === 0) {
          setSingleOption(p.modelSelect, '', 'Loading models...');
        }
        
        // Recovery has to cover an empty list as well as a thrown error. It
        // used to handle only the throw, so a provider that answered with no
        // models left the dropdown stuck and disabled on "Loading models...".
        const restoreDefault = () => {
          if (cachedModels.length > 0) return;   // the cache is still on screen
          const initialVal = savedModel || p.defaultModel;
          const initialLabel = savedModel ? (savedModel === p.defaultModel ? (p.defaultModelName || savedModel) : savedModel) : (p.defaultModelName || p.defaultModel);
          setSingleOption(p.modelSelect, initialVal, initialLabel);
          p.modelSelect.disabled = false;
        };

        try {
          const freshModels = await p.client.fetchModels(apiKey);
          if (freshModels && freshModels.length > 0) {
            chrome.storage.local.set({ [cacheKey]: freshModels });
            renderSelectOptions(p, freshModels, savedModel);
          } else {
            console.warn(`${p.id} returned no models`);
            restoreDefault();
          }
        } catch (e) {
          console.error(`Failed to fetch fresh models for ${p.id}`, e);
          restoreDefault();
        }
      } else {
        p.modelSelect.disabled = false;
      }
    });
  }

  // Replace a <select>'s contents with one placeholder option. Model ids are
  // provider-supplied strings, so the option is built rather than interpolated.
  function setSingleOption(select, value, label) {
    select.textContent = '';
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    select.appendChild(opt);
  }

  function renderSelectOptions(p, modelsList, savedModel) {
    p.modelSelect.textContent = '';
    modelsList.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name;
      p.modelSelect.appendChild(opt);
    });
    
    let targetModel = null;
    if (savedModel && modelsList.some(m => m.id === savedModel)) {
      targetModel = modelsList.find(m => m.id === savedModel);
    } else {
      if (p.id === 'gemini') {
        targetModel = modelsList.find(m => m.name === 'Gemini Flash-Lite Latest')
          || modelsList.find(m => m.id === 'gemini-flash-lite-latest')
          || modelsList.find(m => m.id === p.defaultModel)
          || (p.defaultModelName && modelsList.find(m => m.name === p.defaultModelName))
          || modelsList.find(m => m.name?.toLowerCase().includes('flash-lite latest'))
          || modelsList.find(m => m.id?.toLowerCase().includes('flash-lite-latest'))
          || modelsList.find(m => m.name?.toLowerCase().includes('flash-lite'))
          || modelsList.find(m => m.id?.toLowerCase().includes('flash-lite'));
      } else {
        targetModel = modelsList.find(m => m.id === p.defaultModel)
          || (p.defaultModelName && modelsList.find(m => m.name === p.defaultModelName));
      }

      if (!targetModel && modelsList.length > 0) {
        targetModel = modelsList[0];
      }
    }

    if (targetModel) {
      p.modelSelect.value = targetModel.id;
      // Persist whenever the resolved value differs from what is stored — not
      // only on a first save. A saved model the provider has since dropped
      // resolves to a fallback here; leaving storage alone meant the dropdown
      // showed the fallback while generation kept using the retired id.
      if (targetModel.id !== savedModel) {
        chrome.storage.local.set({ [`${p.id}_MODEL`]: targetModel.id });
      }
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
          <div class="command-item-icon ${escapeHtml(p.cssClass || 'openai')}">${svgIcon}</div>
          <div class="command-item-name">${escapeHtml(p.name)}</div>
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

  // --- Appearance (panel design skin) ---
  const skinSegmented = document.getElementById('skin-segmented');
  if (skinSegmented) {
    const skinOptions = skinSegmented.querySelectorAll('.segmented-option');
    const setActiveSkin = (pref) => {
      skinOptions.forEach((o) =>
        o.setAttribute('aria-checked', o.dataset.skin === pref ? 'true' : 'false')
      );
    };
    chrome.storage.local.get(['PANEL_SKIN'], (res) => setActiveSkin(res.PANEL_SKIN || 'quiet'));
    skinOptions.forEach((o) => {
      o.addEventListener('click', () => {
        const pref = o.dataset.skin;
        setActiveSkin(pref);
        chrome.storage.local.set({ PANEL_SKIN: pref });
        showToast(`Panel design: ${o.textContent}`);
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

  // --- Custom endpoint permissions -------------------------------------------
  //
  // The extension ships with host access to YouTube and the three built-in
  // provider APIs, and nothing else. A custom endpoint is whatever the user
  // types, so its access is asked for at the moment they save it and revoked
  // when the provider is deleted. Chrome only shows the prompt during a user
  // gesture, so these run straight out of the click handler, before any await.
  function requestEndpointAccess(origin) {
    if (!origin || !chrome.permissions?.request) return Promise.resolve(true);
    return new Promise((resolve) => {
      chrome.permissions.request({ origins: [origin] }, (granted) => {
        void chrome.runtime.lastError;
        resolve(!!granted);
      });
    });
  }

  // Give back access to a host no saved provider points at any more.
  async function releaseEndpointAccess(origin, remaining) {
    if (!origin || !chrome.permissions?.remove) return;
    if (remaining.some((cp) => endpointOrigin(cp) === origin)) return;
    try {
      await chrome.permissions.remove({ origins: [origin] });
    } catch { /* Chrome refuses to drop a permission it never granted. */ }
  }

  async function handleSave(p) {
    const key = p.input.value.trim();
    if (!key && !p.isCustom) {
      p.input.focus();
      flashInvalid(p.input);
      return;
    }

    // A saved custom provider can lose its host access (revoked in Chrome's own
    // extension settings, or declined when it was added). Ask first, before any
    // await spends the click's user gesture — Chrome resolves this immediately,
    // without a prompt, when the permission is already held. Validation below is
    // the first request that would fail without it.
    const origin = endpointOrigin(p);
    if (origin && !(await requestEndpointAccess(origin))) {
      showToast(`Chrome needs permission to reach ${new URL(p.endpoint).origin}`);
      flashInvalid(p.input);
      return;
    }

    p.saveBtn.disabled = true;
    setBtn(p.saveBtn, SPINNER, 'Validating...');

    // Validate against the model this key will actually be used with, and treat
    // the outcomes separately. "The key is rejected", "the key works but that
    // model doesn't", and "nothing answered" are three different problems, and
    // reporting all of them as an invalid key sent people to regenerate a key
    // that was never the issue.
    // Custom providers with empty key shouldn't fail validation immediately if local
    const result = p.isCustom && !key
      ? { status: 'valid' }
      : await p.client.validateKey(key, p.modelSelect?.value || p.defaultModel);

    if (!p.isCustom && result.status !== 'valid' && result.status !== 'model_unavailable') {
      const message = result.status === 'unreachable'
        ? `Couldn't reach ${p.name}. Check your connection and try again.`
        : result.status === 'endpoint'
          ? 'That URL is not a chat-completions endpoint.'
          : 'Invalid API key';
      p.saveBtn.disabled = false;
      setBtn(p.saveBtn, SAVE_ICON, 'Save');
      updateStatus(p.status, 'invalid');
      showToast(message);
      flashInvalid(p.input);
      return;
    }

    p.saveBtn.classList.add('saving');
    setBtn(p.saveBtn, SPINNER, 'Saving...');

    const updates = { [p.storageKey]: key };
    const stored = await new Promise(resolve => chrome.storage.local.get([`${p.id}_MODEL`], resolve));
    let savedMessage = `${p.name} key saved`;

    if (result.status === 'model_unavailable') {
      // The key works; the model it was checked against does not. Replace the
      // saved id with the current default so generation isn't left pointing at
      // a model the provider has retired, and say which one failed.
      updates[`${p.id}_MODEL`] = p.defaultModel;
      savedMessage = `Key saved — ${result.model} is unavailable, so pick another model`;
    } else if (!stored[`${p.id}_MODEL`]) {
      const defaultVal = p.modelSelect?.value || p.defaultModel;
      if (defaultVal) updates[`${p.id}_MODEL`] = defaultVal;
    }

    chrome.storage.local.set(updates, () => {
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
        showToast(savedMessage);
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
    // The custom-provider sheet wraps its controls, and keeps the model list in
    // a hidden input, so what has to light up is the row rather than the field.
    const row = input.closest ? input.closest('.cp-fr') : null;
    if (row) {
      // Nothing is served by flashing a field that is folded out of sight.
      const folded = row.closest('.cp-advanced');
      if (folded && folded.hidden) {
        folded.hidden = false;
        const toggle = document.getElementById('cp-advanced-toggle');
        if (toggle) toggle.setAttribute('aria-expanded', 'true');
      }
      row.classList.add('cp-bad');
      setTimeout(() => row.classList.remove('cp-bad'), 1500);
      return;
    }
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
      setConfigMode(true);
      providerConfigTitle.textContent = 'Custom provider';
      providerConfigBody.innerHTML = '';
      providerConfigBody.appendChild(customProviderTemplate.content.cloneNode(true));

      providerListView.hidden = true;
      providerConfigView.hidden = false;

      initCustomProviderForm();
      document.getElementById('save-custom-provider-btn').addEventListener('click', handleSaveCustomProvider);
    });
  }


  // Models are a set, not a sentence. Chips say so, while the hidden input
  // keeps the comma-separated form the save handler already reads — so the
  // storage shape never has to know the field was rebuilt.
  function initCustomProviderForm() {
    const tags = document.getElementById('cp-tags');
    const tagInput = document.getElementById('cp-model-input');
    const hidden = document.getElementById('cp-models');
    const models = [];

    function render() {
      tags.querySelectorAll('.cp-tag').forEach((t) => t.remove());
      models.forEach((m, i) => {
        const tag = document.createElement('span');
        tag.className = i === 0 ? 'cp-tag first' : 'cp-tag';
        tag.appendChild(document.createTextNode(m));
        const drop = document.createElement('button');
        drop.type = 'button';
        drop.textContent = '\u00d7';
        drop.setAttribute('aria-label', `Remove ${m}`);
        // Removing by value, not by the index this row was rendered at: every
        // removal re-renders, and a captured index is stale the moment it does.
        drop.addEventListener('click', () => {
          const at = models.indexOf(m);
          if (at > -1) models.splice(at, 1);
          render();
          tagInput.focus();
        });
        tag.appendChild(drop);
        tags.insertBefore(tag, tagInput);
      });
      hidden.value = models.join(', ');
      tagInput.placeholder = models.length ? 'Add another' : 'deepseek-chat';
    }

    function commit() {
      tagInput.value.split(',').map((m) => m.trim()).filter(Boolean).forEach((m) => {
        if (!models.includes(m)) models.push(m);
      });
      tagInput.value = '';
      render();
    }

    tagInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); return; }
      // Backspace on an empty field takes back the last chip, which is what
      // every other chip field does.
      if (e.key === 'Backspace' && !tagInput.value && models.length) { models.pop(); render(); }
    });
    tagInput.addEventListener('blur', commit);
    tags.addEventListener('click', (e) => { if (e.target === tags) tagInput.focus(); });
    render();

    // What the endpoint resolves to, said out loud before anything is saved —
    // including the host Chrome is about to ask permission for.
    const endpoint = document.getElementById('cp-endpoint');
    const resolve = document.getElementById('cp-resolve');
    const resolveHost = document.getElementById('cp-resolve-host');
    const resolveState = document.getElementById('cp-resolve-state');
    const shieldHost = document.getElementById('cp-host');
    endpoint.addEventListener('input', () => {
      const raw = endpoint.value.trim();
      if (!raw) {
        resolve.hidden = true;
        shieldHost.textContent = 'that host';
        return;
      }
      const parsed = normalizeEndpoint(raw);
      resolve.hidden = false;
      if (parsed.error) {
        resolveHost.textContent = raw.length > 40 ? `${raw.slice(0, 40)}\u2026` : raw;
        resolveState.textContent = `\u00b7 ${parsed.error}`;
        resolveState.className = 'bad';
        shieldHost.textContent = 'that host';
        return;
      }
      const url = new URL(parsed.url);
      resolveHost.textContent = url.host;
      resolveState.textContent = url.protocol === 'http:' ? '\u00b7 localhost' : '\u00b7 https';
      resolveState.className = '';
      shieldHost.textContent = url.host;
    });

    // Headers are for the one person in a hundred who needs them, so they
    // start folded away rather than making the sheet longer for everyone.
    const advToggle = document.getElementById('cp-advanced-toggle');
    const advPanel = document.getElementById('cp-advanced');
    if (advToggle && advPanel) {
      advToggle.addEventListener('click', () => {
        const open = advPanel.hidden;
        advPanel.hidden = !open;
        advToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }

    const cancel = document.getElementById('cp-cancel');
    if (cancel) {
      cancel.addEventListener('click', () => {
        providerSetupModal.hidden = true;
        setConfigMode(false);
      });
    }
  }

  function handleSaveCustomProvider() {
    const cpName = document.getElementById('cp-name');
    const cpEndpoint = document.getElementById('cp-endpoint');
    const cpApiKey = document.getElementById('cp-api-key');
    const cpModels = document.getElementById('cp-models');
    const cpHeaders = document.getElementById('cp-headers');
    const name = cpName.value.trim();
    const modelsList = cpModels.value.trim();
    if (!name || !cpEndpoint.value.trim() || !modelsList) {
      if (!name) flashInvalid(cpName);
      if (!cpEndpoint.value.trim()) flashInvalid(cpEndpoint);
      if (!modelsList) flashInvalid(cpModels);
      return;
    }

    // A bare host becomes https, and plain http is refused anywhere but
    // localhost: a remote http endpoint would carry this key and every
    // transcript in clear text.
    const parsed = normalizeEndpoint(cpEndpoint.value);
    if (parsed.error) {
      flashInvalid(cpEndpoint);
      showToast(parsed.error);
      return;
    }
    const endpoint = parsed.url;
    
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

    // The extension holds no standing permission for this host, so ask for one
    // now — straight out of the click, which is what lets Chrome show the
    // prompt. Declining is a real answer: the provider is not saved, because it
    // could never be reached.
    requestEndpointAccess(parsed.origin).then((granted) => {
      if (!granted) {
        flashInvalid(cpEndpoint);
        showToast(`Chrome needs permission to reach ${new URL(endpoint).origin}`);
        return;
      }
      saveCustomProvider(newProvider, cpApiKey.value.trim());
    });
  }

  function saveCustomProvider(newProvider, apiKey) {
    chrome.storage.local.get(['CUSTOM_PROVIDERS'], (res) => {
      const customProviders = res.CUSTOM_PROVIDERS || [];
      customProviders.push(newProvider);
      
      const saveObj = {
        CUSTOM_PROVIDERS: customProviders
      };
      
      // Auto-save the key if provided
      if (apiKey) {
        saveObj[newProvider.storageKey] = apiKey;
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
        // Nothing points at that host any more, so the extension should not
        // keep the access it was granted for it.
        releaseEndpointAccess(endpointOrigin(cp), customProviders);
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

  // ======================================================================
  // First-run setup
  //
  // Three screens, one question each, shown in place of the settings shell.
  // It deliberately owns a small amount of duplicated save logic rather than
  // reaching into the provider cards: those are built from the DOM for the
  // settings UI, and the flow needs to run before any of them exist.
  //
  // Only built-in providers are handled here. "I run my own model" hands over
  // to the existing custom-provider form, which is also the thing that knows
  // how to ask for the optional host permission.
  // ======================================================================
  const setupView = document.getElementById('setup-view');

  function initSetupFlow() {
    if (!setupView) return;

    // Each screen carries its own progress bar, already in the right state,
    // so there is nothing here to keep in sync.
    const screens = Array.from(setupView.querySelectorAll('.setup-screen'));
    const screen2 = setupView.querySelector('.su-2');
    const guide = document.getElementById('su-guide');
    const pasteBlock = document.getElementById('su-paste-block');
    const themeBox = document.getElementById('su-theme');
    const keyInput = document.getElementById('su-key');
    const connectBtn = document.getElementById('su-connect');
    const keyHint = document.getElementById('su-key-hint');
    const errorBox = document.getElementById('su-error');
    const errorTitle = document.getElementById('su-error-title');
    const errorDetail = document.getElementById('su-error-detail');
    const errorCauses = document.getElementById('su-error-causes');
    const aisCard = document.getElementById('su-ais');
    const openRow = document.getElementById('su-open-row');
    const pickBox = document.getElementById('su-pick');
    const customRow = document.getElementById('su-custom-row');

    // The branch the user picked on screen 1, and only that: 'gemini' for the
    // recommended path, null for "I already pay for an AI", where the key's own
    // shape is the only thing that says which provider it is. Detection never
    // writes to it — otherwise a half-typed key gets described against whichever
    // provider was pasted before it.
    let chosen = 'gemini';
    let busy = false;

    // "a Google Gemini key" but "an OpenAI key".
    const article = (name) => (/^[AEIOU]/i.test(name) ? 'an' : 'a');

    let settleTimer = 0;
    function showScreen(n) {
      screens.forEach((sc) => sc.classList.toggle('active', sc.dataset.screen === String(n)));
      if (n === 2 && keyInput) keyInput.focus();
      // Arriving at the finish starts the sequence; a beat after it would have
      // ended, it is called off, so the screen is never left waiting on frames
      // that a background tab was never given.
      const done = screens.find((sc) => sc.dataset.screen === '3');
      if (done) {
        clearTimeout(settleTimer);
        done.classList.remove('su-settled');
        if (n === 3) settleTimer = setTimeout(() => done.classList.add('su-settled'), 1800);
      }
      // The path can only be measured once the screen it lives on has been laid
      // out, which is the frame after this one.
      requestAnimationFrame(drawGuide);
    }

    function openSetup() {
      setupView.hidden = false;
      document.body.classList.add('setup-on');
      applySetupTheme(setupTheme);
      startedAt = Date.now();
      showScreen(1);
    }

    function closeSetup() {
      setupView.hidden = true;
      document.body.classList.remove('setup-on');
      // The settings page behind this is dark; leaving the light tokens on the
      // body would hand the provider sheet the wrong theme for its backdrop.
      document.body.classList.remove('setup-light');
      if (location.hash === '#setup') history.replaceState(null, '', location.pathname);
    }

    // --- appearance ------------------------------------------------------
    // Dark by default, because that is what the rest of settings is. The
    // choice is remembered, and only ever applied while first run is showing.
    let setupTheme = 'dark';
    function applySetupTheme(mode) {
      document.body.classList.toggle('setup-light', mode === 'light');
      if (themeBox) {
        themeBox.querySelectorAll('button').forEach((b) =>
          b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
      }
    }
    chrome.storage.local.get(['SETUP_THEME'], (res) => {
      setupTheme = res.SETUP_THEME === 'light' ? 'light' : 'dark';
      if (!setupView.hidden) applySetupTheme(setupTheme);
      else if (themeBox) {
        themeBox.querySelectorAll('button').forEach((b) =>
          b.setAttribute('aria-pressed', String(b.dataset.mode === setupTheme)));
      }
    });
    if (themeBox) {
      themeBox.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn || !btn.dataset.mode) return;
        setupTheme = btn.dataset.mode;
        applySetupTheme(setupTheme);
        chrome.storage.local.set({ SETUP_THEME: setupTheme });
      });
    }

    // --- the numbered path ------------------------------------------------
    // Step 1 is in the form, 2 and 3 are in the panel, 4 is back in the form.
    // The two curves that join them are measured from the real boxes, so they
    // keep pointing at the card however the copy wraps or the window resizes —
    // and they are not drawn at all when there is no errand to sequence.
    function curve(x1, y1, x2, y2, bow) {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const c1x = x1 + dx * 0.35 + nx * bow;
      const c1y = y1 + dy * 0.35 + ny * bow;
      const c2x = x1 + dx * 0.68 + nx * bow;
      const c2y = y1 + dy * 0.68 + ny * bow;
      const angle = Math.atan2(y2 - c2y, x2 - c2x);
      const n = (v) => v.toFixed(1);
      const barb = (a) => `${n(x2 + Math.cos(a) * 10)},${n(y2 + Math.sin(a) * 10)}`;
      return `<path d="M ${n(x1)} ${n(y1)} C ${n(c1x)} ${n(c1y)}, ${n(c2x)} ${n(c2y)}, ${n(x2)} ${n(y2)}"/>` +
        `<polyline points="${barb(angle + 2.618)} ${n(x2)},${n(y2)} ${barb(angle - 2.618)}"/>`;
    }

    function drawGuide() {
      if (!guide || !screen2) return;
      const card = document.querySelector('#su-ais .su-stepcard');
      const one = openRow ? openRow.querySelector('.su-sn') : null;
      const four = pasteBlock ? pasteBlock.querySelector('.su-sn') : null;
      const live = screen2.classList.contains('active') && screen2.dataset.branch === 'gemini';
      if (!live || !card || !one || !four) { guide.innerHTML = ''; return; }

      const box = screen2.getBoundingClientRect();
      const c = card.getBoundingClientRect();
      const a = one.getBoundingClientRect();
      const b = four.getBoundingClientRect();
      // Narrow window: the panel sits above the form rather than beside it, and
      // a path across a divider that is no longer there would be nonsense.
      if (c.right > a.left) { guide.innerHTML = ''; return; }

      const x = (v) => v - box.left;
      const y = (v) => v - box.top;
      guide.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
      guide.setAttribute('preserveAspectRatio', 'none');
      guide.innerHTML =
        curve(x(a.left) - 8, y(a.top + a.height / 2), x(c.right) + 10, y(c.top) + 46, 22) +
        curve(x(c.right) + 8, y(c.bottom) - 6, x(b.left) - 8, y(b.top + b.height / 2), 22);
    }

    let guideFrame = 0;
    window.addEventListener('resize', () => {
      cancelAnimationFrame(guideFrame);
      guideFrame = requestAnimationFrame(drawGuide);
    });

    // --- the finish -------------------------------------------------------
    // Pieces are placed where they land, so with reduced motion the screen is
    // simply correct and still rather than empty.
    let startedAt = 0;
    const CONFETTI = [
      [6, 18, 7, 11, 0, -24], [15, 52, 5, 5, 1, 0], [13, 8, 6, 10, 1, 34], [24, 72, 6, 9, 0, 18],
      [27, 26, 5, 5, 2, 0], [35, 4, 7, 11, 1, -12], [41, 60, 6, 9, 0, 42], [47, 14, 5, 5, 0, 0],
      [56, 68, 7, 10, 1, -30], [62, 22, 6, 9, 0, 12], [68, 54, 5, 5, 1, 0], [73, 6, 7, 11, 0, 26],
      [79, 40, 6, 9, 2, -18], [85, 70, 5, 5, 0, 0], [90, 20, 7, 10, 1, 36], [95, 56, 6, 9, 0, -8],
      [3, 62, 5, 5, 1, 0], [50, 84, 6, 9, 0, -40], [33, 88, 5, 5, 2, 0], [70, 86, 7, 10, 1, 16]
    ];
    const CONFETTI_INK = ['var(--su-red)', 'var(--su-yel)', 'var(--su-grn)'];
    // Rebuilt every time, so finishing again throws it again rather than
    // leaving last time's pieces lying where they landed.
    function dropConfetti() {
      const box = document.getElementById('su-confetti');
      if (!box) return;
      box.textContent = '';
      const area = box.getBoundingClientRect();
      if (!area.width) return;
      CONFETTI.forEach((bit, i) => {
        const [left, top, w, h, ink, rot] = bit;
        const el = document.createElement('i');
        if (w === h) el.className = 'dot';
        // Every piece is thrown from behind the badge — the middle of this
        // layer — and lands where it was placed.
        const fromX = Math.round((0.5 - left / 100) * area.width);
        const fromY = Math.round((0.5 - top / 100) * area.height);
        el.style.cssText = `left:${left}%;top:${top}%;width:${w}px;height:${h}px;` +
          `background:${CONFETTI_INK[ink]};--su-r:${rot}deg;` +
          `--su-sx:${fromX}px;--su-sy:${fromY}px;` +
          `--su-t:${(0.34 + (i % 8) * 0.028).toFixed(3)}s`;
        box.appendChild(el);
      });
    }

    // Screen one promises about two minutes. This answers it with the real
    // number — but only when the number is worth saying: a tab left open over
    // lunch is not a setup time, and neither is a key pasted in four seconds.
    function elapsedLabel() {
      if (!startedAt) return null;
      const secs = Math.round((Date.now() - startedAt) / 1000);
      if (secs < 15 || secs > 900) return null;
      return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    }

    // --- screen 1: the question ----------------------------------------
    setupView.querySelectorAll('.su-choice').forEach((btn) => {
      btn.addEventListener('click', () => {
        const choice = btn.dataset.choice;
        const bringsOwnKey = choice === 'existing';
        chosen = bringsOwnKey ? null : 'gemini';
        // One attribute drives every difference between the two paths — the
        // panel's contents, the step numbers, and whether the path is drawn.
        if (screen2) screen2.dataset.branch = bringsOwnKey ? 'existing' : 'gemini';
        if (aisCard) aisCard.hidden = bringsOwnKey;
        if (openRow) openRow.hidden = bringsOwnKey;
        document.getElementById('su-s2-title').textContent =
          bringsOwnKey ? 'Paste your API key' : 'Get a free key from Google';
        document.getElementById('su-s2-lead').textContent = bringsOwnKey
          ? "We'll work out which provider it came from."
          : 'Two clicks in Google AI Studio, then come back to this tab. Nothing on that page needs filling in.';
        // Anyone bringing their own key might be bringing it from somewhere we
        // have never heard of, including a model on their own machine, so the
        // way out to a custom endpoint belongs on that branch and only there.
        if (customRow) customRow.hidden = !bringsOwnKey;
        resetKeyState();
        showScreen(2);
      });
    });

    // The custom-endpoint form is the only place that knows how to ask for
    // access to a host the manifest cannot name, so both routes lead to it
    // rather than reimplementing it inside the flow.
    function openCustomProvider() {
      closeSetup();
      showPane('providers');
      const addBtn = document.getElementById('add-provider-btn');
      const customItem = document.getElementById('add-custom-provider-item');
      if (addBtn) addBtn.click();
      if (customItem) customItem.click();
    }

    // Everything this flow does not name by itself lives in the provider list,
    // which also offers the custom form as its own last entry.
    function openProviderList() {
      closeSetup();
      showPane('providers');
      const addBtn = document.getElementById('add-provider-btn');
      if (addBtn) addBtn.click();
    }

    const customLink = document.getElementById('su-custom-link');
    if (customLink) customLink.addEventListener('click', openCustomProvider);

    const whatToggle = document.getElementById('su-what-toggle');
    const whatDrawer = document.getElementById('su-what');
    if (whatToggle && whatDrawer) {
      whatToggle.addEventListener('click', () => {
        const open = whatDrawer.hidden;
        whatDrawer.hidden = !open;
        whatToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }

    setupView.querySelectorAll('[data-goto]').forEach((btn) => {
      btn.addEventListener('click', () => showScreen(Number(btn.dataset.goto)));
    });

    // --- screen 2: fetch, paste, connect --------------------------------
    const openStudio = document.getElementById('su-open-studio');
    if (openStudio) {
      openStudio.addEventListener('click', () => {
        window.open(PROVIDERS.gemini.helpLink, '_blank', 'noopener');
      });
    }

    function resetKeyState() {
      if (keyInput) keyInput.value = '';
      if (connectBtn) connectBtn.disabled = true;
      if (errorBox) errorBox.hidden = true;
      if (pickBox) pickBox.hidden = true;
      setRestingHint();
    }

    // Two fixed strings, and the only place caption yellow appears in the
    // whole flow: on the shape of the key itself.
    function restingHint() {
      return chosen === 'gemini'
        ? 'A Gemini key starts with <code>AIza</code> and runs about 39 characters.'
        : "Paste your key \u2014 we'll work out which provider it came from.";
    }

    function setHint(text, tone) {
      if (!keyHint) return;
      keyHint.textContent = text;
      keyHint.className = 'su-hint' + (tone ? ' ' + tone : '');
    }

    function setRestingHint() {
      if (!keyHint) return;
      keyHint.innerHTML = restingHint();
      keyHint.className = 'su-hint';
    }

    // The shape of a pasted key already says which provider it belongs to,
    // which is what lets this screen ask for a key instead of opening on a
    // grid of providers. It is a hint: the key is still validated below.
    function onKeyTyped() {
      const value = keyInput.value.trim();
      connectBtn.disabled = !value || busy;
      if (errorBox) errorBox.hidden = true;
      if (pickBox) pickBox.hidden = true;
      if (!value) { setRestingHint(); return; }

      const detected = detectKeyProvider(value);
      if (detected && PROVIDERS[detected]) {
        const name = PROVIDERS[detected].name;
        setHint(`Recognised — that looks like ${article(name)} ${name} key.`, 'ok');
      } else if (chosen && PROVIDERS[chosen]) {
        const name = PROVIDERS[chosen].name;
        setHint(`Doesn't look like ${article(name)} ${name} key yet — check the whole line was copied.`, '');
      } else {
        setHint("That doesn't match a key shape we know. Connect anyway and we'll ask the provider.", '');
      }
    }

    if (keyInput) {
      keyInput.addEventListener('input', onKeyTyped);
      keyInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !connectBtn.disabled) connect();
      });
    }
    if (connectBtn) connectBtn.addEventListener('click', connect);

    function showError(title, detail, causes) {
      if (!errorBox) return;
      errorTitle.textContent = title;
      errorDetail.textContent = detail;
      errorCauses.innerHTML = '';
      (causes || []).forEach((cause) => {
        const li = document.createElement('li');
        li.textContent = cause;
        errorCauses.appendChild(li);
      });
      errorBox.hidden = false;
    }

    async function connect() {
      const key = keyInput.value.trim();
      if (!key || busy) return;
      // Detection first, then the branch the user picked — and nothing after
      // that. Falling back to Gemini here meant a stranger's OpenAI key was
      // sent to Google, which then reported it as a bad Gemini key.
      const providerId = detectKeyProvider(key) || chosen;
      const provider = providerId ? PROVIDERS[providerId] : null;
      if (!provider) {
        setHint('', '');
        if (pickBox) pickBox.hidden = false;
        return;
      }
      if (pickBox) pickBox.hidden = true;

      busy = true;
      connectBtn.disabled = true;
      connectBtn.textContent = 'Checking…';
      if (errorBox) errorBox.hidden = true;
      setHint(`Asking ${provider.name} whether this key works…`, '');

      let result;
      try {
        const client = new provider.clientClass(provider);
        result = await client.validateKey(key, provider.defaultModel);
      } catch {
        result = { status: 'unreachable' };
      }

      busy = false;
      connectBtn.textContent = 'Connect';
      connectBtn.disabled = false;

      if (result.status === 'valid' || result.status === 'model_unavailable') {
        // A key can be perfectly good while the provider's own default model is
        // not on its plan — a free or entry tier that cannot reach the flagship
        // model is exactly that, and it used to come back as "<provider> did not
        // accept that key". Validation now returns what the key *can* reach, so
        // save one of those instead of blaming the key.
        let model = provider.defaultModel;
        let substituted = false;
        if (result.status === 'model_unavailable') {
          const ids = (result.models || [])
            .map((m) => (typeof m === 'string' ? m : m.id))
            .filter(Boolean);
          if (ids.length) {
            model = pickModel(ids, provider.defaultModel);
            substituted = true;
          }
        }
        await new Promise((r) => chrome.storage.local.set({
          [provider.storageKey]: key,
          [`${provider.id}_MODEL`]: model
        }, r));
        chrome.runtime.sendMessage({ action: 'KEYS_CHANGED' });
        finish(provider, model, substituted);
        return;
      }

      if (result.status === 'unreachable') {
        setHint('', '');
        showError("Couldn't reach " + provider.name + '.',
          'The key was not checked, and nothing was saved. This is usually a network or firewall problem rather than the key.',
          ['Check your connection and press Connect again.']);
        return;
      }

      setHint('', '');
      showError(provider.name + ' did not accept that key.',
        'The key was read but came back unauthorised. Nothing was saved. Two things cause this almost every time:',
        [
          `Only part of the key was copied — yours is ${key.length} characters.`,
          'The key belongs to an account or project where this model is not enabled.'
        ]);
    }

    // The built-in defaults are all flash/mini/small-class models, so when a
    // substitute is needed, pick from the same end of the range rather than
    // silently signing someone up to the most expensive model they can reach.
    function pickModel(ids, preferred) {
      if (ids.includes(preferred)) return preferred;
      for (const hint of ['flash-lite', 'flash', 'mini', 'small', 'haiku', 'lite']) {
        const hit = ids.find((id) => id.toLowerCase().includes(hint));
        if (hit) return hit;
      }
      return ids[0];
    }

    // --- screen 3: the payoff -------------------------------------------
    function finish(provider, model, substituted) {
      const chip = document.getElementById('su-done-chip');
      if (chip) chip.textContent = `${provider.name} · ${modelLabel(provider, model)}`;
      const stat = document.getElementById('su-stat');
      const elapsed = elapsedLabel();
      if (stat) {
        stat.hidden = !elapsed;
        if (elapsed) document.getElementById('su-elapsed').textContent = elapsed;
      }
      if (substituted) {
        document.getElementById('su-done-lead').textContent =
          `Your key works. ${provider.defaultModelName || provider.defaultModel} isn't on your plan, so it's set to ${model} instead — change it any time under AI providers.`;
      }
      showScreen(3);
      // The layer has no size until the screen it lives on is laid out, and
      // the throw is measured from its middle.
      requestAnimationFrame(dropConfetti);
      loadAndRenderProviders();
    }

    if (pickBox) {
      pickBox.querySelectorAll('[data-pick]').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (btn.dataset.pick === 'more') { openProviderList(); return; }
          chosen = btn.dataset.pick;
          pickBox.hidden = true;
          connect();
        });
      });
    }

    const gotoYouTube = document.getElementById('su-goto-youtube');
    if (gotoYouTube) {
      gotoYouTube.addEventListener('click', () => {
        chrome.tabs.create({ url: 'https://www.youtube.com/' });
        closeSetup();
      });
    }
    const gotoSettings = document.getElementById('su-goto-settings');
    if (gotoSettings) gotoSettings.addEventListener('click', closeSetup);

    const skip = document.getElementById('su-skip');
    if (skip) skip.addEventListener('click', closeSetup);

    // Where the flow comes from, in order of precedence:
    //   #setup     — asked for by name (install, the panel's button, the popup)
    //   #settings  — explicitly declined; show the settings page
    //   no hash    — show it when there is no key, which is the only state in
    //                which this extension cannot do anything at all. That covers
    //                the gear in the panel and Chrome's own Options menu without
    //                either of them having to know about the flow.
    (async () => {
      if (location.hash === '#settings') return;
      if (location.hash === '#setup') { openSetup(); return; }
      const stored = await new Promise((r) => chrome.storage.local.get(null, r));
      if (!configuredProviders(stored).length) openSetup();
    })();
  }

  initSetupFlow();

});
