#!/usr/bin/env bash
# Download sherpa-onnx Zipformer-CTC 中文识别 ONNX 权重到 public/assets/zipformer-ctc。
# 运行时只加载本地文件（不在浏览器里访问 GitHub/HF）。
#
# Model: sherpa-onnx-zipformer-ctc-zh-int8-2025-07-03
#   - 来源：k2-fsa/sherpa-onnx GitHub release asr-models
#   - 用途：歌词对齐（CTC 识别，字级时间戳），onnxruntime-web 直跑
#   - 授权：Apache-2.0（模型包内 README.md / sherpa-onnx 仓库）
#
# 权重二进制不入 git（见 .gitignore）。运行本脚本获取模型后再提供服务。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/public/assets/zipformer-ctc"
TAG="asr-models"
REPO_DIR="sherpa-onnx-zipformer-ctc-zh-int8-2025-07-03"
URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/$TAG/$REPO_DIR.tar.bz2"
# Expected size in bytes (model.int8.onnx), verified 2026-08-12.
EXPECTED_MODEL_BYTES="367074356"

# Proxy support: honor explicit proxy env vars, else fall back to local dev proxy :7890.
PROXY_ARGS=()
if [[ -n "${HTTPS_PROXY:-}" || -n "${https_proxy:-}" || -n "${ALL_PROXY:-}" ]]; then
  :
elif curl -s -m 5 -x http://127.0.0.1:7890 -o /dev/null "https://github.com" 2>/dev/null; then
  PROXY_ARGS=(-x http://127.0.0.1:7890)
fi

mkdir -p "$DEST/models"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Downloading $REPO_DIR.tar.bz2 (${URL}) ..."
curl -fsSL "${PROXY_ARGS[@]}" --connect-timeout 30 "$URL" -o "$TMP/model.tar.bz2"

echo "Extracting model.int8.onnx + tokens.txt ..."
tar -xjf "$TMP/model.tar.bz2" -C "$TMP"
cp "$TMP/$REPO_DIR/model.int8.onnx" "$DEST/models/model.int8.onnx"
cp "$TMP/$REPO_DIR/tokens.txt" "$DEST/tokens.txt"
cp "$TMP/$REPO_DIR/README.md" "$DEST/README.md"

ACTUAL_BYTES=$(stat -f%z "$DEST/models/model.int8.onnx" 2>/dev/null || stat -c%s "$DEST/models/model.int8.onnx")
if [[ "$ACTUAL_BYTES" != "$EXPECTED_MODEL_BYTES" ]]; then
  echo "Size mismatch for model.int8.onnx: expected $EXPECTED_MODEL_BYTES, got $ACTUAL_BYTES" >&2
  exit 1
fi

echo "Done."
echo "  weights: $DEST/models/model.int8.onnx"
echo "  tokens : $DEST/tokens.txt"
