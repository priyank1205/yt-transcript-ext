// Local fixture server: each caption URL succeeds once and returns an empty
// response on replay, reproducing the failure that URL-only fallback missed.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const files = new Set(['/tests/caption-reader-browser.html', '/scripts/caption-reader.js', '/scripts/caption-capture.js']);
const seen = new Set();
http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  response.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/api/timedtext') {
    const xml = url.searchParams.get('format') === 'xml';
    response.setHeader('Content-Type', xml ? 'text/xml' : 'application/json');
    const body = xml ? '<transcript><text start="2.5">Original XML captions</text></transcript>'
      : '{"events":[{"tStartMs":1234,"segs":[{"utf8":"Original player captions"}]}]}';
    response.end(seen.has(url.href) ? '' : body);
    seen.add(url.href);
    return;
  }
  if (!files.has(url.pathname)) { response.writeHead(404); response.end(); return; }
  response.setHeader('Content-Type', url.pathname.endsWith('.js') ? 'text/javascript' : 'text/html');
  fs.createReadStream(path.join(root, url.pathname)).pipe(response);
}).listen(8765, '127.0.0.1', () => console.log('Caption checks: http://127.0.0.1:8765/tests/caption-reader-browser.html'));
