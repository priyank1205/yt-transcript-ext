// Runs at document_start in MAIN world, before YouTube saves references to its
// networking APIs. Retain only caption response bodies for the current video;
// replaying their signed URLs later is not always accepted by YouTube.
(() => {
  const key = Symbol.for('yt-transcript-ext.caption-capture');
  if (window[key]) return;
  let generation = 0;
  let entries = [];
  const maxBodyLength = 4 * 1024 * 1024;
  const currentVideo = () => location.pathname === '/watch'
    ? new URLSearchParams(location.search).get('v') : null;

  function identify(raw) {
    try {
      const url = new URL(raw, location.origin);
      const videoId = url.searchParams.get('v');
      if (url.origin !== location.origin || url.pathname !== '/api/timedtext' ||
          !videoId || videoId !== currentVideo() ||
          url.searchParams.has('seq') || url.searchParams.has('sq')) return null;
      // Do not retain signatures, tokens, headers, or unrelated requests.
      return { videoId, languageCode: url.searchParams.get('lang'),
        translationLanguage: url.searchParams.get('tlang'),
        kind: url.searchParams.get('kind'), generation };
    } catch { return null; }
  }

  function retain(meta, body) {
    if (!meta || meta.generation !== generation || meta.videoId !== currentVideo() ||
        typeof body !== 'string' || !body.trim() || body.length > maxBodyLength) return;
    // Keep the latest response for each language/kind, bounded to four tracks.
    entries = entries.filter(entry => entry.languageCode !== meta.languageCode ||
      entry.translationLanguage !== meta.translationLanguage || entry.kind !== meta.kind);
    entries.unshift({ ...meta, body });
    entries.length = Math.min(entries.length, 4);
  }

  window[key] = {
    read(videoId) {
      if (videoId !== currentVideo()) return [];
      return entries.filter(entry => entry.videoId === videoId).map(entry => ({ ...entry }));
    }
  };
  window.addEventListener('yt-navigate-start', () => { generation++; entries = []; });

  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    // Return the original promise/response. A clone is consumed independently,
    // and capture failures must never become failures of the player's request.
    const promise = Reflect.apply(originalFetch, this, args);
    try {
      const input = args[0];
      const meta = identify(typeof input === 'string' ? input : input?.url || String(input));
      if (meta) {
        promise.then(response => {
          if (!response.ok) return;
          return response.clone().text().then(body => retain(meta, body));
        }).catch(() => {});
      }
    } catch { /* Observation is best effort; preserve the player's behavior. */ }
    return promise;
  };

  // YouTube also loads captions through XMLHttpRequest. Store request metadata
  // at send time and support text, JSON, and document response types.
  const requests = new WeakMap();
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (...args) {
    const result = Reflect.apply(originalOpen, this, args);
    try {
      const previous = requests.get(this);
      if (previous?.listener) this.removeEventListener('load', previous.listener);
      requests.set(this, { meta: identify(args[1]) });
    } catch { /* Preserve native open behavior. */ }
    return result;
  };
  XMLHttpRequest.prototype.send = function (...args) {
    try {
      const request = requests.get(this);
      if (request?.meta && !request.listener) {
        const meta = { ...request.meta };
        request.listener = () => {
          try {
            if (this.status < 200 || this.status >= 300) return;
            let body;
            if (this.responseType === 'json') body = JSON.stringify(this.response);
            else if (this.responseType === 'document') body = new XMLSerializer().serializeToString(this.responseXML);
            else if (this.responseType === 'arraybuffer') body = new TextDecoder().decode(this.response);
            else if (this.responseType === 'blob') {
              this.response.text().then(text => retain(meta, text)).catch(() => {});
              return;
            }
            else if (!this.responseType || this.responseType === 'text') body = this.responseText;
            retain(meta, body);
          } catch { /* Never interrupt the player's load handlers. */ }
        };
        this.addEventListener('load', request.listener, { once: true });
      }
    } catch { /* Preserve native send behavior. */ }
    return Reflect.apply(originalSend, this, args);
  };
})();
