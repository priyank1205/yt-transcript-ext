// tools/changelog-notes.mjs
//
// Print the CHANGELOG section for one version, for use as release notes.
// Exits 1 when that version has no entry, which is the release workflow's
// signal to fall back to notes generated from commit messages rather than
// publishing a release with nothing written about it.
//
// Run: node tools/changelog-notes.mjs 1.3

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2];

if (!version) {
    console.error('Usage: node tools/changelog-notes.mjs <version>');
    process.exit(2);
}

const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');

// Headings look like "## 1.3 — 2026-09-20": match the version, then take
// everything up to the next "## " heading. Anything after the version on the
// heading line (a date, a label) is ignored.
const lines = changelog.split('\n');
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const heading = new RegExp(`^##\\s+v?${escaped}(\\s|$)`);

const start = lines.findIndex(line => heading.test(line));
if (start === -1) {
    console.error(`No CHANGELOG entry for ${version}.`);
    process.exit(1);
}

const rest = lines.slice(start + 1);
const nextHeading = rest.findIndex(line => /^##\s/.test(line));
const body = (nextHeading === -1 ? rest : rest.slice(0, nextHeading)).join('\n').trim();

if (!body) {
    console.error(`CHANGELOG entry for ${version} is empty.`);
    process.exit(1);
}

console.log(body);
