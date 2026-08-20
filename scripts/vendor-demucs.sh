#!/usr/bin/env bash
# Download HTDemucs 6-stem ONNX weights into public/assets/demucs.
# Runtime loads only this local file (no Hugging Face fetch at runtime).
#
# Model: htdemucs_6s (6 stems: drums, bass, other, vocals, guitar, piano)
#   - WebGPU-compatible ONNX (constant-folded) from kramp/htdemucs-6s-webgpu-onnx
#   - base model: StemSplitio/htdemucs-6s-onnx (MIT)
#   - original weights: Meta Demucs v4 (research / personal use only — see docs/demucs-model-license.md)
#
# The weights binary is NOT committed to git (see .gitignore). Run this script to
# fetch it into public/assets/demucs/models/ before serving.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/public/assets/demucs/models"
LICENSES="$ROOT/public/assets/demucs/licenses"
REPO="kramp/htdemucs-6s-webgpu-onnx"
FILE="htdemucs_6s.onnx"
# Expected size in bytes (x-linked-size of the HF resolve response), verified 2026-08-08.
EXPECTED_BYTES="284797240"

HF_CANDIDATES=()
if [[ -n "${HF_ENDPOINT:-}" ]]; then
  HF_CANDIDATES+=("${HF_ENDPOINT%/}")
else
  HF_CANDIDATES+=("https://huggingface.co" "https://hf-mirror.com")
fi

# Proxy support: honor explicit proxy env vars, else fall back to local dev proxy :7890.
# (This environment needs the local proxy to reach huggingface.co.)
PROXY_ARGS=()
if [[ -n "${HTTPS_PROXY:-}" || -n "${https_proxy:-}" || -n "${ALL_PROXY:-}" ]]; then
  :
elif curl -s -m 5 -x http://127.0.0.1:7890 -o /dev/null "https://huggingface.co" 2>/dev/null; then
  PROXY_ARGS=(-x http://127.0.0.1:7890)
fi

mkdir -p "$DEST" "$LICENSES"

echo "Downloading $REPO/$FILE -> $DEST/$FILE"
for base in "${HF_CANDIDATES[@]}"; do
  if curl -fsSL "${PROXY_ARGS[@]}" --connect-timeout 30 "$base/$REPO/resolve/main/$FILE" -o "$DEST/$FILE"; then
    break
  fi
  echo "Failed from $base, trying next..." >&2
  rm -f "$DEST/$FILE"
done

if [[ ! -f "$DEST/$FILE" ]]; then
  echo "Could not download $FILE from: ${HF_CANDIDATES[*]}" >&2
  exit 1
fi

# Verify size — catch truncated / LFS-stub downloads.
ACTUAL_BYTES=$(stat -f%z "$DEST/$FILE" 2>/dev/null || stat -c%s "$DEST/$FILE")
if [[ "$ACTUAL_BYTES" != "$EXPECTED_BYTES" ]]; then
  echo "Size mismatch for $FILE: expected $EXPECTED_BYTES, got $ACTUAL_BYTES" >&2
  exit 1
fi

# LICENSE is committed to git; only fetch it the first time (idempotent).
if [[ ! -f "$LICENSES/LICENSE-MIT.txt" ]]; then
  echo "Fetching MIT license text (from base model metadata) -> $LICENSES/LICENSE-MIT.txt"
  cat > "$LICENSES/LICENSE-MIT.txt" <<'EOF'
MIT License

Copyright (c) Meta Platforms, Inc. and affiliates.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
EOF
fi

echo "Done."
echo "  weights: $DEST/$FILE ($(echo "scale=1; $ACTUAL_BYTES/1000000" | bc) MB)"
echo "  license: $LICENSES/LICENSE-MIT.txt"
