#!/bin/sh
# vm-safe-reload —— 改完运行时/客机代码后的安全 reload（todo/vm-remote-control §8）。
#
# 流程（禁止硬断电）：
#   1. 确保 debug-mode 桥在位（默认 127.0.0.1:52622，不在就起一个）
#   2. __vm.shutdown() → XP ExitWindowsEx → guest-poweroff watcher
#      → destroyCurrent（stop → 写回落盘 → 销毁）
#   3. 等 'guest-powered-off' + 'vm-destroyed'（= 写回 flush 完）+ 静置收尾
#      超时 60s → 报错退出，绝不带电 reload
#   4. eval location.reload()（iframe 重载新代码 → app 自动 start = 开机）
#   5. 等桥回连 + PONG 首现（客机起来了且 agent 活着）→ 收口
#
# 用法：scripts/vm-safe-reload.sh [--port N] [--log <桥日志>] [--boot-timeout S] [--force]
#   --port           桥端口，默认 $VM_AGENT_PORT 或 52622（与 __vm 的默认口一致）
#   --log            外部已起桥时的日志文件（用于等 vm-destroyed/PONG；自查文件时不用）
#   --boot-timeout   等 PONG 的上限秒数，默认 300
#   --force          __vm 不在（控制面未启用/虚拟机未跑）时仍继续 reload
# 环境变量：VM_AGENT_PORT / VM_BOOT_TIMEOUT_S 同名覆盖。
#
# 前置：Instant-virtual-machine dev server（默认 localhost:6175）在跑、
# 页面带 ?agent=<port> 或 debug 构建（isDebugMode）。
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_SERVER="$HOME/.zcode/skills/debug-mode/scripts/log-server.mjs"

PORT="${VM_AGENT_PORT:-52622}"
BOOT_TIMEOUT="${VM_BOOT_TIMEOUT_S:-300}"
FORCE=0
LOG_FILE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --log) LOG_FILE="$2"; shift 2 ;;
    --boot-timeout) BOOT_TIMEOUT="$2"; shift 2 ;;
    --force) FORCE=1; shift ;;
    *) echo "error: 未知参数 $1" >&2; exit 1 ;;
  esac
done

command -v curl >/dev/null 2>&1 || { echo "error: 需要 curl" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "error: 需要 node" >&2; exit 1; }
[ -f "$LOG_SERVER" ] || { echo "error: 找不到桥服务器 $LOG_SERVER" >&2; exit 1; }

BRIDGE="http://127.0.0.1:$PORT"

say() { printf '[vm-safe-reload] %s\n' "$*"; }
die() { printf '[vm-safe-reload] error: %s\n' "$*" >&2; exit 1; }

json_arg() { node -e 'process.stdout.write(JSON.stringify({ code: process.argv[1] }))' "$1"; }

# 桥 /eval：页面全局作用域执行，响应 {value|error}（value 是再序列化过的字符串）
vm_eval() {
  curl -s --max-time 70 -X POST "$BRIDGE/eval" \
    -H 'Content-Type: application/json' \
    -d "$(json_arg "$1")"
}

# 从 vm_eval 响应里取 value 字段（失败时打印原始响应并返回空）
eval_value() {
  printf '%s' "$1" | node -e '
    let raw = "";
    process.stdin.on("data", (c) => (raw += c));
    process.stdin.on("end", () => {
      try {
        const resp = JSON.parse(raw);
        if (resp.error) { process.stdout.write(""); }
        else { process.stdout.write(String(resp.value ?? "")); }
      } catch { process.stdout.write(""); }
    });
  '
}

bridge_health() { curl -sf --max-time 3 "$BRIDGE/health" 2>/dev/null || true; }

bridge_waiters() {
  printf '%s' "$(bridge_health)" | node -e '
    let raw = "";
    process.stdin.on("data", (c) => (raw += c));
    process.stdin.on("end", () => {
      try { process.stdout.write(String(JSON.parse(raw).bridgeWaiters ?? 0)); }
      catch { process.stdout.write("0"); }
    });
  '
}

# 等桥页面侧在线（bridgeWaiters>0）
wait_bridge_online() {
  i=0
  while [ "$i" -lt "$1" ]; do
    if [ "$(bridge_waiters)" -gt 0 ]; then return 0; fi
    sleep 1; i=$((i + 1))
  done
  return 1
}

# 等日志文件里出现模式（只看 offset 之后的新内容）
log_wait() { # $1=pattern $2=timeout_s $3=起始偏移
  i=0
  while [ "$i" -lt "$2" ]; do
    if [ -n "$LOG_FILE" ] && [ -f "$LOG_FILE" ]; then
      if tail -c +"$(( $3 + 1 ))" "$LOG_FILE" 2>/dev/null | grep -q "$1"; then
        return 0
      fi
    fi
    sleep 1; i=$((i + 1))
  done
  return 1
}

# ---- 1. 桥在位 ----

if [ -z "$(bridge_health)" ]; then
  say "桥 $BRIDGE 不在位，起一个（日志 $ROOT/.zcode/debug/）"
  DEBUG_DIR="$ROOT/.zcode/debug"
  mkdir -p "$DEBUG_DIR"
  LOG_FILE="$DEBUG_DIR/$(date +%Y%m%d-%H%M%S)-safe-reload.log"
  BRIDGE_STDOUT="$(mktemp)"
  nohup node "$LOG_SERVER" --out "$LOG_FILE" --port "$PORT" >"$BRIDGE_STDOUT" 2>&1 &
  BRIDGE_PID=$!
  i=0
  while [ "$i" -lt 50 ]; do
    [ -n "$(bridge_health)" ] && break
    sleep 0.2; i=$((i + 1))
  done
  if [ -z "$(bridge_health)" ]; then
    cat "$BRIDGE_STDOUT" >&2
    die "桥启动失败（端口 $PORT 被占？换 --port）"
  fi
  say "桥已启动 pid=${BRIDGE_PID} 日志=${LOG_FILE}（本脚本退出后保留运行）"
else
  say "桥已在位 $BRIDGE"
fi

wait_bridge_online 30 || die "页面侧桥 30s 未上线（iframe 未开 / 未带 ?agent=${PORT}）"

# ---- 2. 软关机 ----

VM_STATE="$(eval_value "$(vm_eval 'window.__vm ? JSON.stringify(__vm.state()) : "no-vm"')")"
if [ -z "$VM_STATE" ] || [ "$VM_STATE" = "no-vm" ] || [ "$VM_STATE" = '"no-vm"' ]; then
  if [ "$FORCE" -ne 1 ]; then
    die "__vm 不在（控制面未启用或实例未绑定）。确认 iframe 是 debug 构建或带 ?agent=${PORT}；确认要跳过关机用 --force"
  fi
  say "__vm 不在，--force：跳过软关机直接 reload"
else
  say "当前状态：$VM_STATE"
  LOG_OFFSET=0
  [ -n "$LOG_FILE" ] && [ -f "$LOG_FILE" ] && LOG_OFFSET=$(wc -c < "$LOG_FILE" | tr -d ' ')
  say "下发 __vm.shutdown()（XP ExitWindowsEx → 切电 → destroyCurrent 落盘）"
  vm_eval '__vm.shutdown(), "shutdown-sent"' >/dev/null

  # 等待解绑（__vm 摘除）= destroyCurrent 已开跑
  i=0
  UNBOUND=0
  while [ "$i" -lt 60 ]; do
    V="$(eval_value "$(vm_eval 'window.__vm ? "bound" : "unbound"')")"
    if [ "$V" = "unbound" ]; then UNBOUND=1; break; fi
    sleep 1; i=$((i + 1))
  done
  if [ "$UNBOUND" -ne 1 ]; then
    die "60s 内未见关机进展（agent 没跑起来？ExitWindowsEx 失败？）。绝不带电 reload；排查后重试"
  fi
  say "客机已切电（__vm 已解绑），等写回 flush 完成"

  # vm-destroyed 在 stop+drain 全部结束后才记录；有日志文件就精确等，否则静置兜底
  if [ -n "$LOG_FILE" ] && [ -f "$LOG_FILE" ]; then
    log_wait '"event":"vm-destroyed"' 60 "$LOG_OFFSET" || die "60s 等不到 vm-destroyed（写回卡死？），中止"
  else
    sleep 5
  fi
  say "写回 flush 完成（vm-destroyed）"
fi

sleep 2  # 宿主侧落盘的收尾静置

# ---- 3. reload（重载新代码，app 自动 start = 开机）----

say "reload iframe（新代码生效，app 自动开机）"
# 先 setTimeout 再 reload：eval 能立刻返回结果，不会因页面销毁挂住 60s
vm_eval 'setTimeout(() => location.reload(), 250), "reload-scheduled"' >/dev/null

# ---- 4. 等桥回连 + PONG 首现 ----

sleep 2
wait_bridge_online 60 || say "WARN: 页面侧桥 60s 未回连（reload 失败？自行检查 dev server）"
say "桥已回连，等 PONG 首现（boot 上限 ${BOOT_TIMEOUT}s）"

PONG_OFFSET=0
[ -n "$LOG_FILE" ] && [ -f "$LOG_FILE" ] && PONG_OFFSET=$(wc -c < "$LOG_FILE" | tr -d ' ')
i=0
while [ "$i" -lt "$BOOT_TIMEOUT" ]; do
  V="$(eval_value "$(vm_eval 'window.__vm && __vm.state().lastPongAgeMs !== null ? "pong:" + __vm.state().bootStage : (window.__vm ? "stage:" + __vm.state().bootStage : "no-vm")')")"
  case "$V" in
    pong:*) say "PONG 已到（stage=${V#pong:}）——客机起来了且 agent 活着"; exit 0 ;;
    stage:*) ;;
    no-vm|*) ;;
  esac
  if [ -n "$LOG_FILE" ] && [ -f "$LOG_FILE" ]; then
    if tail -c +"$(( $PONG_OFFSET + 1 ))" "$LOG_FILE" 2>/dev/null | grep -q '"event":"pong-first"'; then
      say "PONG 已到（日志确认）"; exit 0
    fi
  fi
  sleep 3; i=$((i + 3))
done

die "${BOOT_TIMEOUT}s 未见 PONG：客机没起来或 agent 没跑。检查截图/启动时间线后重试"
