#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
THREE="$ROOT/node_modules/three"
DEST="$ROOT/public/vendor/three"

if [[ ! -d "$THREE" ]]; then
  echo "three is not installed. Run pnpm install first." >&2
  exit 1
fi

mkdir -p "$DEST/examples/jsm/loaders" "$DEST/examples/jsm/controls" "$DEST/examples/jsm/utils"

cp "$THREE/build/three.module.js" "$DEST/three.module.js"
cp "$THREE/build/three.core.js" "$DEST/three.core.js"
cp "$THREE/examples/jsm/loaders/GLTFLoader.js" "$DEST/examples/jsm/loaders/"
cp "$THREE/examples/jsm/controls/OrbitControls.js" "$DEST/examples/jsm/controls/"
cp -R "$THREE/examples/jsm/utils/." "$DEST/examples/jsm/utils/"

echo "Vendored three.js runtime to public/vendor/three"
