#!/usr/bin/env bash
# Deploy pptx -> pdf: verify the local build, copy page files into the hub, upload the engine to R2, deploy.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT/public/t/pptx"
STATE_DIR="$ROOT/deploy/.state"
STAMP="$STATE_DIR/pptx2pdf.r2.sha256"

info() { printf '==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

[ $# -eq 1 ] || die "usage: bash deploy/pptx2pdf.sh <tool-repo>"
SRC="$(cd "$1" 2>/dev/null && pwd)" || die "no such directory: $1"
DIST="$SRC/result/dist"
R2SRC="$SRC/result/r2"

info "checking build artifacts in $SRC/result"
[ -d "$DIST" ] || die "missing $DIST — build with: cd $SRC && nix build --impure .#lo-wasm-dist"
[ -d "$R2SRC" ] || die "missing $R2SRC — build with: cd $SRC && nix build --impure .#lo-wasm-dist"
for f in index.html app.js styles.css; do
  [ -f "$DIST/$f" ] || die "missing $DIST/$f"
done
for f in sizes.json soffice.wasm soffice.data; do
  [ -f "$R2SRC/$f" ] || die "missing $R2SRC/$f — incomplete build"
done

grep -q '/ui/tokens.css' "$DIST/index.html" || die "dist/index.html does not reference /ui/ — the build predates the current web/index.html, rebuild it"
grep -q 'tool-shell' "$DIST/index.html" || die "dist/index.html has no tool-shell — rebuild it"
grep -q -- '--ak-' "$DIST/styles.css" || die "dist/styles.css has no ak-ui tokens — rebuild it"
if grep -q "const V = 'dev'" "$DIST/app.js"; then
  die "dist/app.js is unbuilt (V = 'dev') — rebuild it"
fi

info "checking wrangler"
if command -v wrangler >/dev/null 2>&1; then
  WRANGLER=(wrangler)
elif command -v npx >/dev/null 2>&1; then
  WRANGLER=(npx wrangler)
else
  die "wrangler not found — enter the dev shell first: nix develop"
fi
whoami_out="$("${WRANGLER[@]}" whoami 2>&1)" || die "wrangler whoami failed:
$whoami_out"
case "$whoami_out" in
  *"not authenticated"*|*"not logged in"*) die "wrangler is not authenticated — run: wrangler login" ;;
esac

info "copying $DIST -> $DEST"
if [ -e "$DEST" ]; then
  chmod -R u+w "$DEST"
  rm -rf "$DEST"
fi
mkdir -p "$DEST"
for entry in "$DIST"/*; do
  name="${entry##*/}"
  case "$name" in
    _headers|worker) continue ;;
  esac
  cp -a "$entry" "$DEST/"
done
chmod -R u+w "$DEST"

fingerprint() {
  (cd "$R2SRC" && find . -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1)
}
mkdir -p "$STATE_DIR"
fp="$(fingerprint)"
if [ "${FORCE_R2:-0}" != "1" ] && [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$fp" ]; then
  info "engine files unchanged — skipping R2 upload (FORCE_R2=1 to upload anyway)"
else
  JOBS="${JOBS:-8}"
  list_all="$(mktemp)"
  list_up="$(mktemp)"
  trap 'rm -f "$list_all" "$list_up"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  (cd "$R2SRC" && find . -type f -printf '%P\0' | sort -z) > "$list_all"
  uploaded=0
  while IFS= read -r -d '' rel; do
    # the worker serves <key>.br when the client accepts brotli, so raw copies with a .br sibling are dead weight
    if [ "${rel%.br}" = "$rel" ] && [ -f "$R2SRC/$rel.br" ]; then
      continue
    fi
    printf '%s\0' "$rel" >> "$list_up"
    uploaded=$((uploaded + 1))
  done < "$list_all"

  info "uploading $uploaded objects to r2://tools-site/pptx/lo/ (${JOBS} parallel, .br only when present)"
  export R2SRC ROOT
  export WRANGLER_STR="${WRANGLER[*]}"
  upload_one() {
    cd "$ROOT" || return 1
    if ! $WRANGLER_STR r2 object put "tools-site/pptx/lo/$1" --pipe --remote < "$R2SRC/$1" >/dev/null; then
      printf '  FAILED %s\n' "$1" >&2
      return 1
    fi
    printf '  uploaded %s\n' "$1"
  }
  export -f upload_one
  xargs -0 -n 1 -P "$JOBS" bash -c 'upload_one "$1"' _ < "$list_up"
  printf '%s\n' "$fp" > "$STAMP"
fi

info "deploying worker and static assets"
cd "$ROOT"
"${WRANGLER[@]}" deploy

info "done — https://<your-domain>/t/pptx/"
