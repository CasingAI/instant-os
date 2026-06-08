#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RAPIER="$ROOT/node_modules/@dimforge/rapier3d-compat"
DEST="$ROOT/public/vendor/rapier"

if [[ ! -d "$RAPIER" ]]; then
  echo "@dimforge/rapier3d-compat is not installed. Run pnpm install first." >&2
  exit 1
fi

mkdir -p "$DEST"
cp "$RAPIER/rapier.mjs" "$DEST/rapier.mjs"

echo "Vendored Rapier runtime to public/vendor/rapier"
