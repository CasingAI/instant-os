#!/usr/bin/env bash
# Download tokenizer assets into public/assets/tokenizers.
# Runtime loads only these local files (no Hugging Face fetch).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/public/assets/tokenizers"
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
    if curl -fsSL --connect-timeout 30 "$base/$path" -o "$out"; then
      return 0
    fi
    echo "Failed from $base, trying next..." >&2
  done
  echo "Could not download $path from: ${HF_CANDIDATES[*]}" >&2
  return 1
}

download_pair_to() {
  local repo="$1"
  local out_dir="$2"
  local rev="${3:-main}"
  mkdir -p "$out_dir"
  echo "Downloading tokenizer from $repo @ $rev -> $out_dir"
  download_url "$repo/resolve/$rev/tokenizer.json" "$out_dir/tokenizer.json"
  if ! download_url "$repo/resolve/$rev/tokenizer_config.json" "$out_dir/tokenizer_config.json"; then
    echo '{}' >"$out_dir/tokenizer_config.json"
  fi
}

try_download_pair() {
  local repo="$1"
  local out_dir="$2"
  local rev="${3:-main}"
  if download_pair_to "$repo" "$out_dir" "$rev" 2>/dev/null; then
    if [[ -s "$out_dir/tokenizer.json" ]]; then
      return 0
    fi
  fi
  rm -rf "$out_dir"
  return 1
}

download_first_available() {
  local out_dir="$1"
  shift
  while [[ $# -gt 0 ]]; do
    local repo="$1"
    shift
    local rev="main"
    if [[ $# -gt 0 && "$1" == @* ]]; then
      rev="${1#@}"
      shift
    fi
    if try_download_pair "$repo" "$out_dir" "$rev"; then
      echo "  -> used $repo @ $rev"
      return 0
    fi
    echo "  skip $repo @ $rev (no tokenizer.json)" >&2
  done
  echo "No tokenizer.json found for candidates" >&2
  return 1
}

hash_file() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    sha256sum "$1" | awk '{print $1}'
  fi
}

install_family() {
  local name="$1"
  local src="$2"
  mkdir -p "$DEST/$name"
  cp "$src/tokenizer.json" "$DEST/$name/tokenizer.json"
  cp "$src/tokenizer_config.json" "$DEST/$name/tokenizer_config.json"
}

merge_if_same_hash() {
  local target_name="$1"
  local source_name="$2"
  local target_hash source_hash
  target_hash="$(hash_file "$DEST/$target_name/tokenizer.json")"
  source_hash="$(hash_file "$DEST/$source_name/tokenizer.json")"
  if [[ "$target_hash" == "$source_hash" ]]; then
    echo "Merge $source_name into $target_name (same hash $target_hash)"
    rm -rf "$DEST/$source_name"
    return 0
  fi
  return 1
}

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

rm -rf "$DEST"
mkdir -p "$DEST"

# --- DeepSeek ---
download_first_available "$tmpdir/deepseek-v4" \
  "deepseek-ai/DeepSeek-V4-Pro" \
  "deepseek-ai/DeepSeek-V4-Flash"
install_family "deepseek-v4" "$tmpdir/deepseek-v4"

if download_first_available "$tmpdir/deepseek-v3" \
  "deepseek-ai/DeepSeek-V3" \
  "deepseek-ai/DeepSeek-V3.2"; then
  install_family "deepseek-v3" "$tmpdir/deepseek-v3"
  if merge_if_same_hash "deepseek-v4" "deepseek-v3"; then
    echo "deepseek-v3" >"$DEST/deepseek-v3-alias.txt"
  fi
fi

# --- MiMo ---
download_pair_to "XiaomiMiMo/MiMo-V2-Flash" "$tmpdir/mimo-v2-flash"
download_pair_to "XiaomiMiMo/MiMo-V2.5" "$tmpdir/mimo-v2.5"
flash_hash="$(hash_file "$tmpdir/mimo-v2-flash/tokenizer.json")"
v25_hash="$(hash_file "$tmpdir/mimo-v2.5/tokenizer.json")"
if [[ "$flash_hash" == "$v25_hash" ]]; then
  echo "MiMo-V2-Flash and MiMo-V2.5 share tokenizer ($flash_hash); keeping mimo/"
  install_family "mimo" "$tmpdir/mimo-v2-flash"
  echo "merged" >"$DEST/mimo-family.txt"
else
  install_family "mimo-v2-flash" "$tmpdir/mimo-v2-flash"
  install_family "mimo-v2.5" "$tmpdir/mimo-v2.5"
  echo "split" >"$DEST/mimo-family.txt"
fi

# --- Kimi ---
if download_first_available "$tmpdir/kimi" \
  "moonshotai/Kimi-K2-Instruct" "@ad1f5f7598872d622c376cb7cc376d05d4d520d1" \
  "baseten-admin/kimi-k26-tokenizer-fast" \
  "mixlayer/Kimi-K2.7-Code-Tokenizer"; then
  install_family "kimi" "$tmpdir/kimi"
fi

# --- GLM (5.2 flagship) ---
if download_first_available "$tmpdir/glm-5" \
  "zai-org/GLM-5.2" \
  "zai-org/GLM-5.2-FP8" \
  "zai-org/GLM-5.1" \
  "zai-org/GLM-5"; then
  install_family "glm-5" "$tmpdir/glm-5"
fi

if download_first_available "$tmpdir/glm-4" \
  "zai-org/GLM-4.7" \
  "zai-org/GLM-4.5"; then
  install_family "glm-4" "$tmpdir/glm-4"
  if [[ -d "$DEST/glm-5" ]] && merge_if_same_hash "glm-5" "glm-4"; then
    echo "glm-5" >"$DEST/glm-4-alias.txt"
  fi
fi

# --- Qwen ---
if download_first_available "$tmpdir/qwen3" \
  "Qwen/Qwen3-8B" \
  "Qwen/Qwen3-32B"; then
  install_family "qwen3" "$tmpdir/qwen3"
fi

if download_first_available "$tmpdir/qwen2.5" \
  "Qwen/Qwen2.5-7B-Instruct" \
  "Qwen/Qwen2.5-72B-Instruct"; then
  install_family "qwen2.5" "$tmpdir/qwen2.5"
  if [[ -d "$DEST/qwen3" ]] && merge_if_same_hash "qwen3" "qwen2.5"; then
    echo "qwen3" >"$DEST/qwen2.5-alias.txt"
  fi
fi

# --- MiniMax ---
if download_first_available "$tmpdir/minimax-m2" \
  "MiniMaxAI/MiniMax-M2.5" \
  "MiniMaxAI/MiniMax-M2"; then
  install_family "minimax-m2" "$tmpdir/minimax-m2"
fi

if download_first_available "$tmpdir/minimax-m3" \
  "MiniMaxAI/MiniMax-M3"; then
  install_family "minimax-m3" "$tmpdir/minimax-m3"
  if [[ -d "$DEST/minimax-m2" ]] && merge_if_same_hash "minimax-m2" "minimax-m3"; then
    echo "minimax-m2" >"$DEST/minimax-m3-alias.txt"
  fi
fi

# Manifest
: >"$DEST/families.txt"
for dir in "$DEST"/*/; do
  [[ -f "${dir}tokenizer.json" ]] || continue
  basename "$dir" >>"$DEST/families.txt"
done
sort -o "$DEST/families.txt" "$DEST/families.txt"

echo "Vendored tokenizers to $DEST"
cat "$DEST/families.txt"
ls -lh "$DEST"/*/tokenizer.json 2>/dev/null || true
