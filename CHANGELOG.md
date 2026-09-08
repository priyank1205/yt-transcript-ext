# Changelog

Notable changes to the extension. Version numbers match `manifest.json`, and
every released version has an entry here and on the
[Releases page](https://github.com/priyank1205/yt-transcript-ext/releases).

Write new entries under **Unreleased** as you go; `npm run bump` moves that
section under the new version number when you release.

## Unreleased

## 1.2 — 2026-09-08

First published release. The extension worked before this, but could only be
installed by cloning the repository.

### Added

- Timestamped, sectioned summaries in the YouTube sidebar, with click-to-seek on every point
- A briefing card above the chapter list: a short overview, the runtime, the number of points, the reading time and the detail level used
- Brief, Standard and In-depth detail levels
- A player-caption fallback for videos whose transcript panel is missing or unreadable, including members-only videos the signed-in account can play
- Windowed summarisation, so long videos are covered end to end rather than truncated
- Gemini, OpenAI, Anthropic, Mistral and custom endpoints, with an Auto mode that falls back across configured providers
- MIT license, contribution guide, issue templates, automated checks and a packaged release zip

### Changed

- Renamed from "YouTube Transcript Extractor" to "Timestamped Summary for YouTube"
- Site access narrowed from all sites to `youtube.com` plus the configured provider APIs
- API keys are no longer readable from content scripts; the panel asks the background only for display preferences and whether a provider is configured
- Errors are shown as a persistent message with a separate Retry, instead of replacing the Generate button's label

### Fixed

- A result is bound to the video and request that produced it, so navigating away mid-generation can no longer attach one video's summary to another
- Model output, provider errors and custom provider names are rendered as text, never as HTML
- Summaries are checked for structure and timestamp bounds before they replace the panel
- Retired default models replaced, and a model chosen as a fallback is now actually saved
