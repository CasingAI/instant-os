#!/bin/sh
# 编译 XP 共享内存信箱驱动 ivm-shm.sys（todo/vm-remote-control 剪贴板通道底座）。
# 单测 ivm-shm-binary.test.ts 调用本脚本，验证产物 PE 结构与导入表。
#
# 用法：scripts/build-ivm-shm.sh [输出目录]
#   输出目录缺省为 src/apps/virtual-machine/guest/out。
#
# 工具链与 build-boxvnt.sh 完全一致：Open Watcom V2 快照（NT DDK 头 +
# ntoskrnl.lib），缓存 ~/.cache/boxvnt/ow-snapshot/（BOXVNT_WATCOM 可覆盖）。
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DRV_DIR="$ROOT/src/apps/virtual-machine/guest/ivm-shm"
OUT_DIR="${1:-$ROOT/src/apps/virtual-machine/guest/out}"
case "$OUT_DIR" in
  /*) ;;
  *) OUT_DIR="$ROOT/$OUT_DIR" ;;
esac

command -v node >/dev/null 2>&1 || { echo "error: 需要 node" >&2; exit 1; }

SNAPSHOT_URL="https://github.com/open-watcom/open-watcom-v2/releases/download/Last-CI-build/ow-snapshot.tar.xz"
CACHE_HOME="${XDG_CACHE_HOME:-$HOME/.cache}/boxvnt"
OW_ROOT="$CACHE_HOME/ow-snapshot"

if [ -n "${BOXVNT_WATCOM:-}" ] && [ -d "${BOXVNT_WATCOM:-}" ]; then
  OW_ROOT="$BOXVNT_WATCOM"
fi

if [ ! -d "$OW_ROOT/armo64" ] && [ ! -d "$OW_ROOT/bino64" ] && [ ! -d "$OW_ROOT/binl64" ] && [ ! -d "$OW_ROOT/binl" ]; then
  mkdir -p "$CACHE_HOME"
  TMP_TAR="$CACHE_HOME/ow-snapshot.tar.xz"
  echo "downloading Open Watcom snapshot (~150MB) ..."
  if ! curl -fL --retry 2 --max-time 900 -o "$TMP_TAR" "$SNAPSHOT_URL" \
     && [ -z "${https_proxy:-}${HTTPS_PROXY:-}" ]; then
    echo "direct download failed, retrying via local proxy 127.0.0.1:7890 ..."
    curl -fL --retry 2 --max-time 900 -x http://127.0.0.1:7890 -o "$TMP_TAR" "$SNAPSHOT_URL"
  fi
  rm -rf "$OW_ROOT"
  mkdir -p "$OW_ROOT"
  tar xJf "$TMP_TAR" -C "$OW_ROOT"
  rm -f "$TMP_TAR"
fi

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
export INCLUDE="$WATCOM/h/nt/ddk:$WATCOM/h/nt:$WATCOM/h"

cd "$DRV_DIR"
rm -f ivm-shm.obj ivm-shm.sys ivm-shm.map ivm-shm.err
wcc386 -q -s -ecd -wx -d1 -hc -fo=ivm-shm.obj ivm-shm.c
wlink @ivm-shm.lnk

# 与 boxvideo.sys 同一道规范化工序：wlink 的 VSize=0 段 / SubsystemVersion=1.0 /
# 间接 import 调用在 XP 加载路径上是蓝屏形态，必须修。
mkdir -p "$OUT_DIR"
node "$ROOT/scripts/normalize-boxvnt-pe.mjs" "$DRV_DIR/ivm-shm.sys" "$OUT_DIR/ivm-shm.sys"

echo "built: $OUT_DIR/ivm-shm.sys ($(wc -c < "$OUT_DIR/ivm-shm.sys") bytes)"
