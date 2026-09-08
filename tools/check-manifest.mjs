// tools/check-manifest.mjs
//
// The cheap half of a release check: prove the manifest still points at files
// that exist, and that the two places recording a version agree. A renamed or
// deleted script is otherwise silent until the extension is loaded in Chrome,
// and a version that drifts between manifest.json and package.json produces a
// release zip whose name doesn't match what it installs as.
//
// Run: node tools/check-manifest.mjs

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];

function readJson(relPath) {
    try {
        return JSON.parse(readFileSync(join(ROOT, relPath), 'utf8'));
    } catch (err) {
        problems.push(`${relPath} could not be parsed: ${err.message}`);
        return null;
    }
}

const manifest = readJson('manifest.json');
const pkg = readJson('package.json');

// --- referenced files exist -------------------------------------------------

// Every manifest field that names a file, flattened to {field, path} pairs so a
// failure can say which key pointed at the missing file.
function manifestFileRefs(m) {
    const refs = [];
    const add = (field, value) => {
        if (typeof value === 'string' && value) refs.push({ field, path: value });
    };

    add('background.service_worker', m.background?.service_worker);
    add('options_page', m.options_page);
    add('options_ui.page', m.options_ui?.page);

    for (const [size, path] of Object.entries(m.icons || {})) add(`icons.${size}`, path);
    for (const [size, path] of Object.entries(m.action?.default_icon || {})) {
        add(`action.default_icon.${size}`, path);
    }

    (m.content_scripts || []).forEach((entry, i) => {
        (entry.js || []).forEach(p => add(`content_scripts[${i}].js`, p));
        (entry.css || []).forEach(p => add(`content_scripts[${i}].css`, p));
    });

    (m.web_accessible_resources || []).forEach((entry, i) => {
        (entry.resources || []).forEach(p => {
            // Patterns are matched at runtime, not resolved as paths.
            if (!p.includes('*')) add(`web_accessible_resources[${i}].resources`, p);
        });
    });

    return refs;
}

if (manifest) {
    for (const { field, path } of manifestFileRefs(manifest)) {
        if (!existsSync(join(ROOT, path))) {
            problems.push(`manifest ${field} points at a missing file: ${path}`);
        }
    }
}

// --- relative imports resolve ----------------------------------------------

// The service worker's own imports are invisible to the manifest, so a module
// renamed under scripts/ breaks generation with nothing failing until runtime.
function checkImports(relFile) {
    const abs = join(ROOT, relFile);
    if (!existsSync(abs)) return;
    const source = readFileSync(abs, 'utf8');
    const pattern = /\bfrom\s+['"](\.[^'"]+)['"]|\bimport\s+['"](\.[^'"]+)['"]/g;
    for (const match of source.matchAll(pattern)) {
        const spec = match[1] || match[2];
        const target = resolve(dirname(abs), spec);
        if (!existsSync(target)) {
            problems.push(`${relFile} imports a missing module: ${spec}`);
        }
    }
}

checkImports('background/service-worker.js');

// --- versions agree ---------------------------------------------------------

// manifest.json allows 2-4 parts ("1.2"); package.json needs full semver. Pad
// both to three parts before comparing so "1.2" and "1.2.0" count as the same
// release rather than as a mismatch to chase.
function padVersion(v) {
    const parts = String(v ?? '').split('.');
    while (parts.length < 3) parts.push('0');
    return parts.slice(0, 3).join('.');
}

if (manifest && pkg) {
    if (!/^\d+(\.\d+){1,3}$/.test(String(manifest.version ?? ''))) {
        problems.push(`manifest version is not a valid extension version: ${manifest.version}`);
    } else if (padVersion(manifest.version) !== padVersion(pkg.version)) {
        problems.push(
            `version mismatch: manifest.json ${manifest.version} vs package.json ${pkg.version}`
        );
    }
}

// --- report -----------------------------------------------------------------

if (problems.length) {
    console.error('Manifest check failed:');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
}

console.log(`Manifest check passed (version ${manifest.version}).`);
