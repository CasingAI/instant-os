#!/bin/sh
# 编译 M1 验证程序 vmfile-spike.exe（XP 虚拟文件粘贴 spike）。
# 与 build-clipboard-bridge.sh 同管线：zig cc -nostdlib + patch PE 版本 5.01，
# 仅多链 ole32（OleInitialize/OleSetClipboard）。
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC_DIR="$ROOT/src/apps/virtual-machine/guest/vmfile-spike"
OUT_DIR="${1:-$ROOT/src/apps/virtual-machine/guest/out}"
OUT="$OUT_DIR/vmfile-spike.exe"

command -v zig >/dev/null 2>&1 || { echo "error: 需要 zig（brew install zig）" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "error: 需要 node" >&2; exit 1; }

ZIG_LIB_DIR="$(zig env | sed -n 's/^ *\.lib_dir = "\(.*\)",$/\1/p')"
[ -n "$ZIG_LIB_DIR" ] || { echo "error: 无法从 zig env 取得 lib_dir" >&2; exit 1; }
WIN_HEADERS="$ZIG_LIB_DIR/libc/include/any-windows-any"
[ -d "$WIN_HEADERS" ] || { echo "error: 找不到 zig 自带 Windows 头文件：$WIN_HEADERS" >&2; exit 1; }

mkdir -p "$OUT_DIR"
zig cc -target x86-windows-gnu -O2 -Wall -nostdlib \
  "-isystem$WIN_HEADERS" \
  -Wl,--subsystem,windows,-e,spike_entry \
  -o "$OUT" "$SRC_DIR/vmfile-spike.c" \
  -lkernel32 -luser32 -lole32
node "$ROOT/src/apps/virtual-machine/guest/res-agent/patch-pe-xp-version.mjs" "$OUT"

echo "built: $OUT ($(wc -c < "$OUT") bytes)"
