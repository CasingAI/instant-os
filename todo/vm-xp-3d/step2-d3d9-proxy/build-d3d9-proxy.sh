#!/bin/sh
# vm-xp-3d step2：编假 Direct3D 9 库 d3d9-proxy.dll（只编不跑）。
# 管线：zig cc -shared -nostdlib + patch PE 5.01 + patch 导出名去 @n 修饰。
# 部署时改名 d3d9.dll，放在目标 exe（当前测试台 ivm-3dprobe.exe）同目录。
# 用法：todo/vm-xp-3d/step2-d3d9-proxy/build-d3d9-proxy.sh
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
OUT="$HERE/out/d3d9-proxy.dll"
SRC="$HERE/d3d9-proxy.c"
PATCH_PE="$ROOT/src/apps/virtual-machine/guest/res-agent/patch-pe-xp-version.mjs"
PATCH_KILLAT="$HERE/patch-export-kill-at.mjs"
STUBS="$HERE/d3d9-proxy-stubs.h"

command -v zig >/dev/null 2>&1 || { echo "error: 需要 zig（brew install zig）" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "error: 需要 node" >&2; exit 1; }
[ -f "$PATCH_PE" ] || { echo "error: 找不到 PE 补丁脚本：$PATCH_PE" >&2; exit 1; }
[ -f "$STUBS" ] || { echo "error: 缺 $STUBS，先跑 node gen-stubs.mjs" >&2; exit 1; }

ZIG_LIB_DIR="$(zig env | sed -n 's/^ *\.lib_dir = "\(.*\)",$/\1/p')"
[ -n "$ZIG_LIB_DIR" ] || { echo "error: 无法从 zig env 取得 lib_dir" >&2; exit 1; }
WIN_HEADERS="$ZIG_LIB_DIR/libc/include/any-windows-any"
[ -d "$WIN_HEADERS" ] || { echo "error: 找不到 zig 自带 Windows 头文件：$WIN_HEADERS" >&2; exit 1; }

mkdir -p "$HERE/out"
zig cc -target x86-windows-gnu -O2 -Wall -nostdlib \
  "-isystem$WIN_HEADERS" \
  -shared -Wl,--subsystem,windows \
  -o "$OUT" "$SRC" \
  -lkernel32 -luser32
node "$PATCH_PE" "$OUT"
node "$PATCH_KILLAT" "$OUT"

# 防呆：产物必须含导出名/日志名/信箱 magic 关键串，缺一即失败。
for marker in "Direct3DCreate9" "d3d9-proxy.log" "IVMSHM"; do
  LC_ALL=C grep -aq "$marker" "$OUT" || { echo "error: built dll lacks '$marker'" >&2; exit 1; }
done

echo "built: $OUT ($(wc -c < "$OUT") bytes)"
