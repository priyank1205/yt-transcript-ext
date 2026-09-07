// Passed to chrome.scripting.executeScript in MAIN world. Keep every helper
// inside this function: injected functions do not retain their module scope.
// Only reads the current player's metadata and fetches its caption resources;
// never toggles CC, seeks playback, or calls a separate player API.
export async function readPlayerCaptions(videoId) {
  const failure = error => ({ success: false, error });
  const changed = () => location.pathname !== '/watch' ||
    new URLSearchParams(location.search).get('v') !== videoId;
  const changedError = 'Video changed. Please generate the summary again.';
  if (!videoId || changed()) return failure(changedError);

  let navigated = false;
  const onNavigate = () => { navigated = true; };
  window.addEventListener('yt-navigate-start', onNavigate);
  const stale = () => navigated || changed();

  // Caption URLs contain signatures/session tokens. Restrict fetches to the
  // current video's same-origin timedtext endpoint and never log those URLs.
  function captionURL(raw) {
    try {
      const url = new URL(raw, location.origin);
      return url.origin === location.origin && url.pathname === '/api/timedtext' &&
        url.searchParams.get('v') === videoId ? url : null;
    } catch { return null; }
  }

  function timestamp(ms) {
    const seconds = Math.floor(ms / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor(seconds / 60) % 60;
    const rest = String(seconds % 60).padStart(2, '0');
    return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
  }

  function parseCaptions(body) {
    const cues = [];
    function add(start, text) {
      const clean = text.replace(/\s+/g, ' ').trim();
      if (Number.isFinite(start) && start >= 0 && clean) cues.push({ start, text: clean });
    }
    if (body.trimStart().startsWith('{')) {
      const json = JSON.parse(body);
      if (!Array.isArray(json.events)) return '';
      for (const event of json.events) {
        if (typeof event.tStartMs !== 'number' || !Array.isArray(event.segs)) continue;
        // JSON3 includes window/formatting events without speech, and ASR
        // splits sentences into word segments. Preserve all spoken segments.
        add(event.tStartMs, event.segs.map(s => typeof s.utf8 === 'string' ? s.utf8 : '').join(''));
      }
    } else {
      const xml = new DOMParser().parseFromString(body, 'text/xml');
      if (xml.querySelector('parsererror')) return '';
      const root = xml.documentElement?.tagName;
      if (root !== 'transcript' && root !== 'timedtext') return '';
      for (const cue of xml.querySelectorAll(root === 'transcript' ? 'text[start]' : 'body > p[t]')) {
        const rawStart = cue.getAttribute(root === 'transcript' ? 'start' : 't');
        if (!rawStart?.trim()) continue;
        // SRV3 paragraphs may contain word-level <s> elements and <br>.
        for (const br of cue.querySelectorAll('br')) br.replaceWith(' ');
        add(Number(rawStart) * (root === 'transcript' ? 1000 : 1), cue.textContent || '');
      }
    }
    cues.sort((a, b) => a.start - b.start);
    const seen = new Set();
    return cues.filter(cue => {
      const key = `${cue.start}\n${cue.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map(cue => `[${timestamp(cue.start)}] ${cue.text}\n`).join('');
  }

  try {
    const player = document.getElementById('movie_player');
    let response;
    try { response = player?.getPlayerResponse?.(); } catch { /* Player still loading. */ }
    if (response?.videoDetails?.videoId !== videoId) {
      response = window.ytInitialPlayerResponse?.videoDetails?.videoId === videoId
        ? window.ytInitialPlayerResponse : null;
    }
    // Never reuse metadata from the previous video during YouTube SPA navigation.
    const renderer = response?.captions?.playerCaptionsTracklistRenderer;
    const tracks = Array.isArray(renderer?.captionTracks) ? renderer.captionTracks : [];
    let selected;
    try { selected = player?.getOption?.('captions', 'track'); } catch { /* Optional player API. */ }
    const defaultAudio = renderer?.audioTracks?.[renderer.defaultAudioTrackIndex || 0];
    const defaultTrack = tracks[defaultAudio?.defaultCaptionTrackIndex];
    function rank(track) {
      if (selected?.vssId && track.vssId === selected.vssId) return 0;
      if (selected?.languageCode && track.languageCode === selected.languageCode) return 1;
      if (track === defaultTrack) return 2;
      return track.kind === 'asr' ? 4 : 3;
    }
    const orderedTracks = [...tracks].sort((a, b) => rank(a) - rank(b));
    if (response?.videoDetails?.isLive === true) {
      return failure('Full captions are not available during a live stream. Try after it ends.');
    }
    const preferredLanguage = selected?.languageCode || orderedTracks[0]?.languageCode;
    // Prefer the actual response YouTube loaded. Resource timing only exposes
    // URLs, and a second request can fail even when the original one succeeded.
    const capture = window[Symbol.for('yt-transcript-ext.caption-capture')];
    function readCaptured() {
      try {
        const entries = capture?.read(videoId) || [];
        entries.sort((a, b) => Number(b.languageCode === preferredLanguage) -
          Number(a.languageCode === preferredLanguage));
        for (const entry of entries) {
          if (entry.videoId !== videoId || typeof entry.body !== 'string') continue;
          try {
            const data = parseCaptions(entry.body);
            if (data) return { success: true, data };
          } catch { /* Another captured track may be readable. */ }
        }
      } catch { /* Capture is optional; older tabs can still try URL fallback. */ }
      return null;
    }
    if (stale()) return failure(changedError);
    const captured = readCaptured();
    if (captured) return captured;
    const candidates = [];
    const seenURLs = new Set();
    function enqueue(raw, preferJSON = false) {
      const url = captionURL(raw);
      if (!url) return;
      // Existing player requests are replayed verbatim, including PO tokens.
      // Track metadata normally has no format; request JSON3 in that case.
      if (preferJSON && !url.searchParams.has('fmt')) url.searchParams.set('fmt', 'json3');
      if (!seenURLs.has(url.href)) {
        candidates.push(url.href);
        seenURLs.add(url.href);
      }
    }
    const resources = performance.getEntriesByType('resource').slice().reverse()
      .map(entry => captionURL(entry.name)).filter(Boolean)
      // Segmented live captions cannot supply a full-video transcript.
      .filter(url => !url.searchParams.has('seq') && !url.searchParams.has('sq'));
    resources.sort((a, b) => Number(b.searchParams.get('lang') === preferredLanguage) -
      Number(a.searchParams.get('lang') === preferredLanguage));
    for (const url of resources.slice(0, 2)) enqueue(url.href);
    for (const track of orderedTracks) enqueue(track.baseUrl, true);
    if (!candidates.length) {
      return failure('No transcript found. If CC is available, turn it on and retry.');
    }

    // Bound fallback time so a failing caption server cannot hold up the panel.
    const deadline = Date.now() + 15000;
    for (const url of candidates.slice(0, 4)) {
      if (stale()) return failure(changedError);
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(5000, remaining));
      try {
        const result = await fetch(url, {
          credentials: 'include', signal: controller.signal, redirect: 'error'
        });
        if (!result.ok) continue;
        const body = await result.text();
        if (stale()) return failure(changedError);
        const data = parseCaptions(body);
        if (data) return { success: true, data };
      } catch { /* Expired signatures, blocked requests, empty/invalid responses: try next track. */ }
      finally { clearTimeout(timer); }
    }
    if (stale()) return failure(changedError);
    // A player request may have completed while URL fallback was running.
    const recentlyCaptured = readCaptured();
    if (recentlyCaptured) return recentlyCaptured;
    return failure(capture
      ? 'Could not read loaded captions. Refresh the video with CC enabled and retry.'
      : 'Caption capture needs a page refresh. Reload the extension, then refresh YouTube.');
  } catch {
    return failure('Could not read player captions. Please refresh the page and try again.');
  } finally {
    window.removeEventListener('yt-navigate-start', onNavigate);
  }
}

// Route through the service worker to use MAIN world without adding a permanent
// page bridge. Chrome supplies sender.tab/frameId; never accept a tab ID or URL
// from the message. Only the resulting transcript leaves the page context.
export async function getPlayerCaptions(request, sender) {
  let page;
  try { page = new URL(sender.url); } catch { return { success: false, error: 'Invalid video page.' }; }
  if (!sender.tab?.id || sender.frameId !== 0 ||
      !['https:', 'http:'].includes(page.protocol) ||
      !(page.hostname === 'youtube.com' || page.hostname.endsWith('.youtube.com')) ||
      page.pathname !== '/watch' || !request.videoId || page.searchParams.get('v') !== request.videoId) {
    return { success: false, error: 'Invalid video page.' };
  }
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: sender.tab.id, frameIds: [0] },
      world: 'MAIN',
      func: readPlayerCaptions,
      args: [request.videoId]
    });
    return results[0]?.result || { success: false, error: 'Could not read player captions. Please refresh and try again.' };
  } catch {
    return { success: false, error: 'Could not read player captions. Please refresh and try again.' };
  }
}
