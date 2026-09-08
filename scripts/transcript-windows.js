// scripts/transcript-windows.js
//
// A five-hour transcript does not survive being summarised in one request. Both
// ends of the call run out of room: the model reads a hundred thousand tokens of
// cues and then has to hold an even, hour-by-hour plan across a single very long
// answer. What it actually does is thin out as it goes — or drop a stretch of
// the video outright, which is how a summary ends up jumping from 3:09 to 5:08.
// No prompt fixes that on its own, because the instruction is competing with the
// model's own pull toward a shorter answer, and that pull grows with the length
// of the input.
//
// So a long video is summarised in windows: consecutive slices of the video,
// each its own request over its own slice of the transcript. A window cannot be
// skipped, because there is nothing else in the request to skip it for, and its
// share of the points is decided here rather than by the model's stamina. The
// windows are ordered and disjoint, so the summaries concatenate into one
// timeline that still validates against the full cue list.
//
// Total token cost is roughly unchanged — the same transcript is read once
// either way, just split across calls — so this buys coverage rather than
// spending tokens for it.

import { parseTimestamp, formatTimestamp } from './summary-validator.js';

// How much video one request should be asked to cover. At the In-depth rate a
// 45-minute window is about 23 points — a few thousand output tokens, well
// inside the length any model writes reliably in one go.
export const WINDOW_TARGET_MINUTES = 45;

// Below this, one request is the right shape: the whole transcript fits
// comfortably and splitting it would only add round trips.
export const WINDOW_THRESHOLD_MINUTES = 90;

// A cue line, as both transcript sources emit it: `[h:mm:ss] words`.
const CUE_LINE = /^\s*\[(\d{1,3}:\d{1,2}(?::\d{2})?)\]/;

/**
 * Split the transcript text into the given time ranges, by line.
 *
 * Slicing the original text rather than rebuilding it from parsed cues keeps
 * whatever the transcript actually contained. A line carrying no timestamp of
 * its own belongs with the cue above it, so it travels into the same window.
 */
function sliceByRanges(transcript, ranges) {
  const buckets = ranges.map(() => []);
  let bucket = 0;
  for (const line of String(transcript || '').split('\n')) {
    if (!line.trim()) continue;
    const match = CUE_LINE.exec(line);
    if (match) {
      const seconds = parseTimestamp(match[1]);
      // Ranges are ordered and cues arrive in order, so this only moves forward.
      if (seconds !== null) {
        while (bucket < ranges.length - 1 && seconds >= ranges[bucket].endSeconds) bucket++;
      }
    }
    buckets[bucket].push(line);
  }
  return buckets.map((lines) => lines.join('\n'));
}

/**
 * Plan the windows a transcript should be summarised in.
 *
 * Returns an empty array when the video is short enough that one request is the
 * right shape — the caller keeps its existing single-call path untouched.
 * Otherwise returns ordered, disjoint windows covering the whole transcript.
 *
 * @param {string} transcript  the full transcript text
 * @param {Array}  cues        parseTranscriptCues(transcript)
 * @returns {Array<{index:number,count:number,startSeconds:number,endSeconds:number,
 *                  startLabel:string,endLabel:string,durationMinutes:number,transcript:string}>}
 */
export function planWindows(transcript, cues, options = {}) {
  const targetMinutes = options.targetMinutes || WINDOW_TARGET_MINUTES;
  const thresholdMinutes = options.thresholdMinutes || WINDOW_THRESHOLD_MINUTES;
  if (!cues || cues.length < 2) return [];

  const first = cues[0].seconds;
  const last = cues[cues.length - 1].seconds;
  const spanMinutes = (last - first) / 60;
  if (!(spanMinutes > thresholdMinutes)) return [];

  // Equal windows, so no run ends on a stub that earns a floor's worth of
  // points it hasn't got the material for.
  const count = Math.max(2, Math.round(spanMinutes / targetMinutes));
  const step = (last - first) / count;

  const ranges = [];
  for (let i = 0; i < count; i++) {
    ranges.push({
      startSeconds: first + step * i,
      // The final window keeps the last cue: its end is inclusive, and a cue
      // sitting exactly on a boundary belongs to the window it opens.
      endSeconds: i === count - 1 ? last + 1 : first + step * (i + 1)
    });
  }

  const texts = sliceByRanges(transcript, ranges);
  return ranges.map((range, i) => ({
    index: i + 1,
    count,
    startSeconds: range.startSeconds,
    endSeconds: Math.min(last, range.endSeconds),
    startLabel: formatTimestamp(range.startSeconds),
    endLabel: formatTimestamp(Math.min(last, range.endSeconds)),
    durationMinutes: step / 60,
    transcript: texts[i]
  })).filter((window) => window.transcript.trim().length > 0);
}
