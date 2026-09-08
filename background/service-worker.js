// background/service-worker.js

import { PROVIDERS, isRetiredModel, endpointOrigin } from '../scripts/providers.js';
import { OpenAICompatibleClient } from '../scripts/openai-compatible-client.js';
import { getPlayerCaptions } from '../scripts/caption-reader.js';
import { apiError, classifyError, ERROR_CODES } from '../scripts/errors.js';
import { parseTranscriptCues, unwrap, validateSummary } from '../scripts/summary-validator.js';
import { planWindows } from '../scripts/transcript-windows.js';

// Content scripts can read chrome.storage.local by default, and this store
// holds every provider API key. The panel is a content script: it runs in
// YouTube's own page, so anything it may read is one page-level compromise away
// from being read by the page. Nothing it renders needs a key — it asks the
// background for a small set of non-secret preferences instead (see
// GET_PANEL_PREFS) — so the store is closed to page contexts entirely.
//
// Runs on every service-worker start, not just on install: the setting is cheap
// to reassert and this way a profile that predates it is repaired without
// waiting for an update.
try {
  chrome.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' })
    ?.catch?.((err) => console.warn('Could not restrict storage access:', err?.message));
} catch (err) {
  // Older Chrome without setAccessLevel: the panel still asks for prefs by
  // message and never reads a key itself, so nothing here depends on it.
  console.warn('Storage access level unavailable:', err?.message);
}

// First-run onboarding: on fresh install, open the settings page and flag the
// in-page tooltip that points new users to the settings gear icon. Every
// install or update also re-checks the saved model ids, since a provider can
// retire the model a working key was configured with.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.local.set({ SHOW_SETTINGS_HINT: true });
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
  }
  migrateRetiredModels();
});

// Rewrite `<provider>_MODEL` values naming a model the provider has retired.
// Without this a key that still works sits beside a model that no longer does,
// and every generation fails with a 404 that reads like an authentication
// problem. Only built-in providers are touched; a custom endpoint's model list
// is the user's own to maintain.
async function migrateRetiredModels() {
  try {
    const keys = Object.keys(PROVIDERS).map((id) => `${id}_MODEL`);
    const stored = await chrome.storage.local.get(keys);
    const updates = {};
    for (const id of Object.keys(PROVIDERS)) {
      const saved = stored[`${id}_MODEL`];
      if (saved && isRetiredModel(id, saved)) {
        updates[`${id}_MODEL`] = PROVIDERS[id].defaultModel;
        console.log(`Migrating retired ${id} model ${saved} -> ${PROVIDERS[id].defaultModel}`);
      }
    }
    if (Object.keys(updates).length) await chrome.storage.local.set(updates);
  } catch (err) {
    console.warn('Model migration failed:', err.message);
  }
}

// Helper: send a message to a tab and await it to prevent the service worker from terminating prematurely
async function sendTabMessage(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch (err) {
    // Silently ignore errors (e.g., content script not ready or tab closed)
  }
}

// --- Request binding ---------------------------------------------------------
//
// A generation belongs to one tab, one video and one request id, and it holds
// that claim for its whole life. Everything the background sends back carries
// the binding, so a result can never be attached to the video the user happens
// to be watching by the time it arrives. The AbortController is the other half:
// navigating away, or the panel's own timeout, now stops the provider call
// instead of leaving it running to completion and racing the next one.
const activeRequests = new Map();   // tabId -> { requestId, videoId, controller }

function beginRequest({ tabId, videoId, requestId }) {
  const previous = activeRequests.get(tabId);
  if (previous) previous.controller.abort();
  const entry = { requestId, videoId, controller: new AbortController() };
  activeRequests.set(tabId, entry);
  return entry;
}

function endRequest(tabId, requestId) {
  const entry = activeRequests.get(tabId);
  if (entry && entry.requestId === requestId) activeRequests.delete(tabId);
}

// Stop the generation a tab is running. With no filter it stops whatever is
// there; with one it only stops a matching request, so a late cancel for an
// older generation cannot kill the current one.
function abortRequest(tabId, { requestId, videoId } = {}) {
  const entry = activeRequests.get(tabId);
  if (!entry) return false;
  if (requestId && entry.requestId !== requestId) return false;
  if (videoId && entry.videoId !== videoId) return false;
  entry.controller.abort();
  activeRequests.delete(tabId);
  return true;
}

// Is this generation still the one its tab is waiting for?
function isCurrent(tabId, requestId) {
  const entry = activeRequests.get(tabId);
  return !!entry && entry.requestId === requestId && !entry.controller.signal.aborted;
}

chrome.tabs.onRemoved.addListener((tabId) => { abortRequest(tabId); });

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url) return;
  const entry = activeRequests.get(tabId);
  if (!entry) return;
  let videoId = null;
  try { videoId = new URL(changeInfo.url).searchParams.get('v'); } catch { /* not a readable URL */ }
  // The tab moved to a different video (or off /watch entirely): the work in
  // flight was started for a page that is no longer on screen.
  if (videoId !== entry.videoId) abortRequest(tabId);
});

// Every progress update names the generation it belongs to, so the panel can
// drop one that arrives for a superseded request or another video.
async function sendProgress(request, phase, extra = {}) {
  if (!request.tabId) return;
  await sendTabMessage(request.tabId, {
    action: "PROGRESS_UPDATE",
    phase,
    requestId: request.requestId,
    videoId: request.videoId,
    ...extra
  });
}

// Every analysis failure leaves through here. It categorises the error once and
// gives the panel what it needs to recover: a persistent explanation, the flag
// that decides whether "Open settings" is offered, and a sanitized message for
// the copyable diagnostics. The panel decides presentation; nothing downstream
// has to sniff error strings.
async function failAnalysis(request, sendResponse, input, context = {}) {
  // Release the tab's claim before answering: a run that has reported a failure
  // is over, and the panel's retry must not be turned away as a duplicate.
  endRequest(request.tabId, request.requestId);
  const error = classifyError(input, context);
  console.warn(`Analysis failed [${error.code}] at ${error.stage || 'unknown'} stage:`, error.raw);
  if (request.tabId) await sendProgress(request, "error", { error });
  sendResponse({ success: false, error });
  return error;
}

// Summarize a long video one window at a time.
//
// Each window is its own request over its own slice of the transcript, so a
// stretch of the video cannot be passed over for want of the model's attention:
// it is the only thing in its request. The windows are ordered and disjoint, so
// their summaries concatenate into a single increasing timeline — which is then
// validated as a whole, against the full cue list, exactly like a one-shot
// reply.
// How many window requests are in flight at once. Nothing in a window depends
// on any other, so the only reason not to send them all together is the
// provider: a free tier metered per minute answers a burst with 429s. Four
// turns a seven-part video into two rounds instead of seven, which is most of
// the wall-clock saving without crowding the limit.
const WINDOW_CONCURRENCY = 4;

// Failures worth a second attempt. Everything else — a rejected key, a missing
// model, a reply that failed validation — fails the same way however many times
// it is asked, and retrying it only delays the fallback to the next provider.
const RETRYABLE_CODES = new Set([
  ERROR_CODES.RATE_LIMIT,
  ERROR_CODES.PROVIDER_DOWN,
  ERROR_CODES.NETWORK,
  ERROR_CODES.TIMEOUT
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function generateWindowed(client, apiKey, windows, options, onProgress, shouldStop) {
  const parts = new Array(windows.length);
  let next = 0;
  let completed = 0;
  let failure = null;

  const report = () => onProgress(`Generating summary... ${completed}/${windows.length} parts`);

  // One window, with a couple of attempts held back for the transient case.
  // Running four calls at once is exactly what makes a per-minute limit likely,
  // so the retry is part of the parallelism rather than a separate nicety.
  const requestWindow = async (window) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await client.callAPI(apiKey, window.transcript, {
          ...options,
          // The window's own runtime prices its share of the points, so the
          // video's total is the sum of its parts rather than one capped number.
          durationMinutes: window.durationMinutes,
          window
        });
      } catch (err) {
        const code = err?.code || classifyError(err).code;
        if (attempt >= 2 || !RETRYABLE_CODES.has(code) || shouldStop() || options.signal?.aborted) throw err;
        console.warn(`Part ${window.index}/${window.count} failed (${code}), retrying...`);
        // Backoff with jitter: parts that hit the same limit in the same moment
        // must not come back in lockstep and hit it again together.
        await sleep((attempt + 1) * 1500 + Math.random() * 500);
      }
    }
  };

  const worker = async () => {
    while (!failure && !shouldStop()) {
      const index = next++;
      if (index >= windows.length) return;
      const window = windows[index];
      try {
        const reply = await requestWindow(window);

        // A window cut off at its output limit would leave a hole exactly where
        // the windowing exists to prevent one. Fail the run here instead of
        // joining in a half-written part and calling the result a summary.
        const finishReason = String(reply?.finishReason || '').toLowerCase();
        if (finishReason === 'length' || finishReason === 'max_tokens') {
          throw apiError(ERROR_CODES.TRUNCATED,
            `Part ${window.index} of ${window.count} stopped at its output limit before finishing.`);
        }

        // Each part arrives in its own code fence; they have to come off before
        // the parts are joined, or the seam reads as one unterminated block.
        const text = unwrap(reply?.text ?? reply);
        if (!text) {
          throw apiError(ERROR_CODES.BAD_OUTPUT,
            `Part ${window.index} of ${window.count} came back empty.`);
        }

        // Stored by index, not appended: parts finish out of order, and the
        // joined timeline has to be the video's order, not the network's.
        parts[index] = text;
        completed++;
        await report();
      } catch (err) {
        failure = failure || err;
        return;
      }
    }
  };

  await report();
  await Promise.all(
    Array.from({ length: Math.min(WINDOW_CONCURRENCY, windows.length) }, worker)
  );

  if (failure) throw failure;
  if (shouldStop()) return null;
  // A gap here would join as the string "undefined"; there is no path that
  // leaves one, so treat it as a bug rather than shipping it to the panel.
  if (parts.some((part) => typeof part !== 'string')) {
    throw apiError(ERROR_CODES.BAD_OUTPUT, 'A part of the summary was never generated.');
  }
  return { text: parts.join('\n'), finishReason: null };
}

// Delight stat: record one successful summary and the estimated watch-time it
// saved. "Saved" = the video's length minus the time to read the summary at
// READING_WPM, clamped at zero (a summary can't cost more than the video). When
// the duration couldn't be parsed we still count the summary but add 0 seconds.
// Fire-and-forget so it never delays the response to the panel.
const READING_WPM = 200;
function recordSummaryStat(summary, durationMinutes) {
  const words = (summary || '').trim().split(/\s+/).filter(Boolean).length;
  const readMinutes = words / READING_WPM;
  const savedMinutes = durationMinutes ? Math.max(0, durationMinutes - readMinutes) : 0;
  const savedSeconds = Math.round(savedMinutes * 60);
  chrome.storage.local.get(['SUMMARIES_COUNT', 'SECONDS_SAVED'], (res) => {
    chrome.storage.local.set({
      SUMMARIES_COUNT: (res.SUMMARIES_COUNT || 0) + 1,
      SECONDS_SAVED: (res.SECONDS_SAVED || 0) + savedSeconds,
    });
  });
}

function getClient(modelName, allProviders) {
  const provider = allProviders[modelName.toLowerCase()];
  if (!provider) throw new Error(`Unsupported model: ${modelName}`);
  return new provider.clientClass(provider);
}

// Is this provider set up well enough to be tried? A local custom endpoint is
// legitimately keyless: an empty string means "configured, no key needed",
// which is a different answer from never configured at all.
function hasCredential(provider, storage) {
  const key = storage[provider.storageKey];
  return !!key || (provider.isCustom && key === '');
}

function configuredProviderIds(allProviders, storage) {
  return Object.keys(allProviders).filter((id) => hasCredential(allProviders[id], storage));
}

// The built-in registry plus whatever custom endpoints the user has saved.
async function loadProviders() {
  const { CUSTOM_PROVIDERS } = await chrome.storage.local.get(['CUSTOM_PROVIDERS']);
  const allProviders = { ...PROVIDERS };
  for (const cp of CUSTOM_PROVIDERS || []) {
    allProviders[cp.id] = { ...cp, clientClass: OpenAICompatibleClient };
  }
  return allProviders;
}

// A custom endpoint is reachable only while its optional host permission is
// granted. Chrome answers a revoked one with an ordinary network failure, which
// the panel would report as "couldn't reach the provider" — a true statement
// that sends the user to check their connection instead of their settings.
async function hasEndpointPermission(provider) {
  const origin = endpointOrigin(provider);
  if (!origin) return true;   // built-in: declared in the manifest
  try {
    return await chrome.permissions.contains({ origins: [origin] });
  } catch {
    // No permissions API to ask (tests, older Chrome): let the request itself
    // decide rather than blocking a provider that may well work.
    return true;
  }
}

// --- Panel preferences -------------------------------------------------------
//
// The one thing the panel is allowed to know about settings. It gets the four
// display preferences it actually renders and a single boolean for whether any
// provider is set up — never a key, an endpoint, or even which providers exist.
// That boolean is all the old `storage.local.get(null)` in the panel was really
// asking for, and it cost every key in the profile to answer.

// Written from the page side, so each one is named and shape-checked here.
const WRITABLE_PANEL_PREFS = {
  summaryLength: {
    storageKey: 'SUMMARY_LENGTH',
    accepts: (value) => ['brief', 'standard', 'detailed'].includes(value)
  },
  showSettingsHint: {
    storageKey: 'SHOW_SETTINGS_HINT',
    accepts: (value) => typeof value === 'boolean'
  }
};

async function panelPrefs() {
  const allProviders = await loadProviders();
  const storage = await chrome.storage.local.get([
    'SUMMARY_LENGTH', 'THEME_PREF', 'PANEL_SKIN', 'SHOW_SETTINGS_HINT',
    ...Object.values(allProviders).map((p) => p.storageKey)
  ]);
  return {
    summaryLength: storage.SUMMARY_LENGTH || 'standard',
    theme: storage.THEME_PREF || 'system',
    skin: storage.PANEL_SKIN || 'quiet',
    showSettingsHint: !!storage.SHOW_SETTINGS_HINT,
    // Whether generation is possible at all — the panel uses it to choose
    // between "Generate summary" and "Set API keys".
    providerReady: configuredProviderIds(allProviders, storage).length > 0
  };
}

async function setPanelPref(name, value) {
  // Own properties only: a name like "constructor" would otherwise resolve to
  // something inherited and be treated as a writable preference.
  const pref = Object.hasOwn(WRITABLE_PANEL_PREFS, String(name))
    ? WRITABLE_PANEL_PREFS[name] : null;
  if (!pref || !pref.accepts(value)) {
    console.warn(`Refused panel preference write: ${name}`);
    return false;
  }
  await chrome.storage.local.set({ [pref.storageKey]: value });
  return true;
}

// Push the same payload to every open YouTube tab. This replaces the panel's
// own storage.onChanged listener, which no longer fires now that the store is
// restricted to trusted contexts.
async function broadcastPanelPrefs() {
  try {
    const prefs = await panelPrefs();
    const tabs = await chrome.tabs.query({ url: '*://*.youtube.com/*' });
    await Promise.all(tabs.map((tab) =>
      tab.id ? sendTabMessage(tab.id, { action: 'PREFS_CHANGED', prefs }) : null));
  } catch (err) {
    console.warn('Could not broadcast panel preferences:', err?.message);
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  // Keys and the custom-provider list change what `providerReady` answers; the
  // rest are the preferences the panel renders directly.
  const relevant = Object.keys(changes).some((key) =>
    key.endsWith('_API_KEY') || key === 'CUSTOM_PROVIDERS' ||
    ['SUMMARY_LENGTH', 'THEME_PREF', 'PANEL_SKIN'].includes(key));
  if (relevant) broadcastPanelPrefs();
});

// Is this message from the YouTube page itself, in its top frame? Origin and
// frame are the parts of `sender` that identify who is talking, and neither can
// change without a real navigation, so they are safe to read from `sender.url`.
// The video id is not: see tabVideoId below.
function isYouTubeTopFrame(sender) {
  if (!sender?.tab?.id || sender.frameId !== 0) return false;
  try {
    const url = new URL(sender.url || '');
    if (!['https:', 'http:'].includes(url.protocol)) return false;
    return url.hostname === 'youtube.com' || url.hostname.endsWith('.youtube.com');
  } catch {
    return false;
  }
}

// The video the tab is actually showing, asked of the browser rather than of
// the message.
//
// `sender.url` is the URL the content script's context was created with, and
// YouTube moves between videos in the page without creating a new one. From the
// second video of a session onwards it therefore names the video the user
// *arrived* on, not the one on screen — so reading the id from it made every
// generation after an in-page navigation look like it had been started for
// somebody else's video. That is the "The video changed" the panel kept showing
// until the page was reloaded, and reloading "fixed" it only because a reload
// is the one thing that rebuilds the context. tabs.get() reports the tab's last
// committed URL, which does follow those navigations.
async function tabVideoId(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const url = new URL(tab.url || tab.pendingUrl || '');
    if (!(url.hostname === 'youtube.com' || url.hostname.endsWith('.youtube.com'))) return null;
    if (url.pathname !== '/watch') return null;
    return url.searchParams.get('v');
  } catch {
    return null;
  }
}

// Handle messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'GET_PLAYER_CAPTIONS') {
    getPlayerCaptions(request, sender).then(sendResponse).catch(() => {
      sendResponse({ success: false, error: 'Could not read player captions. Please refresh and try again.' });
    });
    return true;
  }
  if (request.action === "OPEN_OPTIONS") {
    const optionsUrl = chrome.runtime.getURL('options/options.html');
    chrome.tabs.create({ url: optionsUrl });
    return;
  }
  if (request.action === "KEYS_CHANGED") {
    // Sent by the settings page after a save or delete. The storage listener
    // above already covers it; this keeps the update immediate and reaches
    // every YouTube tab rather than only the active one.
    broadcastPanelPrefs();
    return;
  }
  if (request.action === "GET_PANEL_PREFS") {
    // Only the panel asks, and only the panel's own page may be answered.
    if (!isYouTubeTopFrame(sender)) return;
    panelPrefs().then(sendResponse).catch((err) => {
      console.warn('Could not read panel preferences:', err?.message);
      sendResponse(null);
    });
    return true;
  }
  if (request.action === "SET_PANEL_PREF") {
    if (isYouTubeTopFrame(sender)) {
      setPanelPref(request.name, request.value)
        .catch((err) => console.warn('Preference write failed:', err?.message));
    }
    return;
  }
  if (request.action === "CANCEL_ANALYSIS") {
    // The panel gave up (navigation, or its own timeout). Stop the provider
    // call rather than letting it finish into a page that has moved on.
    const tabId = sender.tab?.id;
    if (tabId) {
      const stopped = abortRequest(tabId, { requestId: request.requestId, videoId: request.videoId });
      if (stopped) console.log(`Cancelled analysis in tab ${tabId} (${request.reason || 'no reason given'})`);
    }
    return;
  }
  if (request.action === "START_ANALYSIS") {
    // Resolving which video the tab is on is asynchronous, so the port has to
    // be held open for the response.
    startAnalysis(request, sender, sendResponse);
    return true;
  }
});

// Bind a generation to the tab that asked for it — not to whichever tab happens
// to be active, which stops being the same one as soon as the user switches
// tabs mid-run — and refuse it if the panel's claim doesn't match the video the
// browser says that tab is showing.
async function startAnalysis(request, sender, sendResponse) {
  const tabId = sender.tab?.id;
  const videoId = isYouTubeTopFrame(sender) ? await tabVideoId(tabId) : null;
  if (!videoId || (request.videoId && request.videoId !== videoId)) {
    sendResponse({
      success: false,
      error: classifyError(
        { message: 'The page moved away from this video before generation started.', code: ERROR_CODES.VIDEO_CHANGED },
        { stage: 'setup' })
    });
    return;
  }

  const requestId = request.requestId || `bg-${Date.now()}`;
  const existing = activeRequests.get(tabId);
  if (existing && existing.videoId === videoId && existing.requestId !== requestId) {
    // One generation per video per tab: a duplicate click must not start a
    // second run whose result would race the first one back.
    sendResponse({
      success: false,
      error: classifyError(
        { message: 'A summary is already being generated for this video.', code: ERROR_CODES.BUSY },
        { stage: 'setup' })
    });
    return;
  }

  // handleAnalysis claims the tab synchronously (beginRequest runs before its
  // first await), so the duplicate check above cannot be raced from here.
  // No provider is passed: the panel cannot read settings any more, so the
  // choice is resolved from storage inside handleAnalysis.
  const binding = { tabId, videoId, requestId };
  handleAnalysis(binding, sendResponse, request.length).catch(err => {
    console.warn('Unhandled error in handleAnalysis:', err);
    endRequest(tabId, requestId);
    sendResponse({ success: false, error: classifyError(err, { stage: 'generation' }) });
  });
}

async function handleAnalysis(binding, sendResponse, length) {
  const { tabId, videoId, requestId } = binding;

  const entry = beginRequest(binding);
  const signal = entry.controller.signal;
  // True once this generation has been superseded, cancelled, or the tab has
  // navigated. Checked at every boundary so obsolete work stops quietly rather
  // than reporting into a panel that has moved on.
  const stale = () => !isCurrent(tabId, requestId);
  // Answering even a cancelled run matters: an unanswered sendResponse closes
  // the message port with an error, which the panel would otherwise read as the
  // extension having reloaded.
  const cancelled = () => {
    endRequest(tabId, requestId);
    sendResponse({ success: false, cancelled: true });
  };

  // Declared out here so the catch below can still report which provider and
  // model the request was using when it failed.
  let resolvedModel = null;
  let summaryOptions = null;

  try {
    const allProviders = await loadProviders();

    // Fetch all storage keys dynamically based on registry
    const storageKeys = Object.values(allProviders).map(p => p.storageKey);
    const modelKeys = Object.values(allProviders).map(p => `${p.id}_MODEL`);
    storageKeys.push('SUMMARY_LENGTH', 'SELECTED_MODEL');
    storageKeys.push(...modelKeys);
    const storage = await chrome.storage.local.get(storageKeys);

    // Which provider to use is a stored setting, read here rather than in the
    // panel: the page side has no access to settings and no business knowing
    // which providers are configured. `auto` is the default and the fallback.
    const originalModel = storage.SELECTED_MODEL || 'auto';
    resolvedModel = originalModel;
    console.log(`handleAnalysis using provider: ${originalModel} for video ${videoId}`);

    // Resolve the summary "Detail" preset: explicit request wins, then the
    // persisted preference, then the standard default. Passed to every callAPI.
    summaryOptions = { length: length || storage.SUMMARY_LENGTH || 'standard' };

    // 2. Decide which providers this run may use, in order.
    //
    // Auto promises fallback across every configured provider, so the whole
    // configured set is the candidate list — it used to try exactly one
    // alternative and then give up. A named provider has one candidate.
    let candidates;
    if (originalModel === 'auto') {
      candidates = configuredProviderIds(allProviders, storage);
      if (candidates.length === 0) {
        await failAnalysis(binding, sendResponse,
          { message: 'No API key found. Please set one in settings.', code: ERROR_CODES.NO_KEY },
          { stage: 'setup', detail: summaryOptions.length });
        return;
      }
    } else if (!allProviders[originalModel]) {
      await failAnalysis(binding, sendResponse,
        { message: `Unknown provider "${originalModel}".`, code: ERROR_CODES.MODEL_UNAVAILABLE },
        { stage: 'setup', provider: originalModel, detail: summaryOptions.length });
      return;
    } else if (!hasCredential(allProviders[originalModel], storage)) {
      await failAnalysis(binding, sendResponse,
        { message: `API key not found for provider ${originalModel}.`, code: ERROR_CODES.NO_KEY },
        { stage: 'setup', provider: originalModel, detail: summaryOptions.length });
      return;
    } else {
      candidates = [originalModel];
    }
    resolvedModel = candidates[0];
    console.log(`Provider order: ${candidates.join(' -> ')}`);

    // 3. Fetch transcript (once, reused for every candidate)
    console.log('Sending PROGRESS_UPDATE: extracting');
    await sendProgress(binding, "extracting");
    if (stale()) return cancelled();

    console.log('Fetching transcript...');
    const transcriptResponse = await getClient(resolvedModel, allProviders)
      .fetchTranscriptWithRetry(tabId, videoId);
    console.log('Transcript fetched successfully:', transcriptResponse?.success);
    if (stale()) return cancelled();

    if (!transcriptResponse || !transcriptResponse.success) {
      await failAnalysis(binding, sendResponse,
        transcriptResponse || { message: "Could not connect to page.", code: ERROR_CODES.CAPTIONS_UNREADABLE },
        { stage: 'transcript', detail: summaryOptions.length });
      return;
    }

    // Keep the transcript's cues, not just its length: they are what every
    // summary timestamp is checked against before the panel is allowed to show
    // it, and the last one is the video's own end time.
    const cues = parseTranscriptCues(transcriptResponse.data);
    summaryOptions.durationMinutes = cues.length ? cues[cues.length - 1].seconds / 60 : null;
    console.log(`Transcript cues: ${cues.length}, duration (min): ${summaryOptions.durationMinutes}`);

    // Long videos are summarised in windows rather than in one request; an
    // empty plan means this one is short enough to go whole.
    const windows = planWindows(transcriptResponse.data, cues);
    if (windows.length) {
      console.log(`Windowing into ${windows.length} parts: ` +
        windows.map((w) => `${w.startLabel}-${w.endLabel}`).join(', '));
    }

    // 4. Call each candidate in turn until one produces a summary that
    //    validates against the transcript.
    console.log('Sending PROGRESS_UPDATE: calling_api');
    await sendProgress(binding, "calling_api");
    if (stale()) return cancelled();

    let summary = null;
    let firstFailure = null;

    for (let i = 0; i < candidates.length; i++) {
      const providerId = candidates[i];
      const provider = allProviders[providerId];
      resolvedModel = providerId;
      summaryOptions.modelId = storage[`${providerId}_MODEL`] || provider.defaultModel;

      if (i > 0) {
        console.log(`Falling back to ${providerId}...`);
        await sendProgress(binding, "calling_api", { message: `Trying ${provider.name}...` });
      }
      if (stale()) return cancelled();

      try {
        // A custom endpoint whose optional permission was declined or later
        // revoked cannot be fetched. Say so plainly instead of letting Chrome
        // report it as an unreachable network.
        if (!(await hasEndpointPermission(provider))) {
          throw apiError(ERROR_CODES.PERMISSION,
            `Chrome has not granted access to the endpoint saved for ${provider.name}.`);
        }
        console.log(`Calling ${providerId} API with model ${summaryOptions.modelId}...`);
        const client = getClient(providerId, allProviders);
        const apiKey = storage[provider.storageKey];
        const reply = windows.length
          ? await generateWindowed(client, apiKey, windows, { ...summaryOptions, signal },
              (message) => sendProgress(binding, "calling_api", { message }),
              stale)
          : await client.callAPI(apiKey, transcriptResponse.data, { ...summaryOptions, signal });
        if (stale()) return cancelled();

        // A reply is not a summary until its timestamps have been checked
        // against the cues above. Anything empty, cut off, unparseable or
        // timestamped against another timeline is refused here, before the
        // panel is told the run succeeded.
        const validated = validateSummary(reply?.text ?? reply, cues, { finishReason: reply?.finishReason });
        validated.warnings.forEach((warning) => console.warn(`[${providerId}] ${warning}`));
        summary = validated;
        break;
      } catch (apiErr) {
        if (stale()) return cancelled();
        console.warn(`${providerId} failed:`, apiErr.message);
        if (!firstFailure) {
          firstFailure = { error: apiErr, provider: providerId, model: summaryOptions.modelId };
        }
      }
    }

    if (!summary) {
      // Report the first provider's failure: with a named provider it is the
      // only one, and under Auto it is the one the user's setup nominates
      // first, so it is the actionable problem.
      await failAnalysis(binding, sendResponse, firstFailure.error, {
        stage: 'generation',
        provider: firstFailure.provider,
        model: firstFailure.model,
        detail: summaryOptions.length
      });
      return;
    }

    console.log(`Summary validated: ${summary.points.length} points, ${summary.dropped} dropped` +
      (summary.largestGap ? `, widest uncovered stretch ${Math.round(summary.largestGap.seconds / 60)} min` : ''));
    if (stale()) return cancelled();

    // Count this successful generation + accumulate estimated time saved.
    recordSummaryStat(summary.text, summaryOptions.durationMinutes);

    // 5. Send the validated summary to the content script to render, tagged
    //    with the request that produced it and the settings it was made under.
    const meta = {
      videoId,
      requestId,
      provider: resolvedModel,
      modelId: summaryOptions.modelId,
      length: summaryOptions.length,
      language: summaryOptions.language || 'en',
      points: summary.points.length,
      generatedAt: Date.now()
    };
    console.log('Sending RENDER_TIMESTAMPS');
    await sendTabMessage(tabId, {
      action: "RENDER_TIMESTAMPS",
      data: summary.text,
      requestId,
      videoId,
      meta
    });

    // 6. Send response
    console.log('Sending success response');
    endRequest(tabId, requestId);
    sendResponse({ success: true, data: summary.text, model: resolvedModel, meta });
  } catch (err) {
    if (stale()) {
      // Superseded or cancelled: the abort is the expected outcome, not a
      // failure the user needs to see.
      console.log('Analysis stopped before completion:', err.message);
      cancelled();
      return;
    }
    console.warn('Error in handleAnalysis:', err.message, err.stack);
    await failAnalysis(binding, sendResponse, err, {
      stage: 'generation', provider: resolvedModel,
      model: summaryOptions?.modelId, detail: summaryOptions?.length
    });
  } finally {
    // Safety net for any path that returned without releasing the claim.
    endRequest(tabId, requestId);
  }
}
