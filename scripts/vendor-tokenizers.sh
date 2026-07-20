#!/usr/bin/env bash
# Download DeepSeek V4 / MiMo tokenizer assets into public/assets/tokenizers.
# Runtime loads only these local files (no Hugging Face fetch).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/public/assets/tokenizers"
# Prefer HF_ENDPOINT; otherwise try official hub then China mirror.
HF_CANDIDATES=()
if [[ -n "${HF_ENDPOINT:-}" ]]; then
  HF_CANDIDATES+=("${HF_ENDPOINT%/}")
else
  HF_CANDIDATES+=("https://huggingface.co" "https://hf-mirror.com")
fi

download_url() {
  local path="$1"
  local out="$2"
  local base
  for base in "${HF_CANDIDATES[@]}"; do
    if curl -fsSL --connect-timeout 20 "$base/$path" -o "$out"; then
      return 0
    fi
    echo "Failed from $base, trying next..." >&2
  done
  echo "Could not download $path from: ${HF_CANDIDATES[*]}" >&2
  return 1
}

download_pair() {
  local repo="$1"
  local out_dir="$2"
  mkdir -p "$out_dir"
  echo "Downloading tokenizer from $repo -> $out_dir"
  download_url "$repo/resolve/main/tokenizer.json" "$out_dir/tokenizer.json"
  download_url "$repo/resolve/main/tokenizer_config.json" "$out_dir/tokenizer_config.json"
}

hash_file() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    sha256sum "$1" | awk '{print $1}'
  fi
}

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

download_pair "deepseek-ai/DeepSeek-V4-Pro" "$DEST/deepseek-v4"

download_pair "XiaomiMiMo/MiMo-V2-Flash" "$tmpdir/mimo-v2-flash"
download_pair "XiaomiMiMo/MiMo-V2.5" "$tmpdir/mimo-v2.5"

flash_hash="$(hash_file "$tmpdir/mimo-v2-flash/tokenizer.json")"
v25_hash="$(hash_file "$tmpdir/mimo-v2.5/tokenizer.json")"

if [[ "$flash_hash" == "$v25_hash" ]]; then
  echo "MiMo-V2-Flash and MiMo-V2.5 share the same tokenizer.json ($flash_hash); keeping one copy as mimo/"
  mkdir -p "$DEST/mimo"
  cp "$tmpdir/mimo-v2-flash/tokenizer.json" "$DEST/mimo/tokenizer.json"
  cp "$tmpdir/mimo-v2-flash/tokenizer_config.json" "$DEST/mimo/tokenizer_config.json"
  rm -rf "$DEST/mimo-v2-flash" "$DEST/mimo-v2.5"
  echo "mimo" >"$DEST/mimo-family.txt"
else
  echo "MiMo tokenizers differ; vendoring mimo-v2-flash/ and mimo-v2.5/ separately"
  mkdir -p "$DEST/mimo-v2-flash" "$DEST/mimo-v2.5"
  cp "$tmpdir/mimo-v2-flash/tokenizer.json" "$DEST/mimo-v2-flash/tokenizer.json"
  cp "$tmpdir/mimo-v2-flash/tokenizer_config.json" "$DEST/mimo-v2-flash/tokenizer_config.json"
  cp "$tmpdir/mimo-v2.5/tokenizer.json" "$DEST/mimo-v2.5/tokenizer.json"
  cp "$tmpdir/mimo-v2.5/tokenizer_config.json" "$DEST/mimo-v2.5/tokenizer_config.json"
  rm -rf "$DEST/mimo"
  echo "split" >"$DEST/mimo-family.txt"
fi

# Manifest for runtime: which directory names exist
{
  echo "deepseek-v4"
  if [[ -d "$DEST/mimo" ]]; then
    echo "mimo"
  else
    echo "mimo-v2-flash"
    echo "mimo-v2.5"
  fi
} >"$DEST/families.txt"

echo "Vendored tokenizers to $DEST"
ls -lh "$DEST"/*/tokenizer.json 2>/dev/null || true
