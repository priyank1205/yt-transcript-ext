# Contributing

This is a small, dependency-free extension. The goal is a tool that keeps
working with little maintenance, so changes are judged on whether they keep the
moving parts few rather than on how much they add.

## Running it locally

1. Clone the repo.
2. Open `chrome://extensions`, turn on **Developer mode**, and choose
   **Load unpacked** with the repo root.
3. Open the extension's settings and paste an API key for one provider.
4. Open a YouTube video and click **Generate summary**.

After you change anything, reload the extension on `chrome://extensions` **and
refresh the YouTube tab** — caption capture runs at `document_start`, so a tab
loaded before the reload is running the old script.

## Checks

No dependencies and no install step; Node 20 or newer is all that is needed.

```bash
npm run check          # manifest/version check, then the unit tests
npm test               # unit tests only
npm run test:manifest  # manifest references and version agreement only
```

For the parsing checks that need a real browser:

```bash
npm run test:browser
# then open http://127.0.0.1:8765/tests/caption-reader-browser.html
```

These use fixture captions and make no YouTube or LLM requests.

The panel itself can be worked on without an extension reload loop: serve the
repo root and open `/dev/preview.html`, which loads the real `ui-builder.js` and
both skins against a sample summary.

CI runs the same `npm run check` on Node 20 and 22, then builds the release zip
and attaches it to the run.

## Layout

| Path | What lives there |
|---|---|
| `background/service-worker.js` | Provider calls, request lifecycle, anything touching API keys |
| `scripts/` | Content scripts: extraction, caption fallback, panel rendering, validation |
| `options/` | Settings page |
| `styles/` | `content.css` (Classic) and `skin-quiet.css` (Quiet) |
| `tests/` | `node:test` suites plus the browser harness |
| `dev/preview.html` | Panel harness with stubbed `chrome.*` APIs |
| `tools/` | Manifest check and release packaging |

Two boundaries worth keeping:

- **API keys never enter a content script.** The page side asks the background
  for display preferences and one boolean saying whether a provider is
  configured. Keep it that way.
- **Model output is untrusted text.** It reaches the DOM through `textContent`
  or created text nodes, never `innerHTML`. The same goes for provider error
  strings and custom provider names.

## Style

Match the surrounding code: plain ES modules, no framework, no build step, no
TypeScript. Comments explain *why* a piece of code is shaped the way it is —
usually the failure it prevents — rather than restating what the line does.

## Releases

1. Bump `version` in `manifest.json` and `package.json` (the check requires
   they agree).
2. `npm run check`
3. `npm run package` → `dist/timestamped-summary-for-youtube-v<version>.zip`
4. Tag the commit and attach the zip to a GitHub release.

## Filing issues

Use the bug or feature template. Never paste an API key: the panel's *Copy
details* button already strips keys, signed URLs and query strings, so prefer
its output to a raw log.
