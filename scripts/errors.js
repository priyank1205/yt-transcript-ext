// scripts/errors.js
//
// One place that turns any failure — transcript extraction, a provider's HTTP
// status, an unreadable model response — into a category the panel can act on.
// Producers attach a `code`; `classifyError` resolves it into the payload the
// panel renders (a persistent title + explanation) plus the flags that decide
// which recovery actions it offers.
//
// Module land only (service worker, provider clients, caption reader). The
// panel is a classic content script and never imports this: it receives the
// finished payload over the PROGRESS_UPDATE / START_ANALYSIS response.

export const ERROR_CODES = {
  NO_CAPTIONS: 'no_captions',
  CAPTIONS_UNREADABLE: 'captions_unreadable',
  VIDEO_CHANGED: 'video_changed',
  NO_KEY: 'no_key',
  AUTH: 'auth',
  MODEL_UNAVAILABLE: 'model_unavailable',
  ENDPOINT: 'endpoint',
  RATE_LIMIT: 'rate_limit',
  INPUT_TOO_LARGE: 'input_too_large',
  NETWORK: 'network',
  TIMEOUT: 'timeout',
  BAD_OUTPUT: 'bad_output',
  TRUNCATED: 'truncated',
  BLOCKED: 'blocked',
  PROVIDER_DOWN: 'provider_down',
  BUSY: 'busy',
  UNKNOWN: 'unknown'
};

// `settings: true` adds an "Open settings" action next to Retry. Retry is
// always offered: no category may leave the panel with no way forward.
const CATEGORIES = {
  [ERROR_CODES.NO_CAPTIONS]: {
    title: 'No captions for this video',
    detail: 'There is no transcript to summarize. If CC is available, turn it on and try again.'
  },
  [ERROR_CODES.CAPTIONS_UNREADABLE]: {
    title: "Couldn't read the captions",
    detail: "YouTube's transcript didn't load. Refresh the page and try again."
  },
  [ERROR_CODES.VIDEO_CHANGED]: {
    title: 'The video changed',
    detail: 'Generation stopped because the page moved to another video. Try again here.'
  },
  [ERROR_CODES.NO_KEY]: {
    title: 'No API key set',
    detail: 'Add a provider key in settings to generate summaries.',
    settings: true
  },
  [ERROR_CODES.AUTH]: {
    title: 'The provider rejected the API key',
    detail: 'The key is missing, invalid, or not permitted for this model. Check it in settings.',
    settings: true
  },
  [ERROR_CODES.MODEL_UNAVAILABLE]: {
    title: 'That model is unavailable',
    detail: "The configured model doesn't exist or isn't available to this key. Pick another one in settings.",
    settings: true
  },
  [ERROR_CODES.ENDPOINT]: {
    title: 'The provider URL returned 404',
    detail: 'Check the base URL in settings — it usually ends in /v1/chat/completions.',
    settings: true
  },
  [ERROR_CODES.RATE_LIMIT]: {
    title: 'Rate limit reached',
    detail: 'The provider is throttling requests. Wait a moment, then try again.'
  },
  [ERROR_CODES.INPUT_TOO_LARGE]: {
    title: 'The transcript is too long for this model',
    detail: 'This video exceeds the model’s input limit. Try a shorter video, or a model with a larger context.',
    settings: true
  },
  [ERROR_CODES.NETWORK]: {
    title: "Couldn't reach the provider",
    detail: 'The request failed before a response arrived. Check your connection and try again.'
  },
  [ERROR_CODES.TIMEOUT]: {
    title: 'The request timed out',
    detail: "The provider didn't respond in time. Try again, or switch to a faster model."
  },
  [ERROR_CODES.BAD_OUTPUT]: {
    title: "The summary couldn't be read",
    detail: 'The model returned something this panel could not parse. Try again, or switch models.',
    settings: true
  },
  [ERROR_CODES.TRUNCATED]: {
    title: 'The summary was cut off',
    detail: 'The model reached its output limit before finishing. Try the Brief detail level, or a model with a larger output budget.',
    settings: true
  },
  [ERROR_CODES.BLOCKED]: {
    title: 'The provider blocked this response',
    detail: 'The model declined to summarize this transcript. Try another provider or model.',
    settings: true
  },
  [ERROR_CODES.PROVIDER_DOWN]: {
    title: 'The provider is unavailable',
    detail: 'The service reported an error on its side. Try again shortly.'
  },
  [ERROR_CODES.BUSY]: {
    title: 'A summary is already being generated',
    detail: 'Wait for the current one to finish, or reload the page to start over.'
  },
  [ERROR_CODES.UNKNOWN]: {
    title: 'Something went wrong',
    detail: "The summary couldn't be generated. Copy the details if this keeps happening."
  }
};

const KNOWN_CODES = new Set(Object.values(ERROR_CODES));

// Build an Error carrying a category, so the boundary never has to sniff the
// message text. `status` is kept for the diagnostics report.
export function apiError(code, message, status) {
  const err = new Error(message);
  err.code = code;
  if (status !== undefined) err.status = status;
  return err;
}

// Map an HTTP status to a category. Gemini answers a bad key with 400, so 400
// is treated as auth unless the caller already resolved something better.
export function codeForStatus(status) {
  if (status === 400 || status === 401 || status === 403) return ERROR_CODES.AUTH;
  if (status === 404) return ERROR_CODES.MODEL_UNAVAILABLE;
  if (status === 413) return ERROR_CODES.INPUT_TOO_LARGE;
  if (status === 429) return ERROR_CODES.RATE_LIMIT;
  if (status >= 500) return ERROR_CODES.PROVIDER_DOWN;
  return ERROR_CODES.UNKNOWN;
}

// Last-resort categorisation for throw sites that predate the codes (and for
// whatever fetch itself reports). Only reached when no code was attached.
function codeFromMessage(message) {
  const text = String(message || '').toLowerCase();
  if (!text) return ERROR_CODES.UNKNOWN;
  if (text.includes('no captions') || text.includes('no transcript found')) return ERROR_CODES.NO_CAPTIONS;
  if (text.includes('caption') || text.includes('transcript')) return ERROR_CODES.CAPTIONS_UNREADABLE;
  if (text.includes('video changed')) return ERROR_CODES.VIDEO_CHANGED;
  if (text.includes('api key') || text.includes('unauthorized')) return ERROR_CODES.AUTH;
  if (text.includes('rate limit') || text.includes('quota')) return ERROR_CODES.RATE_LIMIT;
  if (text.includes('timed out') || text.includes('timeout')) return ERROR_CODES.TIMEOUT;
  if (text.includes('failed to fetch') || text.includes('network')) return ERROR_CODES.NETWORK;
  if (text.includes('too long') || text.includes('too large') || text.includes('context length')) return ERROR_CODES.INPUT_TOO_LARGE;
  if (text.includes('cut off') || text.includes('truncated')) return ERROR_CODES.TRUNCATED;
  if (text.includes('unavailable')) return ERROR_CODES.PROVIDER_DOWN;
  return ERROR_CODES.UNKNOWN;
}

// Diagnostics are copied by the user and pasted into issues, so nothing that
// identifies them or grants access may survive: query strings carry caption
// signatures and session tokens, and provider errors sometimes echo the key.
export function sanitizeDiagnosticText(text, limit = 300) {
  return String(text ?? '')
    // Query strings and fragments: caption URLs carry signatures and tokens.
    .replace(/(https?:\/\/[^\s?#]+)[?#]\S*/gi, '$1?<redacted>')
    // Provider key formats, and anything presented as a labelled credential.
    .replace(/\bAIza[0-9A-Za-z\-_]{10,}/g, '<redacted>')
    .replace(/\b(?:sk|rk|pk)[-_](?:[A-Za-z0-9]+[-_])*[A-Za-z0-9\-_]{12,}/gi, '<redacted>')
    .replace(/\b(api[-_ ]?key|key|token|secret|authorization)\s*[:=]\s*\S+/gi, '$1=<redacted>')
    .replace(/\bbearer\s+\S+/gi, 'bearer <redacted>')
    // Any remaining long opaque run.
    .replace(/[A-Za-z0-9\-_]{32,}/g, '<redacted>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

/**
 * Resolve any failure into the payload the panel renders.
 *
 * @param {Error|string|{code?:string,error?:string,message?:string,status?:number}} input
 * @param {{stage?:string, provider?:string, model?:string, detail?:string, status?:number}} context
 */
export function classifyError(input, context = {}) {
  const message = typeof input === 'string'
    ? input
    : (input?.message || input?.error || '');
  const status = context.status ?? input?.status;

  let code = input?.code;
  if (!KNOWN_CODES.has(code)) code = undefined;
  if (!code && typeof status === 'number') {
    const fromStatus = codeForStatus(status);
    if (fromStatus !== ERROR_CODES.UNKNOWN) code = fromStatus;
  }
  if (!code) code = codeFromMessage(message);

  const category = CATEGORIES[code] || CATEGORIES[ERROR_CODES.UNKNOWN];
  return {
    code,
    title: category.title,
    detail: category.detail,
    settings: !!category.settings,
    // Kept out of the panel copy and shown only in the copied report.
    raw: sanitizeDiagnosticText(message),
    stage: context.stage || null,
    provider: context.provider || null,
    model: context.model || null,
    level: context.detail || null,
    status: typeof status === 'number' ? status : null
  };
}
