#!/bin/sh
# 编译 XP 客机全家桶 ivm-agent.exe（只编不跑）。
# 单测 ivm-agent-binary.test.ts 调用本脚本，验证产物可重现。
#
# 用法：scripts/build-ivm-agent.sh [输出目录]
#   输出目录缺省为 src/apps/virtual-machine/guest/out（客机交付物统一出口）。
#
# 三个源文件合编成一个 exe（todo/vm-experience-enhancement）：
#   res-agent/res-agent.c              COM1 遥控 + 分辨率对齐（服务身份）+ 合并入口
#   clipboard-bridge/clipboard-bridge.c OLE 剪贴板/文件桥（登录会话身份）
#   ivm-agent/ivm-mouse-install.c      /mouse-install：vmmouse 过滤驱动注册
#
# 管线与旧 build-res-agent.sh 相同：zig cc -nostdlib + patch PE 版本 5.01。
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUEST_DIR="$ROOT/src/apps/virtual-machine/guest"
OUT_DIR="${1:-$GUEST_DIR/out}"
OUT="$OUT_DIR/ivm-agent.exe"
SOURCES="$GUEST_DIR/res-agent/res-agent.c $GUEST_DIR/clipboard-bridge/clipboard-bridge.c $GUEST_DIR/ivm-agent/ivm-mouse-install.c"

command -v zig >/dev/null 2>&1 || { echo "error: 需要 zig（brew install zig）" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "error: 需要 node" >&2; exit 1; }

ZIG_LIB_DIR="$(zig env | sed -n 's/^ *\.lib_dir = "\(.*\)",$/\1/p')"
[ -n "$ZIG_LIB_DIR" ] || { echo "error: 无法从 zig env 取得 lib_dir" >&2; exit 1; }
WIN_HEADERS="$ZIG_LIB_DIR/libc/include/any-windows-any"
[ -d "$WIN_HEADERS" ] || { echo "error: 找不到 zig 自带 Windows 头文件：$WIN_HEADERS" >&2; exit 1; }

mkdir -p "$OUT_DIR"
# -nostdlib：zig mingw CRT 默认拉 UCRT（api-ms-win-crt-*.dll），XP 上没有；
# 两个 .c 各自带 memset/memcpy（static），入口直接指到 ivm_agent_entry。
# -nostdlib 下 zig 不再自动提供 Windows 头文件，要显式 -isystem。
# 导入表：kernel32/user32/gdi32（显示模式切换）+ advapi32（服务/注册表）
# + ole32（OLE 剪贴板），XP 裸机可加载。
# 链接后补 PE OS/Subsystem 版本 5.01，否则 XP 加载器拒绝（patch-pe-xp-version.mjs）。
# -DVM_AGENT_BUILD 注入构建时间戳：PONG 回执的 built= 字段（判断 XP 里的构建版本）。
BUILD_TS="$(date +%Y%m%d-%H%M%S)"
zig cc -target x86-windows-gnu -O2 -Wall -nostdlib \
  "-isystem$WIN_HEADERS" \
  "-DVM_AGENT_BUILD=\"$BUILD_TS\"" \
  -Wl,--subsystem,windows,-e,ivm_agent_entry \
  -o "$OUT" $SOURCES \
  -lkernel32 -luser32 -lgdi32 -ladvapi32 -lole32
node "$GUEST_DIR/res-agent/patch-pe-xp-version.mjs" "$OUT"

echo "built: $OUT ($(wc -c < "$OUT") bytes)"
