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
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent',
    defaultModel: 'gemini-3.1-flash-lite-preview',
    svgIcon: `<svg viewBox="0 0 24 24"><path d="M12 2c.774 0 .949.711 1.173 1.292c.15.387.367.922.639 1.51c.559 1.21 1.294 2.526 2.077 3.31c.783.782 2.1 1.518 3.308 2.076c.589.272 1.124.49 1.511.64c.567.218 1.292.43 1.292 1.172c0 .774-.711.949-1.292 1.173c-.387.15-.922.367-1.51.639c-1.21.559-2.526 1.294-3.31 2.077c-.782.783-1.517 2.1-2.076 3.308a27 27 0 0 0-.64 1.511C12.95 21.286 12.769 22 12 22c-.761 0-.951-.718-1.173-1.292a26 26 0 0 0-.639-1.51c-.558-1.21-1.294-2.526-2.077-3.31c-.783-.782-2.1-1.517-3.308-2.076a26 26 0 0 0-1.511-.64C2.712 12.95 2 12.774 2 12s.711-.949 1.292-1.173c.387-.15.922-.367 1.51-.639c1.21-.558 2.526-1.294 3.31-2.077c.782-.783 1.518-2.1 2.076-3.308c.272-.589.49-1.124.64-1.511C11.047 2.719 11.235 2 12 2"/></svg>`,
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
    svgIcon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`, // Placeholder or simple SVG
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
    defaultModel: 'claude-3-5-haiku-latest',
    svgIcon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 22h20L12 2z"/></svg>`, // Placeholder SVG
    cssClass: 'anthropic',
    helpTitle: 'How to get your Anthropic API key',
    helpSteps: [
      'Go to <a href="https://console.anthropic.com/settings/keys" target="_blank">Anthropic Console</a>',
      'Log in or sign up',
      'Click "Create Key"',
      'Copy the key and paste it here'
    ]
  },
  mistral: {
    id: 'mistral',
    name: 'Mistral AI',
    description: 'Fast & efficient transcripts',
    clientClass: OpenAICompatibleClient,
    storageKey: 'MISTRAL_API_KEY',
    endpoint: 'https://api.mistral.ai/v1/chat/completions',
    defaultModel: 'mistral-large-latest',
    svgIcon: `<svg viewBox="0 0 256 233"><path d="M186.182 0h46.545v46.545h-46.545z"/><path fill="#f7d046" d="M209.455 0H256v46.545h-46.545z"/><path d="M0 0h46.545v46.545H0zm0 46.545h46.545V93.09H0zm0 46.546h46.545v46.545H0zm0 46.545h46.545v46.545H0zm0 46.546h46.545v46.545H0z"/><path fill="#f7d046" d="M23.273 0h46.545v46.545H23.273z"/><path fill="#f2a73b" d="M209.455 46.545H256V93.09h-46.545zm-186.182 0h46.545V93.09H23.273z"/><path d="M139.636 46.545h46.545V93.09h-46.545z"/><path fill="#f2a73b" d="M162.909 46.545h46.545V93.09h-46.545zm-93.091 0h46.545V93.09H69.818z"/><path fill="#ee792f" d="M116.364 93.091h46.545v46.545h-46.545zm46.545 0h46.545v46.545h-46.545zm-93.091 0h46.545v46.545H69.818z"/><path d="M93.091 139.636h46.545v46.545H93.091z"/><path fill="#eb5829" d="M116.364 139.636h46.545v46.545h-46.545z"/><path fill="#ee792f" d="M209.455 93.091H256v46.545h-46.545zm-186.182 0h46.545v46.545H23.273z"/><path d="M186.182 139.636h46.545v46.545h-46.545z"/><path fill="#eb5829" d="M209.455 139.636H256v46.545h-46.545z"/><path d="M186.182 186.182h46.545v46.545h-46.545z"/><path fill="#eb5829" d="M23.273 139.636h46.545v46.545H23.273z"/><path fill="#ea3326" d="M209.455 186.182H256v46.545h-46.545zm-186.182 0h46.545v46.545H23.273z"/></svg>`,
    cssClass: 'mistral',
    helpTitle: 'How to get your Mistral API key',
    helpSteps: [
      'Open the <strong>Mistral Console</strong> and sign up or log in.',
      'Open <strong>API Keys</strong> in the sidebar.',
      'Click <strong>Create new key</strong> and copy it. You may need to verify a phone number and activate the free "Experiment" plan first.',
      'Paste it in the field above and click <strong>Save</strong>.'
    ],
    helpNote: 'Mistral\'s free Experiment tier works here (phone verification required).',
    helpLink: 'https://console.mistral.ai/api-keys/'
  }
};
