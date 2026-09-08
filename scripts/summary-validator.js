// scripts/summary-validator.js
//
// A model's answer is not a summary until it has been checked against the
// transcript it came from. The prompt asks for real timestamps; this module is
// what enforces it. Every point must land on a cue that actually exists, inside
// the video's own time range, in order — and when too little survives that
// check the whole response is refused, so "success" never means the panel is
// about to show invented times.
//
// The transcript is the only source of truth here. Its text is never trusted as
// instructions; it is read purely as `[time] words` cue data.

import { apiError, ERROR_CODES } from './errors.js';

// How far a model timestamp may sit from the nearest real cue before the point
// is treated as invented rather than rounded. Widened for sparse transcripts —
// panel segments can be ten seconds apart where caption cues are two — but
// capped, so an unusually coarse transcript can't stretch the window until it
// accepts anything.
const BASE_SNAP_SECONDS = 15;
const MAX_SNAP_SECONDS = 120;

// A response that loses more than this share of its points to validation is not
// a summary with a few bad rows — it is a summary of the wrong timeline.
const MIN_SURVIVING_SHARE = 0.5;

// `[1:02:03]` / `[12:34]` / bare `12:34`, as either a transcript cue or a
// summary point. Hours are optional; minutes and seconds are two digits.
const TIME_PATTERN = /^(?:(\d{1,3}):)?(\d{1,2}):(\d{2})$/;

export function parseTimestamp(label) {
  const match = TIME_PATTERN.exec(String(label || '').trim());
  if (!match) return null;
  const hours = match[1] ? Number(match[1]) : 0;
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  // A flattened hour ("63:34" for 1:03:34) is the failure the prompt warns
  // about most, and it shows up here as minutes past 59 with no hour part.
  if (seconds > 59) return null;
  if (match[1] && minutes > 59) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

export function formatTimestamp(totalSeconds) {
  const whole = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor(whole / 60) % 60;
  const seconds = String(whole % 60).padStart(2, '0');
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${String(minutes).padStart(2, '0')}:${seconds}`;
}

/**
 * Read the transcript back into ordered cues. Both transcript sources emit
 * `[time] text` lines, so this is the one shape to parse.
 *
 * @returns {Array<{seconds:number,label:string,text:string}>}
 */
export function parseTranscriptCues(transcript) {
  const cues = [];
  for (const line of String(transcript || '').split('\n')) {
    const match = /^\s*\[(\d{1,3}:\d{1,2}(?::\d{2})?)\]\s*(.*)$/.exec(line);
    if (!match) continue;
    const seconds = parseTimestamp(match[1]);
    if (seconds === null) continue;
    cues.push({ seconds, label: match[1], text: match[2].trim() });
  }
  cues.sort((a, b) => a.seconds - b.seconds);
  return cues;
}

// The typical spacing between cues, used to widen the snap window for coarse
// transcripts. Median rather than mean so one long silent gap can't stretch it.
function medianGap(cues) {
  if (cues.length < 2) return 0;
  const gaps = [];
  for (let i = 1; i < cues.length; i++) gaps.push(cues[i].seconds - cues[i - 1].seconds);
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

// Nearest cue by time, or null when the list is empty.
function nearestCue(cues, seconds) {
  let lo = 0;
  let hi = cues.length - 1;
  if (hi < 0) return null;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].seconds < seconds) lo = mid + 1; else hi = mid;
  }
  const after = cues[lo];
  const before = cues[lo - 1];
  if (!before) return after;
  return Math.abs(after.seconds - seconds) < Math.abs(seconds - before.seconds) ? after : before;
}

// Strip the fenced block the prompt asks for, plus stray markdown. Kept
// separate from parsing so an unfenced answer reads exactly the same. Exported
// because a windowed run has to strip each window's fence before joining them:
// concatenated fences would leave the join looking like one unterminated block.
export function unwrap(raw) {
  let text = String(raw || '').replace(/\r\n?/g, '\n').trim();
  const fenced = /^```[^\n]*\n([\s\S]*?)\n?```$/.exec(text);
  if (fenced) text = fenced[1];
  return text.trim();
}

/**
 * Parse the model's output into headings and points, without judging whether
 * the timestamps are real. Exported so the shape can be tested on its own.
 *
 * @returns {{sections: Array<{heading: string|null, points: Array}>, points: Array}}
 */
export function parseSummary(raw) {
  const sections = [];
  const points = [];
  let current = null;

  const openSection = (heading) => {
    current = { heading, points: [] };
    sections.push(current);
    return current;
  };

  for (const line of unwrap(raw).split('\n')) {
    // Same normalisation the renderer applies, so what validates here is what
    // renders there: no backticks, list bullets or bold markers.
    let clean = line.replace(/`+/g, '').trim();
    if (!clean) continue;
    clean = clean.replace(/^[-*•]\s+/, '').replace(/\*\*/g, '').trim();

    if (clean.startsWith('#')) {
      openSection(clean.replace(/^#+/, '').trim());
      continue;
    }

    const match = /^\[?(\d{1,3}:\d{1,2}(?::\d{2})?)\]?\s*[-–—]?\s*(.+?)(?::\s*(.+))?$/.exec(clean);
    if (!match) continue;

    const point = {
      label: match[1],
      seconds: parseTimestamp(match[1]),
      // The renderer splits the title at the first colon, so the title stored
      // here never contains one: re-parsing the normalised text is exact.
      title: match[2].trim(),
      description: (match[3] || '').trim()
    };
    if (!current) openSection(null);
    current.points.push(point);
    points.push(point);
  }

  return { sections, points };
}

// Rebuild the canonical text the renderer parses, from validated points only.
function toText(sections) {
  const lines = [];
  for (const section of sections) {
    if (!section.points.length) continue;
    if (section.heading) lines.push(`#${section.heading}`);
    for (const point of section.points) {
      lines.push(point.description
        ? `[${point.label}] - ${point.title}: ${point.description}`
        : `[${point.label}] - ${point.title}`);
    }
  }
  return lines.join('\n');
}

// Widest uncovered stretch, counting the run-up from the first cue to the first
// point and the tail from the last point to the last cue.
function coverageGap(points, first, last) {
  if (!points.length || first === null || last === null) return null;
  let widest = null;
  const consider = (from, to) => {
    const seconds = to - from;
    if (seconds > 0 && (!widest || seconds > widest.seconds)) widest = { from, to, seconds };
  };
  consider(first, points[0].seconds);
  for (let i = 1; i < points.length; i++) consider(points[i - 1].seconds, points[i].seconds);
  consider(points[points.length - 1].seconds, last);
  return widest;
}

/**
 * Validate a model response against the transcript it summarises.
 *
 * Throws a categorised error (see scripts/errors.js) when the output is empty,
 * truncated, unparseable, or timestamped against a timeline that isn't this
 * video's. Otherwise returns the repaired summary: points snapped to their real
 * cues, out-of-range and out-of-order rows dropped, empty sections removed.
 *
 * @param {string} raw            the model's reply
 * @param {Array}  cues           parseTranscriptCues(transcript)
 * @param {{finishReason?: string}} options
 */
export function validateSummary(raw, cues = [], options = {}) {
  const finish = String(options.finishReason || '').toLowerCase();
  if (finish === 'length' || finish === 'max_tokens') {
    throw apiError(ERROR_CODES.TRUNCATED, 'The model stopped at its output limit before finishing the summary.');
  }
  if (finish === 'safety' || finish === 'recitation' || finish === 'content_filter' ||
      finish === 'prohibited_content' || finish === 'blocklist') {
    throw apiError(ERROR_CODES.BLOCKED, `The provider stopped the response (${finish}).`);
  }

  const text = unwrap(raw);
  if (!text) {
    throw apiError(ERROR_CODES.BAD_OUTPUT, 'The model returned an empty summary.');
  }

  const parsed = parseSummary(text);
  if (parsed.points.length === 0) {
    throw apiError(ERROR_CODES.BAD_OUTPUT,
      `No timestamped points could be read from the model's ${text.length}-character reply.`);
  }

  const warnings = [];
  const tolerance = Math.min(MAX_SNAP_SECONDS, Math.max(BASE_SNAP_SECONDS, medianGap(cues) * 2));
  const first = cues.length ? cues[0].seconds : null;
  const last = cues.length ? cues[cues.length - 1].seconds : null;

  let dropped = 0;
  let previous = -1;
  const seen = new Set();
  const sections = [];

  for (const section of parsed.sections) {
    const kept = [];
    for (const point of section.points) {
      if (point.seconds === null) { dropped++; continue; }
      if (!point.title) { dropped++; continue; }

      let seconds = point.seconds;
      let label = point.label;

      if (cues.length) {
        // Outside the transcript's own span, or nowhere near a cue: this is an
        // invented or rebased time, not a moment in this video.
        const cue = nearestCue(cues, seconds);
        if (Math.abs(cue.seconds - seconds) > tolerance ||
            seconds < first - tolerance || seconds > last + tolerance) {
          dropped++;
          continue;
        }
        seconds = cue.seconds;
        label = cue.label;
      }

      // Strictly increasing, one point per moment.
      if (seconds <= previous || seen.has(seconds)) { dropped++; continue; }
      previous = seconds;
      seen.add(seconds);

      kept.push({ ...point, seconds, label });
    }
    if (kept.length) sections.push({ heading: section.heading, points: kept });
  }

  const points = sections.flatMap((section) => section.points);
  const minimum = Math.max(1, Math.ceil(parsed.points.length * MIN_SURVIVING_SHARE));
  if (points.length < minimum) {
    throw apiError(ERROR_CODES.BAD_OUTPUT,
      `Only ${points.length} of ${parsed.points.length} summary points matched a real transcript timestamp.`);
  }

  if (dropped) warnings.push(`Dropped ${dropped} of ${parsed.points.length} points that did not match a transcript cue.`);
  if (!cues.length) warnings.push('No transcript cues were available, so timestamps could not be verified.');

  // The widest stretch of the video no surviving point lands in. Both ways a
  // summary goes wrong on a long video — the model skipping a span, and
  // validation dropping the points that covered it — end up looking like this,
  // and until it was measured neither left a trace beyond a silent gap in the
  // panel.
  const largestGap = coverageGap(points, first, last);
  if (largestGap && largestGap.seconds > 900) {
    warnings.push(`No summary point between ${formatTimestamp(largestGap.from)} and ` +
      `${formatTimestamp(largestGap.to)} (${Math.round(largestGap.seconds / 60)} minutes uncovered).`);
  }

  return { text: toText(sections), sections, points, dropped, warnings, largestGap };
}
