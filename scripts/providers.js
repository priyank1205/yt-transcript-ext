// scripts/providers.js
import { GeminiClient } from './gemini-client.js';
import { OpenAICompatibleClient } from './openai-compatible-client.js';
import { AnthropicClient } from './anthropic-client.js';

/**
 * Central registry of supported LLM providers.
 * 
 * To add a new provider:
 * 1. Create a new client class extending LLMClient in `scripts/`.
 * 2. Add an entry to this PROVIDERS registry.
 * 3. Add the provider's API domain to `host_permissions` in `manifest.json`.
 */
export const PROVIDERS = {
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    description: 'Advanced reasoning & analysis',
    clientClass: GeminiClient,
    storageKey: 'GEMINI_API_KEY',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent',
    defaultModel: 'gemini-flash-lite-latest',
    defaultModelName: 'Gemini Flash-Lite Latest',
    svgIcon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81"/></svg>`,
    cssClass: 'gemini',
    helpTitle: 'How to get your Gemini API key',
    helpSteps: [
      'Open <strong>Google AI Studio</strong> and sign in with your Google account.',
      'Click <strong>Create API key</strong> (top right).',
      'Copy the key that\'s generated.',
      'Paste it in the field above and click <strong>Save</strong>.'
    ],
    helpNote: 'Gemini has a free tier — no billing setup needed to start.',
    helpLink: 'https://aistudio.google.com/apikey'
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    description: 'Advanced reasoning models',
    clientClass: OpenAICompatibleClient,
    storageKey: 'OPENAI_API_KEY',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-4o-mini',
    defaultModelName: 'GPT-4o mini',
    svgIcon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"/></svg>`,
    cssClass: 'openai',
    helpTitle: 'How to get your OpenAI API key',
    helpSteps: [
      'Go to <a href="https://platform.openai.com/api-keys" target="_blank">OpenAI API keys</a>',
      'Log in or sign up',
      'Click "Create new secret key"',
      'Copy the key and paste it here'
    ]
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Claude models',
    clientClass: AnthropicClient,
    storageKey: 'ANTHROPIC_API_KEY',
    endpoint: 'https://api.anthropic.com/v1/messages',
    defaultModel: 'claude-haiku-4-5-20251001',
    defaultModelName: 'Claude Haiku 4.5',
    svgIcon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z"/></svg>`,
    cssClass: 'anthropic',
    helpTitle: 'How to get your Anthropic API key',
    helpSteps: [
      'Go to <a href="https://console.anthropic.com/settings/keys" target="_blank">Anthropic Console</a>',
      'Log in or sign up',
      'Click "Create Key"',
      'Copy the key and paste it here'
    ]
  }
};

// Saved defaults outlive the model they name. A key that still works can sit
// beside a `<provider>_MODEL` the provider retired months ago, and the first
// sign of it is a generation failing with a 404 that reads like a bad key.
// These patterns mark such values so the background can migrate them to the
// provider's current default on update. Only the built-in providers appear
// here: a custom endpoint's model list is the user's own to maintain.
export const RETIRED_MODEL_PATTERNS = {
  gemini: [/^gemini-1\.0/i, /^gemini-1\.5/i, /^gemini-pro$/i, /^gemini-pro-vision/i],
  anthropic: [/^claude-instant/i, /^claude-2/i, /^claude-3-(haiku|sonnet|opus)/i, /^claude-3-5-(haiku|sonnet)/i]
};

// Providers that used to be built in, and the settings they leave behind.
//
// Dropping an entry from PROVIDERS above does not drop what it wrote: the key
// and the `<id>_MODEL` stay in storage, where nothing can read them and no
// settings card exists to delete them — an API key outliving the code that
// could use it. Worse, a `SELECTED_MODEL` still naming the provider no longer
// resolves, so every generation fails with "Unknown provider" until the user
// happens to open settings. Listing the id here lets the background clear both
// once, on update. Entries stay for a few releases, then go.
export const REMOVED_PROVIDERS = [
  { id: 'mistral', storageKey: 'MISTRAL_API_KEY' }
];

// Does a saved model id name something the provider has since retired?
export function isRetiredModel(providerId, modelId) {
  const patterns = RETIRED_MODEL_PATTERNS[providerId];
  if (!patterns || !modelId) return false;
  return patterns.some((pattern) => pattern.test(modelId));
}

// How a model is named to a person. The registry's friendly name is used when
// the saved model is still the provider's default, and the raw id otherwise —
// a substituted model has no friendly name and pretending otherwise would
// misreport what is actually configured.
//
// It also drops a leading word the provider name already carries, because
// "Google Gemini · Gemini Flash-Lite Latest" says Gemini twice.
export function modelLabel(provider, modelId) {
  if (!provider) return String(modelId || '');
  const id = modelId || provider.defaultModel || '';
  let label = (id && id === provider.defaultModel && provider.defaultModelName) || id;
  const firstWord = String(label).split(' ')[0];
  if (String(label).includes(' ') && String(provider.name || '').toLowerCase().includes(firstWord.toLowerCase())) {
    label = String(label).slice(firstWord.length).trim();
  }
  return label;
}

// Is this provider usable with what is in storage? A custom endpoint pointing at
// a local model is deliberately saved with an empty key, so for those the test
// is whether the storage key is present at all — not whether it is truthy.
export function hasCredential(provider, stored) {
  const key = (stored || {})[provider.storageKey];
  return !!key || (provider.isCustom && key === '');
}

// Every provider the stored settings can actually use — built-ins first, then
// saved custom endpoints. An empty result is what "not set up yet" means, and
// it is the only question the panel, the popup and the toolbar badge ask.
export function configuredProviders(stored) {
  const saved = Array.isArray(stored?.CUSTOM_PROVIDERS) ? stored.CUSTOM_PROVIDERS : [];
  const custom = saved.map((cp) => ({ ...cp, isCustom: true }));
  return [...Object.values(PROVIDERS), ...custom].filter((p) => hasCredential(p, stored));
}

// --- Key shapes --------------------------------------------------------------
//
// A pasted key already says which provider it belongs to. That is what lets
// first-run setup ask for one key instead of opening on a grid of providers
// the user has no basis to choose between.
//
// Order matters: `sk-ant-` has to be tested before the looser `sk-` that OpenAI
// and most OpenAI-compatible endpoints share. Only keys with a distinctive
// prefix belong here — a bare alphanumeric key of a given length matches far too
// much to be evidence of anything, and a wrong guess sends someone's key to the
// wrong company. Providers without a recognisable shape are reached through the
// provider list instead.
//
// A match is a hint, never a verdict — the key is still validated against the
// provider before anything is saved.
export const KEY_SHAPES = [
  { providerId: 'gemini', test: /^AIza[A-Za-z0-9_-]{30,}$/ },
  { providerId: 'anthropic', test: /^sk-ant-[A-Za-z0-9_-]{20,}$/ },
  { providerId: 'openai', test: /^sk-(?:proj-)?[A-Za-z0-9_-]{20,}$/ }
];

// Which provider does this look like? Returns a provider id, or null when the
// shape matches nothing known — in which case setup asks instead of guessing.
export function detectKeyProvider(value) {
  const key = String(value ?? '').trim();
  if (!key) return null;
  const hit = KEY_SHAPES.find((shape) => shape.test.test(key));
  return hit ? hit.providerId : null;
}

// --- Custom endpoints --------------------------------------------------------
//
// A custom provider is the one address the extension cannot know in advance, so
// it is also the only one that needs a permission at runtime. Two rules apply
// before it is saved:
//
//   * plain http is refused except on the loopback host, because a remote http
//     endpoint would carry the user's key and the video's transcript in clear
//     text over the network;
//   * the origin is turned into a match pattern, so the options page can ask
//     for access to exactly that host instead of the extension holding a
//     standing permission for every site.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function isLoopbackHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return LOOPBACK_HOSTS.has(host) || host.endsWith('.localhost');
}

/**
 * Validate a user-entered endpoint and derive the host permission it needs.
 *
 * @param {string} raw
 * @returns {{url: string, origin: string} | {error: string}}
 */
export function normalizeEndpoint(raw) {
  let text = String(raw ?? '').trim();
  if (!text) return { error: 'Enter the provider\'s endpoint URL.' };
  // A scheme that is neither http nor https is a mistake, not a host: prefixing
  // https to "ftp://host/v1" would parse as the host "ftp" and save silently.
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(text);
  if (scheme && !/^https?$/i.test(scheme[1])) {
    return { error: 'Use an http(s) endpoint URL.' };
  }
  // A bare host is the common way to type one; assume the secure scheme rather
  // than the permissive one.
  if (!scheme) text = `https://${text}`;

  let url;
  try {
    url = new URL(text);
  } catch {
    return { error: 'That endpoint is not a valid URL.' };
  }
  if (!url.hostname) return { error: 'That endpoint is not a valid URL.' };
  if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)) {
    return { error: 'Use https for a remote endpoint — http is only allowed for localhost.' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { error: 'Use an http(s) endpoint URL.' };
  }
  return { url: url.href, origin: `${url.origin}/*` };
}

// The match pattern a saved provider's requests need. Built-in providers are in
// the manifest; only a custom endpoint has an optional permission to check.
export function endpointOrigin(provider) {
  if (!provider?.isCustom || !provider.endpoint) return null;
  try {
    return `${new URL(provider.endpoint).origin}/*`;
  } catch {
    return null;
  }
}
