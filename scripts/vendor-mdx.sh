#!/usr/bin/env bash
# Download UVR MDX-NET (vocal/instrumental 2-stem) ONNX weights into public/assets/mdx.
# Runtime loads only this local file (no Hugging Face fetch at runtime).
#
# Model: UVR-MDX-NET-Inst_full_292 (instrumental stem, frequency-domain ConvTDFNet)
#   - distributed via UVR community model repo (Eddycrack864/UVR5-MDX-NET-VIP-MODELS)
#   - architecture: KUIELab MDX-Net (MIT), exported to ONNX by UVR
#   - usage: research / personal use — see docs/mdx-model-license.md
#
# The weights binary is NOT committed to git (see .gitignore). Run this script to
# fetch it into public/assets/mdx/models/ before serving.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/public/assets/mdx/models"
LICENSES="$ROOT/public/assets/mdx/licenses"
REPO="Eddycrack864/UVR5-MDX-NET-VIP-MODELS"
FILE="UVR-MDX-NET-Inst_full_292.onnx"
# Expected size in bytes (HF tree `size` of the model file), verified 2026-08-08.
EXPECTED_BYTES="66759214"

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
if [[ ! -f "$LICENSES/LICENSE-ARCHITECTURE-MIT.txt" ]]; then
  echo "Fetching MIT license text (MDX-Net architecture, kuielab/MDX-Net) -> $LICENSES/LICENSE-ARCHITECTURE-MIT.txt"
  cat > "$LICENSES/LICENSE-ARCHITECTURE-MIT.txt" <<'EOF'
MIT License

Copyright (c) 2022 KUIELab / MDX-Net contributors

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
echo "  license: $LICENSES/LICENSE-ARCHITECTURE-MIT.txt"
