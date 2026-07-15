// scripts/constants.js

// Shared selectors and config
const CONSTANTS = {
  TRANSCRIPT: {
    PANEL_SELECTOR: 'ytd-engagement-panel-section-list-renderer',
    SELECTORS: {
      OLD: {
        segment: 'ytd-transcript-segment-renderer',
        timestamp: '.segment-timestamp, #timestamp',
        content: '.segment-text, #content'
      },
      NEW: {
        segment: 'transcript-segment-view-model',
        timestamp: '.ytwTranscriptSegmentViewModelTimestamp',
        content: 'span[role="text"]'
      }
    }
  },
  PROMPTS: {
    // Per-video "Detail" density model. Each preset governs ONLY the number of
    // summary points (density), how many section headings group them, and the
    // length of each description (depth). All timestamp-integrity rules live in
    // SUMMARY_PROMPT and are identical across presets.
    //
    // Rather than ask the model to do duration math in its head (which it follows
    // poorly), we compute a concrete point count from the video's real duration in
    // `densityFor` and inject exact numbers. `rate` is points-per-minute; the
    // [min,max] clamp keeps very short/long videos sensible; `depth` is the
    // description length. Ordered rates+clamps guarantee brief < standard <
    // detailed for any duration.
    LENGTH_MODEL: {
      brief: { rate: 1 / 9, min: 4, max: 8, depth: 'a single short sentence capturing only the core takeaway' },
      standard: { rate: 1 / 4, min: 8, max: 18, depth: '1–2 sentences summarizing the key idea' },
      detailed: { rate: 1 / 2, min: 14, max: 40, depth: '2–4 sentences that preserve concrete specifics — names, numbers, examples, definitions, and conclusions — so a reader need not watch the video' }
    },

    // Static fallback directives, used only when the video's duration can't be
    // parsed. They keep the same intent as the computed directives but without the
    // exact counts. A section floor is baked in so we never get a single wall.
    LENGTH_PRESETS: {
      brief: `Create only 5–8 summary points total (fewer for short videos), marking just the major sections or clear topic shifts — skip minor tangents. Keep each description to a single short sentence capturing only the core takeaway. Group the points under at least 2 section headings.`,
      standard: `Create 10–20 summary points, scaled to the video's length (roughly one every 3–5 minutes). Keep each description to 1–2 sentences summarizing the key idea. Group the points under about 2–4 section headings, never fewer than 2.`,
      detailed: `Create a fine-grained set of summary points that marks every distinct topic or subtopic (roughly one every 1–2 minutes; 20–40+ points for long videos). Write 2–4 sentences per description, preserving concrete specifics mentioned: names, numbers, examples, definitions, and conclusions. A reader should not need to watch the video. Group the points under several section headings, never fewer than 2.`
    },

    // Output-language directives (forward-design for a later slice). Empty string =
    // no instruction = the model's default (English). New languages drop in here.
    LANGUAGE_DIRECTIVES: {
      en: ''
    },

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

{{DENSITY_DIRECTIVE}}

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

Formatting (follow exactly for every point):

Start each point line with the timestamp in square brackets, then a single plain hyphen, then the title, then a colon, then the description — for example: [12:34] - Title: Description.

Use a plain hyphen "-" between the timestamp and the title. Never use an en-dash "–" or em-dash "—".

Separate the title and description with a single colon ":".

Do not use markdown bold, italics, bullet points, or backticks anywhere in the output.

Rules:

Use the number of section headings requested above; group nearby related points under each. Never output fewer than 2 sections.

Title should be short and specific.

Description content should match the level of detail requested above.

Do not write speaker-log notes like "he says" or "the speaker says" unless unavoidable.

Be concise but accurate.

{{LANGUAGE_DIRECTIVE}}

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

// Compute the concrete density for a preset from the video's real duration.
// Returns the target point count, a tight [lo,hi] band, a section count (floored
// at 2), and the description depth. Doing the arithmetic here — instead of asking
// the model to — is what makes the Detail levels reliably distinct.
export function densityFor(preset, durationMinutes) {
  const model = CONSTANTS.PROMPTS.LENGTH_MODEL[preset] || CONSTANTS.PROMPTS.LENGTH_MODEL.standard;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const target = clamp(Math.round(durationMinutes * model.rate), model.min, model.max);
  const lo = Math.max(model.min, target - 2);
  const hi = Math.min(model.max, target + 2);
  const sections = clamp(Math.round(target / 5), 2, 8);
  return { target, lo, hi, sections, depth: model.depth };
}

// Build the density directive. With a usable duration we inject exact counts;
// otherwise we fall back to the static per-preset directive.
function buildDensityDirective(preset, durationMinutes) {
  if (typeof durationMinutes === 'number' && durationMinutes > 0) {
    const { target, lo, hi, sections, depth } = densityFor(preset, durationMinutes);
    return `Create approximately ${target} summary points in total (no fewer than ${lo}, no more than ${hi}), spread evenly across the entire video from start to end — do not cluster them in the first half. Keep each description to ${depth}. Group the points under about ${sections} section headings that reflect the video's main themes; never use fewer than 2 sections.`;
  }
  const presets = CONSTANTS.PROMPTS.LENGTH_PRESETS;
  return presets[preset] || presets.standard;
}

// Build the full summary prompt for a given intent. `length` selects a density/depth
// preset (brief | standard | detailed); `durationMinutes` (when known) drives the
// computed point/section counts; `language` selects an output-language directive.
// All fall back to safe defaults so callers can pass nothing.
export function composeSummaryPrompt({ length = 'standard', language = 'en', durationMinutes = null } = {}) {
  const densityDirective = buildDensityDirective(length, durationMinutes);
  const languageDirective = CONSTANTS.PROMPTS.LANGUAGE_DIRECTIVES[language] || '';

  return CONSTANTS.PROMPTS.SUMMARY_PROMPT
    .replace('{{DENSITY_DIRECTIVE}}', densityDirective)
    .replace('{{LANGUAGE_DIRECTIVE}}', languageDirective)
    // Collapse the blank gap an empty language directive leaves behind.
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export default CONSTANTS;
