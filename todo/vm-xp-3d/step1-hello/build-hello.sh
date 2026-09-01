#!/bin/sh
# vm-xp-3d step1：编一个不做任何图形、只弹窗的 XP 验证程序（只编不跑）。
# 管线照抄 scripts/build-ivm-agent.sh：zig cc -nostdlib + patch PE 版本 5.01，
# 版本补丁复用 guest/res-agent/patch-pe-xp-version.mjs（lld 默认写 6.00，XP 拒载）。
# 产物只依赖 kernel32/user32，XP 裸机可加载。
# 用法：todo/vm-xp-3d/step1-hello/build-hello.sh  （产物落在本目录 out/）
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
OUT="$HERE/out/ivm-hello.exe"
SRC="$HERE/hello.c"
PATCH="$ROOT/src/apps/virtual-machine/guest/res-agent/patch-pe-xp-version.mjs"

command -v zig >/dev/null 2>&1 || { echo "error: 需要 zig（brew install zig）" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "error: 需要 node" >&2; exit 1; }
[ -f "$PATCH" ] || { echo "error: 找不到 PE 补丁脚本：$PATCH" >&2; exit 1; }

ZIG_LIB_DIR="$(zig env | sed -n 's/^ *\.lib_dir = "\(.*\)",$/\1/p')"
[ -n "$ZIG_LIB_DIR" ] || { echo "error: 无法从 zig env 取得 lib_dir" >&2; exit 1; }
WIN_HEADERS="$ZIG_LIB_DIR/libc/include/any-windows-any"
[ -d "$WIN_HEADERS" ] || { echo "error: 找不到 zig 自带 Windows 头文件：$WIN_HEADERS" >&2; exit 1; }

mkdir -p "$HERE/out"
zig cc -target x86-windows-gnu -O2 -Wall -nostdlib \
  "-isystem$WIN_HEADERS" \
  -Wl,--subsystem,windows,-e,ivm_hello_entry \
  -o "$OUT" "$SRC" \
  -lkernel32 -luser32
node "$PATCH" "$OUT"

for marker in "Step 1 OK" "MessageBoxA" "ExitProcess"; do
  LC_ALL=C grep -aq "$marker" "$OUT" || { echo "error: built exe lacks '$marker'" >&2; exit 1; }
done
echo "built: $OUT ($(wc -c < "$OUT") bytes)"

# 探针版：真窗口 + 控件 + GDI 色条 + d3d9.dll 动态加载实测（不进导入表，
# 同目录放假 d3d9.dll 时 Windows 会优先加载它，即成为 step2 假库测试台）。
PROBE="$HERE/out/ivm-3dprobe.exe"
zig cc -target x86-windows-gnu -O2 -Wall -nostdlib \
  "-isystem$WIN_HEADERS" \
  -Wl,--subsystem,windows,-e,ivm_probe_entry \
  -o "$PROBE" "$HERE/probe.c" \
  -lkernel32 -luser32 -lgdi32
node "$PATCH" "$PROBE"

for marker in "Direct3DCreate9" "CreateDevice" "ivm-3dprobe"; do
  LC_ALL=C grep -aq "$marker" "$PROBE" || { echo "error: built probe lacks '$marker'" >&2; exit 1; }
done
echo "built: $PROBE ($(wc -c < "$PROBE") bytes)"
