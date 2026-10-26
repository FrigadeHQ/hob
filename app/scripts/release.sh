#!/bin/sh
# A new Hob for Mac, Windows and Linux: sh app/scripts/release.sh 0.2.0
# Sets the version, commits, tags v0.2.0 and pushes. GitHub Actions (.github/workflows/release.yml) builds,
# signs and publishes the release; the download links and installed copies pick it up from there.
set -e
cd "$(dirname "$0")/../.."
VERSION="$1"
echo "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$' || { echo "usage: sh app/scripts/release.sh 1.2.3" >&2; exit 1; }
[ "$(git branch --show-current)" = main ] || { echo "release from main" >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "commit or stash your changes first" >&2; exit 1; }
git pull -q --ff-only
git rev-parse -q --verify "refs/tags/v$VERSION" >/dev/null && { echo "v$VERSION already exists" >&2; exit 1; }
node -e '
const fs = require("fs"); const p = "app/package.json"; const j = JSON.parse(fs.readFileSync(p, "utf8"))
j.version = process.argv[1]; fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n")
' "$VERSION"
git commit -qm "Hob $VERSION" app/package.json
git tag "v$VERSION"
git push -q origin main "v$VERSION"
echo "Building Hob $VERSION: https://github.com/FrigadeHQ/hob/actions/workflows/release.yml"
if command -v gh >/dev/null; then
  sleep 15
  gh run watch --exit-status "$(gh run list --workflow release.yml --branch "v$VERSION" --limit 1 --json databaseId --jq '.[0].databaseId')" >/dev/null
  echo "Published: https://github.com/FrigadeHQ/hob/releases/tag/v$VERSION"
fi
