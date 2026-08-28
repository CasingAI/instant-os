#!/bin/sh
# 编译 XP 剪贴板桥 clipboard-bridge.exe（todo/vm-remote-control 剪贴板通道）。
# 单测 clipboard-bridge-binary.test.ts 调用本脚本，验证产物可重现。
#
# 用法：scripts/build-clipboard-bridge.sh [输出目录]
#   输出目录缺省为 src/apps/virtual-machine/guest/out。
# 管线与 build-res-agent.sh 相同：zig cc -nostdlib + patch PE 版本 5.01。
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BRIDGE_DIR="$ROOT/src/apps/virtual-machine/guest/clipboard-bridge"
OUT_DIR="${1:-$ROOT/src/apps/virtual-machine/guest/out}"
OUT="$OUT_DIR/clipboard-bridge.exe"

command -v zig >/dev/null 2>&1 || { echo "error: 需要 zig（brew install zig）" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "error: 需要 node" >&2; exit 1; }

ZIG_LIB_DIR="$(zig env | sed -n 's/^ *\.lib_dir = "\(.*\)",$/\1/p')"
[ -n "$ZIG_LIB_DIR" ] || { echo "error: 无法从 zig env 取得 lib_dir" >&2; exit 1; }
WIN_HEADERS="$ZIG_LIB_DIR/libc/include/any-windows-any"
[ -d "$WIN_HEADERS" ] || { echo "error: 找不到 zig 自带 Windows 头文件：$WIN_HEADERS" >&2; exit 1; }

mkdir -p "$OUT_DIR"
# 仅 kernel32 + user32（剪贴板 / 设备打开），导入表保持 XP 裸机可加载。
zig cc -target x86-windows-gnu -O2 -Wall -nostdlib \
  "-isystem$WIN_HEADERS" \
  -Wl,--subsystem,windows,-e,bridge_entry \
  -o "$OUT" "$BRIDGE_DIR/clipboard-bridge.c" \
  -lkernel32 -luser32
node "$BRIDGE_DIR/../res-agent/patch-pe-xp-version.mjs" "$OUT"

echo "built: $OUT ($(wc -c < "$OUT") bytes)"
