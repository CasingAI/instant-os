#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODELS="$ROOT/public/assets/3d/models"
LICENSES="$ROOT/public/assets/3d/licenses"

mkdir -p "$MODELS" "$LICENSES"

download_kaykit_pack() {
  local repo="$1"
  local dest_dir="$2"
  local addon="$3"
  local license_name="$4"
  local zip="/tmp/${repo}.zip"

  echo "Downloading ${repo}..."
  curl -sL "https://github.com/KayKit-Game-Assets/${repo}/archive/refs/heads/main.zip" -o "$zip"
  unzip -q -o "$zip" "*/Assets/gltf/*" -d "/tmp/${repo}-unzip"
  mkdir -p "$MODELS/$dest_dir"
  cp "/tmp/${repo}-unzip"/*/"${addon}"/Assets/gltf/* "$MODELS/$dest_dir/"
  curl -sL "https://raw.githubusercontent.com/KayKit-Game-Assets/${repo}/main/LICENSE.txt" \
    -o "$LICENSES/${license_name}"
}

download_kaykit_pack \
  "KayKit-Furniture-Bits-1.0" \
  "kaykit-furniture" \
  "addons/kaykit_furniture_bits" \
  "KayKit-Furniture-Bits-LICENSE.txt"

download_kaykit_pack \
  "KayKit-City-Builder-Bits-1.0" \
  "kaykit-city-builder" \
  "addons/kaykit_city_builder_bits" \
  "KayKit-City-Builder-Bits-LICENSE.txt"

download_kaykit_pack \
  "KayKit-Restaurant-Bits-1.0" \
  "kaykit-restaurant" \
  "addons/kaykit_restaurant_bits" \
  "KayKit-Restaurant-Bits-LICENSE.txt"

download_kaykit_pack \
  "KayKit-Space-Base-Bits-1.0" \
  "kaykit-space-base" \
  "addons/kaykit_space_base_bits" \
  "KayKit-Space-Base-Bits-LICENSE.txt"

download_kaykit_pack \
  "KayKit-Halloween-Bits-1.0" \
  "kaykit-halloween" \
  "addons/kaykit_halloween_bits" \
  "KayKit-Halloween-Bits-LICENSE.txt"

echo "Downloading Tiny Treats Homely House..."
TT_ZIP="/tmp/tiny-treats-homely.zip"
curl -sL "https://github.com/TinyTreats-Game-Assets/Tiny-Treats-Homely-House-1.0/archive/refs/heads/main.zip" -o "$TT_ZIP"
unzip -q -o "$TT_ZIP" "*/Assets/gltf/*" -d /tmp/tiny-treats-unzip
mkdir -p "$MODELS/tiny-treats-homely"
cp /tmp/tiny-treats-unzip/*/addons/tiny_treats_homely_house_set/Assets/gltf/* "$MODELS/tiny-treats-homely/"
curl -sL "https://raw.githubusercontent.com/TinyTreats-Game-Assets/Tiny-Treats-Homely-House-1.0/main/LICENSE.txt" \
  -o "$LICENSES/Tiny-Treats-Homely-House-LICENSE.txt"

echo "Regenerating 3D asset catalog..."
node "$ROOT/scripts/generate-3d-catalog.mjs"

echo "Done."
for dir in kaykit-furniture kaykit-city-builder kaykit-restaurant kaykit-space-base kaykit-halloween tiny-treats-homely; do
  count=$(ls "$MODELS/$dir"/*.gltf 2>/dev/null | wc -l | tr -d ' ')
  echo "  $dir: $count gltf"
done
