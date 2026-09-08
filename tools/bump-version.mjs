// tools/bump-version.mjs
//
// Raise the version in manifest.json and package.json together, and open a
// CHANGELOG section for it. Two files hold the version and the release check
// refuses to publish when they disagree, so bumping by hand is a step that is
// easy to half-finish; this does both, or neither.
//
// Run: npm run bump -- patch | minor | major | 1.5.0

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = process.argv[2];

if (!arg) {
    console.error('Usage: npm run bump -- patch | minor | major | <version>');
    process.exit(2);
}

// manifest.json allows 2-4 parts, package.json needs 3. Compare and write as
// three so the two files never differ by formatting alone.
const toParts = v => {
    const parts = String(v ?? '').split('.').map(Number);
    while (parts.length < 3) parts.push(0);
    return parts.slice(0, 3);
};
const toVersion = parts => parts.join('.');

const manifestPath = join(ROOT, 'manifest.json');
const packagePath = join(ROOT, 'package.json');
const manifestRaw = readFileSync(manifestPath, 'utf8');
const packageRaw = readFileSync(packagePath, 'utf8');

const current = toVersion(toParts(JSON.parse(manifestRaw).version));
const packageCurrent = toVersion(toParts(JSON.parse(packageRaw).version));

if (current !== packageCurrent) {
    console.error(
        `manifest.json (${current}) and package.json (${packageCurrent}) disagree. ` +
        'Make them match before bumping.'
    );
    process.exit(1);
}

const [major, minor, patch] = toParts(current);
let next;
if (arg === 'major') next = toVersion([major + 1, 0, 0]);
else if (arg === 'minor') next = toVersion([major, minor + 1, 0]);
else if (arg === 'patch') next = toVersion([major, minor, patch + 1]);
else if (/^\d+\.\d+(\.\d+)?$/.test(arg)) next = toVersion(toParts(arg));
else {
    console.error(`Not a bump kind or a version: ${arg}`);
    process.exit(2);
}

// Replace only the top-level "version" line, so the rest of each file keeps the
// formatting it has. ("manifest_version" is not matched: the pattern needs a
// quote immediately before `version`.)
const setVersion = (raw, value) => {
    const pattern = /^(\s*"version":\s*")[^"]+(")/m;
    if (!pattern.test(raw)) throw new Error('No "version" field found');
    return raw.replace(pattern, `$1${value}$2`);
};

writeFileSync(manifestPath, setVersion(manifestRaw, next));
writeFileSync(packagePath, setVersion(packageRaw, next));

// Move whatever sits under "Unreleased" into a section for this version, and
// leave a fresh empty Unreleased behind. The release workflow reads that
// section for its notes.
const changelogPath = join(ROOT, 'CHANGELOG.md');
let noted = false;
let empty = false;

if (existsSync(changelogPath)) {
    const changelog = readFileSync(changelogPath, 'utf8');
    const lines = changelog.split('\n');
    const start = lines.findIndex(line => /^##\s+Unreleased\s*$/i.test(line));

    if (start !== -1) {
        const rest = lines.slice(start + 1);
        const nextHeading = rest.findIndex(line => /^##\s/.test(line));
        const body = (nextHeading === -1 ? rest : rest.slice(0, nextHeading)).join('\n').trim();
        empty = body === '';

        const today = new Date().toISOString().slice(0, 10);
        const replacement = ['## Unreleased', '', `## ${next} — ${today}`];
        if (body) replacement.push('', body);

        const tail = nextHeading === -1 ? [] : rest.slice(nextHeading);
        writeFileSync(
            changelogPath,
            [...lines.slice(0, start), ...replacement, '', ...tail].join('\n')
        );
        noted = true;
    }
}

console.log(`${current} → ${next}  (manifest.json, package.json${noted ? ', CHANGELOG.md' : ''})`);
if (empty) {
    console.log('\nNote: Unreleased was empty, so this version has no changelog entry.');
    console.log('Write one under its heading, or the release notes fall back to commit messages.');
}
console.log('\nNext: commit, then push to main. The release publishes itself.');
