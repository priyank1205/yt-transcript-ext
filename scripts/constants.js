// scripts/constants.js

// Shared selectors and config
const CONSTANTS = {
  YOUTUBE_SELECTORS: {
    SECONDARY: 'ytd-watch-flexy #secondary',
    TRANSCRIPT_BUTTON: 'button, ytd-button-renderer',
    TRANSCRIPT_PANEL: 'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]',
    TRANSCRIPT_SEGMENT: 'ytd-transcript-segment-renderer',
    TIMESTAMP: '.segment-timestamp, #timestamp',
    CONTENT: '.segment-text, #content'
  },
  API_ENDPOINTS: {
    GEMINI: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent',
    MISTRAL: 'https://api.mistral.ai/v1/chat/completions'
  },
  MODELS: {
    GEMINI: 'gemini',
    MISTRAL: 'mistral'
  },
  PROMPTS: {
    SUMMARY_PROMPT: `Act as an Expert Video Summarizer.

Your job is to generate an accurate timestamped summary from the pasted timestamped transcript.

Timestamps are absolute video-clock timestamps, not relative transcript offsets.

Use ONLY timestamps that already exist in the transcript. Never invent, estimate, interpolate, normalize, offset, compress, or recalculate timestamps.

Core rules
First detect:

T_start = first timestamp in transcript

T_end = last timestamp in transcript

Treat all transcript timestamps as absolute video time.

Do NOT rebase timestamps relative to T_start.

Do NOT subtract skipped intro time.

Do NOT convert later timestamps into a shorter timeline.

Do NOT "compress" the second half of the video.

If the transcript starts at 00:47, the summary must start at 00:47 or later, not 00:00.

If the transcript contains 1:25:29, output 1:25:29 exactly if that is the matched source timestamp.

Use only verified source timestamps.

Every summary timestamp must match a real timestamp present in the transcript.

Never output a timestamp that is not explicitly written in the transcript.

If unsure between two moments, choose the nearest exact transcript timestamp, never an invented one.

Segment the full transcript span.

Create 10–30 summary points depending on transcript length.

Cover beginning, middle, and end proportionally.

Final summary point must fall near T_end.

Do not overweight only the first 30–40 minutes.

Timestamp format rules
Output timestamps exactly according to the original video clock:

For times under 1 hour, use:
[mm:ss]

For times of 1 hour or more, use:
[h:mm:ss]

Examples:
[00:47]
[24:58]
[59:42]
[1:03:34]
[1:25:29]

Strict formatting rules:

Never flatten hour-based timestamps into total minutes.

Never output 63:34 if the real timestamp is 1:03:34.

Never output 65:29 if the real timestamp is 1:25:29.

If hours are present, minutes must remain 00–59.

Seconds must always remain 00–59.

Summary style
Use this exact format:

#Section Heading
[timestamp] - Title: Description

Rules:

Section headings should group nearby related points.

Title should be short and specific.

Description should summarize the key idea only.

Do not write speaker-log notes like "he says" or "the speaker says" unless unavoidable.

Be concise but accurate.

Mandatory self-check before final output
Before answering, verify all of these:

The first summary timestamp is >= T_start and is never 00:00 unless transcript starts at 00:00.

The last summary timestamp is near T_end.

All timestamps appear exactly in the transcript.

Timestamps are strictly increasing.

No timestamp was recalculated from an earlier one.

No timestamp was converted into a shortened minute-only form.

No later part of the transcript has been shifted backward.

Any timestamp >= 1 hour is shown in [h:mm:ss] format.

Beginning, middle, and end are all covered.

If any check fails, correct it before producing the answer.

Output rule
Return ONLY the final timestamped summary in one fenced code block.

Output nothing else.
No explanations.
No notes.
No citations.
No validation logs.
Pure summary only.`
  }
};

// Export constants for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONSTANTS;
}