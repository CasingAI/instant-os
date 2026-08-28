#!/bin/sh
# 编译 XP 客机代理 res-agent.exe（只编不跑，见 todo/vm-resolution-auto-align/03 §3）。
# 单测 res-agent-binary.test.ts 调用本脚本，验证产物可重现。
#
# 用法：scripts/build-res-agent.sh [输出目录]
#   输出目录缺省为 src/apps/virtual-machine/guest/res-agent。
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AGENT_DIR="$ROOT/src/apps/virtual-machine/guest/res-agent"
OUT_DIR="${1:-$AGENT_DIR}"
OUT="$OUT_DIR/res-agent.exe"

command -v zig >/dev/null 2>&1 || { echo "error: 需要 zig（brew install zig）" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "error: 需要 node" >&2; exit 1; }

ZIG_LIB_DIR="$(zig env | sed -n 's/^ *\.lib_dir = "\(.*\)",$/\1/p')"
[ -n "$ZIG_LIB_DIR" ] || { echo "error: 无法从 zig env 取得 lib_dir" >&2; exit 1; }
WIN_HEADERS="$ZIG_LIB_DIR/libc/include/any-windows-any"
[ -d "$WIN_HEADERS" ] || { echo "error: 找不到 zig 自带 Windows 头文件：$WIN_HEADERS" >&2; exit 1; }

mkdir -p "$OUT_DIR"
# -nostdlib：zig mingw CRT 默认拉 UCRT（api-ms-win-crt-*.dll），XP 上没有；
# res-agent.c 自带 memset/memcpy，入口直接指到 res_agent_entry。
# -nostdlib 下 zig 不再自动提供 Windows 头文件，要显式 -isystem。
# 链接后补 PE OS/Subsystem 版本 5.01，否则 XP 加载器拒绝（patch-pe-xp-version.mjs）。
zig cc -target x86-windows-gnu -O2 -Wall -nostdlib \
  "-isystem$WIN_HEADERS" \
  -Wl,--subsystem,windows,-e,res_agent_entry \
  -o "$OUT" "$AGENT_DIR/res-agent.c" \
  -lkernel32 -luser32 -lgdi32 -ladvapi32
node "$AGENT_DIR/patch-pe-xp-version.mjs" "$OUT"

echo "built: $OUT ($(wc -c < "$OUT") bytes)"
