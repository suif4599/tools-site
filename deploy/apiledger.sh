#!/usr/bin/env bash
# Deploy apiledger (DS Visualizer): build the WASM bundle, sync it into the hub, deploy.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

info() { printf '==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

[ $# -eq 1 ] || die "usage: bash deploy/apiledger.sh <tool-repo>"
SRC="$(cd "$1" 2>/dev/null && pwd)" || die "no such directory: $1"
DIST="$SRC/result-web"

[ -f "$SRC/flake.nix" ] || die "$SRC is not the APILedger flake repo"
[ -f "$SRC/web/index.html" ] || die "$SRC/web/index.html not found"
if git -C "$SRC" rev-parse --git-dir >/dev/null 2>&1; then
  untracked="$(git -C "$SRC" ls-files --others --exclude-standard)"
  [ -z "$untracked" ] || die "untracked files would be missing from the flake build — git add them first:
$untracked"
fi

info "building $SRC#web"
nix build --refresh "$SRC#web" --out-link "$DIST"

info "checking build artifacts"
for f in index.html app.js styles.css report.js apiledger.js apiledger.wasm vendor/echarts.min.js; do
  [ -s "$DIST/$f" ] || die "missing or empty $DIST/$f"
done
grep -q 'tool-shell' "$DIST/index.html" || die "index.html has no tool-shell — rebuild it"
grep -q 'DS Visualizer' "$DIST/index.html" || die "index.html does not show DS Visualizer — rebuild it"
grep -q -- '--ak-' "$DIST/styles.css" || die "styles.css has no ak-ui tokens — rebuild it"
[ "$(od -An -tx1 -N4 "$DIST/apiledger.wasm" | tr -d ' \n')" = "0061736d" ] || die "apiledger.wasm is not a wasm module"

cd "$ROOT"

info "checking wrangler"
[ -x node_modules/.bin/wrangler ] || die "wrangler not installed — run: nix develop -c npm install"
WHOAMI="$(nix develop -c node_modules/.bin/wrangler whoami 2>&1)" || die "wrangler whoami failed:
$WHOAMI"
case "$WHOAMI" in
  *"not authenticated"*|*"not logged in"*) die "wrangler is not authenticated — run: nix develop -c node_modules/.bin/wrangler login" ;;
esac

info "syncing $DIST -> public/t/apiledger"
nix develop -c node scripts/sync.mjs apiledger --from "$DIST"

info "regenerating hub artifacts"
nix develop -c node scripts/build.mjs

info "deploying worker and static assets"
nix develop -c node_modules/.bin/wrangler deploy

info "done — commit public/t/apiledger/, public/index.html and src/routes.gen.ts"
