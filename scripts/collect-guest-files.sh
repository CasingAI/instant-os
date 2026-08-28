#!/bin/sh
# 集中「拷进 XP」的全部交付物到 src/apps/virtual-machine/guest/out/。
# 02-user-phase.md 拷贝源：用户只动这一目录的 4 个文件。
#
# 用法：scripts/collect-guest-files.sh [输出目录]
#   输出目录缺省为 src/apps/virtual-machine/guest/out。
#
# 同步 4 个文件：
#   boxvideo.sys + vidmini.inf  —— 由 scripts/build-boxvnt.sh 产出
#   res-agent.exe               —— 由 scripts/build-res-agent.sh 产出（缺则现编）
#   install.reg                 —— 由 res-agent-install.reg.source 展开
#                                  （去掉 .source 扩展名、就地变 reg）
#
# 两个二进制已存在就跳过重新构建；本脚本还负责 install.reg 展开。
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUEST_DIR="$ROOT/src/apps/virtual-machine/guest"
OUT_DIR="${1:-$GUEST_DIR/out}"
BOXVNT_DIR="$GUEST_DIR/boxvnt"
BUILD_SCRIPT="$ROOT/scripts/build-boxvnt.sh"
RES_AGENT_BUILD="$ROOT/scripts/build-res-agent.sh"

mkdir -p "$OUT_DIR"

# boxvnt 产物：已存在就跳过重新构建（避免改 res-agent 路径时反复触发
# OW 完整构建）；缺则用 build 脚本生成。
if [ ! -f "$OUT_DIR/boxvideo.sys" ] || [ ! -f "$OUT_DIR/vidmini.inf" ]; then
  bash "$BUILD_SCRIPT" "$OUT_DIR"
else
  cp -f "$BOXVNT_DIR/boxvideo.sys" "$OUT_DIR/boxvideo.sys"
  cp -f "$BOXVNT_DIR/vidmini.inf"  "$OUT_DIR/vidmini.inf"
fi

# res-agent：与 boxvnt 同策略——out/ 里没有就现编一份。
if [ ! -f "$OUT_DIR/res-agent.exe" ]; then
  sh "$RES_AGENT_BUILD" "$OUT_DIR"
fi

# install.reg：模板在 res-agent 目录里以 .source 后缀入 git，展开成
# 可双击导入的 .reg。路径硬编码 C:\Tools\res-agent.exe；如果 res-agent
# 要装到别处，先编辑源模板再 collect。
cp -f "$GUEST_DIR/res-agent/res-agent-install.reg.source" "$OUT_DIR/install.reg"

# install-agent-v2.bat：服务化安装脚本（删 Run 键 + sc create + start），
# 与 res-agent.exe 一起拷进 XP 使用。服务方式是当前推荐安装形态。
cp -f "$GUEST_DIR/install-agent-v2.bat" "$OUT_DIR/install-agent-v2.bat"

echo "collected 5 files into $OUT_DIR:"
ls -la "$OUT_DIR"
