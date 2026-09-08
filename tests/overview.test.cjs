// The overview line: the two-sentence gist the panel shows above the chapter
// list. It rides inside the summary text rather than beside it, so these tests
// are mostly about one question — is a ">" line an overview, or is it drift?
// Taking the wrong one puts a stray sentence at the top of the panel; taking
// none loses the gist on exactly the long videos that need it most.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const load = (rel) => import(path.join(__dirname, rel));

const CUES = ['[00:10] first cue', '[00:20] second cue', '[00:30] third cue'].join('\n');

test('the overview line is parsed and carried in the validated text', async () => {
  const { parseTranscriptCues, validateSummary } = await load('../scripts/summary-validator.js');
  const reply = [
    '>He builds an automated obsidian line, then funds train research by farming.',
    '#Setup',
    '[00:10] - Obsidian: the lava handling comes first.',
    '[00:20] - Trains: routing follows.'
  ].join('\n');

  const result = validateSummary(reply, parseTranscriptCues(CUES));
  assert.equal(result.overview, 'He builds an automated obsidian line, then funds train research by farming.');
  assert.equal(result.points.length, 2);
  // The panel re-parses this text, so the overview has to survive the rebuild.
  assert.ok(result.text.startsWith('>He builds an automated obsidian line'));
});

test('a summary without an overview validates exactly as before', async () => {
  const { parseTranscriptCues, validateSummary } = await load('../scripts/summary-validator.js');
  const reply = ['#Setup', '[00:10] - Obsidian: first.', '[00:20] - Trains: second.'].join('\n');

  const result = validateSummary(reply, parseTranscriptCues(CUES));
  assert.equal(result.overview, null);
  assert.ok(!result.text.includes('>'));
  assert.equal(result.points.length, 2);
});

test('windowed parts contribute one overview each, in video order', async () => {
  const { parseSummary } = await load('../scripts/summary-validator.js');
  // What generateWindowed joins: each part opens with its own ">" line.
  const joined = [
    '>The build begins with lava handling',
    '#Obsidian',
    '[00:10] - Lava: handled.',
    '>The second half funds train research',
    '#Farming',
    '[00:20] - Steaks: cooked.'
  ].join('\n');

  const parsed = parseSummary(joined);
  assert.equal(parsed.overview,
    'The build begins with lava handling. The second half funds train research.');
  assert.equal(parsed.points.length, 2);
});

test('a ">" line between two points is drift, not an overview', async () => {
  const { parseSummary } = await load('../scripts/summary-validator.js');
  const parsed = parseSummary([
    '#Setup',
    '[00:10] - Obsidian: first.',
    '> a stray quoted line from the transcript',
    '[00:20] - Trains: second.'
  ].join('\n'));

  assert.equal(parsed.overview, null);
  assert.equal(parsed.points.length, 2);
});

test('the labelled form models reach for is accepted too', async () => {
  const { parseSummary } = await load('../scripts/summary-validator.js');
  const parsed = parseSummary(['Overview: what the video is about.', '#Setup', '[00:10] - A: one.'].join('\n'));
  assert.equal(parsed.overview, 'what the video is about.');
});

test('an overview long enough to be a second summary is cut back', async () => {
  const { parseSummary } = await load('../scripts/summary-validator.js');
  const parsed = parseSummary([`>${'A sentence about the video. '.repeat(40)}`, '#Setup', '[00:10] - A: one.'].join('\n'));

  assert.ok(parsed.overview.length <= 600, `overview was ${parsed.overview.length} chars`);
  // Cut at a sentence the model finished, not mid-word.
  assert.ok(parsed.overview.endsWith('.'), parsed.overview.slice(-40));
});

test('the prompt asks for an overview line, scoped to the part in a windowed run', async () => {
  const { composeSummaryPrompt } = await load('../scripts/constants.js');

  const whole = composeSummaryPrompt({ length: 'standard', durationMinutes: 20 });
  assert.match(whole, /Begin the answer with an overview line/);
  assert.ok(!whole.includes('{{'), 'every placeholder should be filled');

  const part = composeSummaryPrompt({
    length: 'standard',
    durationMinutes: 45,
    window: { index: 2, count: 4, startLabel: '45:00', endLabel: '1:30:00' }
  });
  assert.match(part, /Begin this part with an overview line/);
  assert.match(part, /single sentence of at most 25 words/);
});
