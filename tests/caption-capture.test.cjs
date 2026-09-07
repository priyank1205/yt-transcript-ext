const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../scripts/caption-capture.js'), 'utf8');
const key = Symbol.for('yt-transcript-ext.caption-capture');
const url = 'https://www.youtube.com/api/timedtext?v=fixture&lang=en&pot=private-token';
const body = '{"events":[{"tStartMs":0,"segs":[{"utf8":"Original captions"}]}]}';
const settle = () => new Promise(resolve => setImmediate(resolve));

function setup() {
  const events = new Map();
  class XHR extends EventTarget {
    open(...args) { this.openArgs = args; }
    send(...args) { this.sendArgs = args; }
    load(response, responseType = '') {
      this.status = 200;
      this.responseType = responseType;
      this.response = response;
      this.responseText = response;
      this.dispatchEvent(new Event('load'));
    }
  }
  const response = { ok: true, clone: () => ({ text: async () => body }) };
  const promise = Promise.resolve(response);
  const calls = [];
  const location = new URL('https://www.youtube.com/watch?v=fixture');
  const window = { fetch: function (...args) { calls.push({ receiver: this, args }); return promise; },
    addEventListener: (name, listener) => events.set(name, listener) };
  const context = vm.createContext({ window, location, URL, URLSearchParams, XMLHttpRequest: XHR, TextDecoder });
  vm.runInContext(source, context);
  return { window, context, location, events, XHR, calls, promise, response, read: () => window[key].read('fixture') };
}

test('fetch capture preserves original promise, arguments, receiver and response', async () => {
  const env = setup();
  const options = { headers: { 'test-player-header': 'unchanged' } };
  const promise = env.window.fetch(url, options);
  assert.equal(promise, env.promise);
  assert.equal(await promise, env.response);
  await settle();
  assert.equal(env.calls[0].receiver, env.window);
  assert.equal(env.calls[0].args[1], options);
  assert.equal(env.read()[0].body, body);
  assert.equal(JSON.stringify(env.read()).includes('private-token'), false);
});

test('supports Request-style fetch input and URL objects', async () => {
  for (const input of [{ url }, new URL(url)]) {
    const env = setup();
    await env.window.fetch(input);
    await settle();
    assert.equal(env.read()[0].body, body);
  }
});

test('never clones unrelated requests, other videos or segmented captions', async () => {
  const env = setup();
  env.response.clone = () => assert.fail('Unrelated response must not be read');
  for (const input of [
    'https://www.youtube.com/api/player?v=fixture',
    'https://www.youtube.com/api/timedtext?v=other',
    'https://example.com/api/timedtext?v=fixture', `${url}&sq=1`, `${url}&seq=1`
  ]) await env.window.fetch(input);
  await settle();
  assert.equal(env.read().length, 0);
});

test('capture failure does not reject the player fetch', async () => {
  const env = setup();
  env.response.clone = () => { throw new Error('clone failed'); };
  assert.equal(await env.window.fetch(url), env.response);
  await settle();
  assert.equal(env.read().length, 0);
});

test('XHR keeps native arguments and load handlers, handles reused requests', () => {
  const env = setup();
  const xhr = new env.XHR();
  let playerLoads = 0;
  xhr.addEventListener('load', () => playerLoads++);
  xhr.open('GET', url, true);
  xhr.send(null);
  xhr.load(body);
  assert.deepEqual(xhr.openArgs, ['GET', url, true]);
  assert.deepEqual(xhr.sendArgs, [null]);
  assert.equal(env.read()[0].body, body);
  xhr.open('GET', 'https://www.youtube.com/api/player');
  xhr.send();
  xhr.load('unrelated');
  assert.equal(env.read()[0].body, body);
  assert.equal(playerLoads, 2);
});

test('XHR JSON and binary response types are captured', async () => {
  for (const [response, type] of [
    [JSON.parse(body), 'json'], [new TextEncoder().encode(body).buffer, 'arraybuffer'], [new Blob([body]), 'blob']
  ]) {
    const env = setup();
    const xhr = new env.XHR();
    xhr.open('GET', url);
    xhr.send();
    xhr.load(response, type);
    await settle();
    assert.equal(env.read()[0].body, body);
  }
});

test('navigation clears capture and rejects responses still loading from earlier visits', async () => {
  const env = setup();
  let finish;
  env.response.clone = () => ({ text: () => new Promise(resolve => { finish = resolve; }) });
  await env.window.fetch(url);
  env.events.get('yt-navigate-start')();
  finish(body);
  await settle();
  assert.equal(env.read().length, 0);
  env.response.clone = () => ({ text: async () => body });
  await env.window.fetch(url);
  await settle();
  assert.equal(env.read().length, 1);
  env.events.get('yt-navigate-start')();
  assert.equal(env.read().length, 0);
});

test('cache has bounded size, excludes empty bodies, and installs only once', async () => {
  const env = setup();
  const wrappedFetch = env.window.fetch;
  vm.runInContext(source, env.context);
  assert.equal(env.window.fetch, wrappedFetch);
  for (let i = 0; i < 7; i++) {
    await env.window.fetch(`${url}&tlang=language${i}`);
    await settle();
  }
  assert.equal(env.read().length, 4);
  for (const invalid of ['', 'x'.repeat(4 * 1024 * 1024 + 1)]) {
    env.response.clone = () => ({ text: async () => invalid });
    await env.window.fetch(url);
    await settle();
    assert.equal(env.read().length, 4);
  }
});
