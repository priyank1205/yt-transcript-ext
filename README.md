# YouTube Transcript Extractor

YouTube videos are the diamond mines of knowledge on the internet — tutorials, talks, deep dives, podcasts. But watching an hour-long video just to find one answer, or to decide if it's worth your time, is painfully inefficient.

This extension gives you a **timestamped, sectioned AI-generated summary** directly inside the YouTube page. Click any summary line to seek the video to that moment. No tabs, no copy-paste, no friction.


**Features:**

- Extracts the full timestamped transcript from any YouTube video
- Generates a structured, sectioned summary using an LLM (Gemini or Mistral)
- Every summary point is linked to its exact video timestamp — click to seek
- Expand a summary point to see in detail
- Collapse/expand the complete panel
- Model selector with Auto mode (falls back between Gemini and Mistral)
- Works on any YouTube video with captions enabled

**How it works:**

1. Open any YouTube video
2. A "Timestamped Summary" panel appears in the sidebar
3. Click **Generate summary**
4. The extension extracts the transcript, sends it to the LLM, and renders a timestamped, sectioned summary
5. Click any `[timestamp]` line to jump to that moment in the video

**Setup:**

1. Install the extension in Chrome
2. Open the extension's settings (gear icon in the panel, or right-click the extension icon)
3. Paste your API key for Gemini and/or Mistral
4. [Optional] choose a model in the panel dropdown

Get a Gemini API key: https://aistudio.google.com/apikey

Get a Mistral API key: https://console.mistral.ai/api-keys/
