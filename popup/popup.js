// popup/popup.js
//
// Reads chrome.storage.local directly, which is allowed here and refused in the
// panel for the same reason: setAccessLevel('TRUSTED_CONTEXTS') closes the store
// to *content scripts*, which run inside YouTube's page. This is an extension
// page, on the trusted side of that line, like the options page.
//
// It never displays a key.

import { configuredProviders, modelLabel } from '../scripts/providers.js';

const get = (keys) => new Promise((resolve) => chrome.storage.local.get(keys, resolve));
const set = (obj) => new Promise((resolve) => chrome.storage.local.set(obj, resolve));

function openOptions(hash = '') {
  chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') + hash });
  window.close();
}

// Which provider will actually be used, named for a human. A custom provider's
// name is user-supplied, so it is rendered as text and never as markup.
function activeProvider(stored) {
  const ready = configuredProviders(stored);
  if (!ready.length) return null;

  const selected = stored.SELECTED_MODEL;
  const chosen = (selected && selected !== 'auto' && ready.find((p) => p.id === selected)) || ready[0];
  return {
    name: chosen.name,
    model: modelLabel(chosen, stored[`${chosen.id}_MODEL`]),
    auto: selected === 'auto' && ready.length > 1
  };
}

function formatSaved(seconds) {
  const total = Math.max(0, Math.round(seconds || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.round((total % 3600) / 60);
  if (hours && minutes) return `${hours}h ${minutes}m`;
  if (hours) return `${hours}h`;
  return `${minutes}m`;
}

async function render() {
  const stored = await get(null);
  const provider = activeProvider(stored);

  document.getElementById('view-setup').hidden = !!provider;
  document.getElementById('view-ready').hidden = !provider;
  if (!provider) return;

  const parts = [provider.name];
  if (provider.model) parts.push(provider.model);
  if (provider.auto) parts.push('Auto');
  document.getElementById('ready-provider').textContent = parts.join(' · ');

  document.getElementById('stat-count').textContent = String(stored.SUMMARIES_COUNT || 0);
  document.getElementById('stat-saved').textContent = formatSaved(stored.SECONDS_SAVED);

  const detail = document.getElementById('detail');
  detail.value = stored.SUMMARY_LENGTH || 'standard';
  detail.addEventListener('change', () => {
    // The panel picks this up through the background's PREFS_CHANGED broadcast,
    // so an open YouTube tab follows along without a reload.
    set({ SUMMARY_LENGTH: detail.value });
  });
}

document.getElementById('start-setup').addEventListener('click', () => openOptions('#setup'));
document.getElementById('open-settings-empty').addEventListener('click', () => openOptions('#settings'));
document.getElementById('open-settings').addEventListener('click', () => openOptions());

render();
