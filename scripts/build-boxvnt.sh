#!/bin/sh
# 编译 XP 显示驱动 boxvideo.sys（boxvnt 改造版，见 todo/vm-arbitrary-resolution/）。
# 单测 boxvnt-binary.test.ts 调用本脚本，验证产物可重现与 PE 结构。
#
# 用法：scripts/build-boxvnt.sh [输出目录]
#   输出目录缺省为 src/apps/virtual-machine/guest/boxvnt/out。
#
# 工具链：Open Watcom V2 快照（含 NT DDK 头 + videoprt.lib）。
#   - 环境变量 BOXVNT_WATCOM 指向已有 OW 树（binl/binl64/bino64/armo64 任一）
#     时直接使用；
#   - 否则用缓存的 ~/.cache/boxvnt/ow-snapshot/（首次自动下载 ~150MB，
#     GitHub 直连失败自动回落本机代理 127.0.0.1:7890）。
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DRV_DIR="$ROOT/src/apps/virtual-machine/guest/boxvnt"
OUT_DIR="${1:-$DRV_DIR/out}"

command -v node >/dev/null 2>&1 || { echo "error: 需要 node" >&2; exit 1; }

SNAPSHOT_URL="https://github.com/open-watcom/open-watcom-v2/releases/download/Last-CI-build/ow-snapshot.tar.xz"
CACHE_HOME="${XDG_CACHE_HOME:-$HOME/.cache}/boxvnt"
OW_ROOT="$CACHE_HOME/ow-snapshot"

# 已有 OW 树优先（BOXVNT_WATCOM 或缓存）。
if [ -n "${BOXVNT_WATCOM:-}" ] && [ -d "${BOXVNT_WATCOM:-}" ]; then
  OW_ROOT="$BOXVNT_WATCOM"
fi

if [ ! -d "$OW_ROOT/armo64" ] && [ ! -d "$OW_ROOT/bino64" ] && [ ! -d "$OW_ROOT/binl64" ] && [ ! -d "$OW_ROOT/binl" ]; then
  mkdir -p "$CACHE_HOME"
  TMP_TAR="$CACHE_HOME/ow-snapshot.tar.xz"
  echo "downloading Open Watcom snapshot (~150MB) ..."
  if ! curl -fL --retry 2 --max-time 900 -o "$TMP_TAR" "$SNAPSHOT_URL" \
     && [ -z "${https_proxy:-}${HTTPS_PROXY:-}" ]; then
    # 海外直连失败：回落本机常驻代理（skills/proxy-access 约定）。
    echo "direct download failed, retrying via local proxy 127.0.0.1:7890 ..."
    curl -fL --retry 2 --max-time 900 -x http://127.0.0.1:7890 -o "$TMP_TAR" "$SNAPSHOT_URL"
  fi
  rm -rf "$OW_ROOT"
  mkdir -p "$OW_ROOT"
  tar xJf "$TMP_TAR" -C "$OW_ROOT"
  rm -f "$TMP_TAR"
fi

# 按宿主选工具目录：mac arm64 → armo64；mac x64 → bino64；linux x64 → binl64；
# linux x86 → binl。快照树把这些目录平铺在根上，解包即多宿主可用。
case "$(uname -s)/$(uname -m)" in
  Darwin/arm64)  BINDIR=armo64 ;;
  Darwin/*)      BINDIR=bino64 ;;
  Linux/x86_64)  BINDIR=binl64 ;;
  Linux/*)       BINDIR=binl ;;
  *) echo "error: 未知宿主 $(uname -s)/$(uname -m)，请用 BOXVNT_WATCOM 指向可用的 OW 树" >&2; exit 1 ;;
esac
[ -x "$OW_ROOT/$BINDIR/wcc386" ] || { echo "error: $OW_ROOT/$BINDIR 缺少 wcc386" >&2; exit 1; }

export WATCOM="$OW_ROOT"
export PATH="$OW_ROOT/$BINDIR:$PATH"
# wcc386 不自动搜 $WATCOM/h；NT 目标需要三层：ddk → nt → 通用（§0 gate 实测定案）。
export INCLUDE="$WATCOM/h/nt/ddk:$WATCOM/h/nt:$WATCOM/h"

cd "$DRV_DIR"
wmake clean >/dev/null 2>&1 || true
wmake

mkdir -p "$OUT_DIR"
cp "$DRV_DIR/boxvideo.sys" "$OUT_DIR/boxvideo.sys"
cp "$DRV_DIR/vidmini.inf" "$OUT_DIR/vidmini.inf"

echo "built: $OUT_DIR/boxvideo.sys ($(wc -c < "$OUT_DIR/boxvideo.sys") bytes)"
