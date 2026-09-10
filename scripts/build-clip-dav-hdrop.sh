#!/bin/sh
# 编译一期探针的剪贴板助手 clip-dav-hdrop.exe（dav_clipboard_paste 计划）。
# 与 build-vmfile-spike.sh 同管线：zig cc -nostdlib + patch PE 版本 5.01，
# 比它多链 shell32（CommandLineToArgvW）。
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC_DIR="$ROOT/src/apps/virtual-machine/guest/clip-dav-probe"
OUT_DIR="${1:-$ROOT/src/apps/virtual-machine/guest/out}"
OUT="$OUT_DIR/clip-dav-hdrop.exe"

command -v zig >/dev/null 2>&1 || { echo "error: 需要 zig（brew install zig）" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "error: 需要 node" >&2; exit 1; }

ZIG_LIB_DIR="$(zig env | sed -n 's/^ *\.lib_dir = "\(.*\)",$/\1/p')"
[ -n "$ZIG_LIB_DIR" ] || { echo "error: 无法从 zig env 取得 lib_dir" >&2; exit 1; }
WIN_HEADERS="$ZIG_LIB_DIR/libc/include/any-windows-any"
[ -d "$WIN_HEADERS" ] || { echo "error: 找不到 zig 自带 Windows 头文件：$WIN_HEADERS" >&2; exit 1; }

mkdir -p "$OUT_DIR"
# -DCLIP_DAV_BUILD 注入构建时间戳：日志头部的 build= 字段（对上 XP 里跑的是哪一版）。
BUILD_TS="$(date +%Y%m%d-%H%M%S)"
zig cc -target x86-windows-gnu -O2 -Wall -nostdlib \
  "-isystem$WIN_HEADERS" \
  "-DCLIP_DAV_BUILD=\"$BUILD_TS\"" \
  -Wl,--subsystem,windows,-e,clipdav_entry \
  -o "$OUT" "$SRC_DIR/clip-dav-hdrop.c" \
  -lkernel32 -luser32 -lole32 -lshell32
node "$ROOT/src/apps/virtual-machine/guest/res-agent/patch-pe-xp-version.mjs" "$OUT"

# 防呆（同 build-ivm-agent.sh 口径）：产物必须含关键字符串，缺一即失败。
# grep 二进制必须钉 LC_ALL=C：BSD grep 在 UTF-8 locale 下对二进制匹配不稳定。
for marker in "clip-dav-hdrop.log" "Preferred DropEffect" "clip-dav-hdrop build="; do
  LC_ALL=C grep -aq "$marker" "$OUT" || { echo "error: built exe lacks '$marker'" >&2; exit 1; }
done

echo "built: $OUT ($(wc -c < "$OUT") bytes)"
