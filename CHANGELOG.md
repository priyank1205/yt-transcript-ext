# Changelog

Notable changes to the extension. Version numbers match `manifest.json`, and
every released version has an entry here and on the
[Releases page](https://github.com/priyank1205/yt-transcript-ext/releases).

Write new entries under **Unreleased** as you go; `npm run bump` moves that
section under the new version number when you release.

## Unreleased

### Added

- A guided first-run setup, opened automatically on install. It asks one
  question — where the writing should come from — and takes a single pasted
  key. You no longer have to say which provider the key belongs to: its shape
  identifies it, and setup checks it with that provider before saving anything.
  A key whose shape matches nothing known is offered the provider list instead
  of being guessed at.
- A toolbar popup. Before a key exists it is one **Add API key** button; after,
  a small status card naming the provider and model a summary would actually
  use. It never displays a key.
- A badge on the toolbar icon while no provider is configured — one honest
  signal that the extension cannot do anything yet, rather than a count.

### Changed

- Keys are validated by asking the provider for its model listing instead of by
  sending a real completion. Validation is now free, returns promptly, and no
  longer reports a good key as rejected merely because its tier cannot reach
  the provider's default model — in that case setup saves a model the key *can*
  reach and says which.
- The panel's primary button reads **Add API key** and opens the setup flow.
  The first-run tooltip that used to point at the settings gear is gone: the
  button now says outright what the gear had to explain.

### Removed

- Mistral is no longer a built-in provider. The built-ins are Gemini, OpenAI and
  Anthropic; every other service — Mistral included — is reached the same way,
  through **Add a custom provider** with the endpoint URL and your own key. For
  Mistral that is `https://api.mistral.ai/v1/chat/completions`.
- The standing host permission for `api.mistral.ai`. A custom provider asks
  Chrome for access to its own host when you save it, and hands it back when you
  delete it, so nothing needs a permanent grant.

### Fixed

- Updating cleans up after the removed provider instead of leaving it in your
  settings: a saved Mistral key and its model are dropped from local storage —
  nothing could read them any more, and no settings card was left to delete
  them — and a provider selection still naming Mistral falls back to **Auto**.
  Without that last part every summary would have failed with *Unknown
  provider* until you happened to reopen settings.

If Mistral was your only configured provider you will be asked for a key again;
re-adding it as a custom provider is the way back.

## 1.3.0 — 2026-09-09

### Added

- A current playback indicator: the summary point playing now is marked as the
  video moves, with a progress hairline across the row so a long chapter does
  not look the same at its start and its end. When that row scrolls out of
  view, a marker docks under the header carrying its timestamp and title — one
  control seeks the video there, the other scrolls the list back to it. The
  list never scrolls on its own.

### Changed

- Rewritten README: a screenshot tour of the panel, an install walkthrough for
  people who have never loaded an unpacked extension, a troubleshooting
  section, diagrams of the summary pipeline and the key-isolation boundary, and
  reference tables for detail levels, providers, permissions and the
  development commands.

### Fixed

- The panel is drawn in the user's own skin and detail level on first paint,
  instead of mounting with the module defaults and correcting itself once the
  background answered — which showed as Classic swapping to Quiet, and the
  Detail chip sliding off Standard, on every page load.

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
