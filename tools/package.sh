#!/usr/bin/env bash
#
# Build the release zip: the files Chrome actually loads, and nothing else.
# Tests, the dev harness, the audit folder and the repo's own tooling stay out,
# so the uploaded package matches what the manifest declares.
#
# Run: npm run package   (writes dist/<name>-v<version>.zip)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# The manifest is the single source of truth for the version; check-manifest.mjs
# is what keeps package.json agreeing with it.
node tools/check-manifest.mjs

VERSION="$(node -p "require('./manifest.json').version")"
NAME="timestamped-summary-for-youtube"
STAGE="dist/pkg"
OUT="dist/${NAME}-v${VERSION}.zip"

rm -rf "$STAGE" "$OUT"
mkdir -p "$STAGE"

# Everything listed here is either named by the manifest or loaded by something
# that is. Adding a new top-level source directory means adding it here too.
cp manifest.json LICENSE "$STAGE/"
cp -R background scripts options styles icons "$STAGE/"

find "$STAGE" -name '.DS_Store' -delete

(cd "$STAGE" && zip -qr "../$(basename "$OUT")" .)
rm -rf "$STAGE"

SIZE="$(du -h "$OUT" | cut -f1)"
echo "Wrote $OUT ($SIZE)"
echo "Load it with Chrome > Extensions > Load unpacked (unzipped), or upload the zip to the Web Store."
