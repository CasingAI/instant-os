# 04 · Instant-virtual-machine 侧改动（✅ 已由 AI 套上）

> 建立：2026-08-26；**同日套用完成**。
> 初版背景：该目录曾对 AI 进程报 `Operation not permitted`（macOS 目录保护），
> 本文件当时按「照抄片段清单」交付。随后你把目录访问授权给终端，AI 已直接把
> 全部片段写进 `Instant-virtual-machine` 并验证通过，本文件转为**落地记录**；
> 下方的片段设计稿留作背景资料。

## ✅ 实际落地清单（全部在 Instant-virtual-machine）

### 第三轮：串口通道收口（2026-08-27，v5 实机验证后）

串口链路逐段验证全通但帧永远解不出——根因在 **instant-app 侧客机代理**（不是本仓库）：
COM1 初始为 7 数据位，XP 驱动按 7-bit 收把每个字节最高位剥掉（魔数 `A5→25`），
代理 `BuildCommDCBA("9600,n,8,1")` 显式声明 8N1 后实机通过（00 §8.8）。
本仓库侧随收口移除全部调试插桩：

| 文件 | 改动 |
|---|---|
| `src/resolution-serial.ts` | 删除 pump 的日志 fetch 与 framesSent 计数（纯调试产物） |
| `src/v86-runtime.ts` | 删除 `installSerialProbes`（BDA 采样 E / serial0-output-byte 监听 F）与 start()/setResolution 的日志 fetch |

**验证**：13 个测试套全绿 + tsc --noEmit + vite build；instant-app 侧 `pnpm typecheck` 净、
`pnpm test:vm-res-agent` 绿（代理产物 7680 字节，导入表仅 kernel32+user32）。

### 第二轮：串口载体（2026-08-26 晚，§8.3 终版定案后）

真机 diag 证明 ring3 IN 不可达（00 §8.3），端口路径整体拆除、换成 COM1 广播：

| 文件 | 改动 |
|---|---|
| `src/resolution-serial.ts` | **新增**：7 字节帧编码（A5 \| len \| 打包值小端 \| 累加和）、`startResolutionSerial` 广播泵（立即一帧 + 每秒重播，`bus.send('serial0-input', 字节)`）、`notifyResolutionTargetChanged` 立即下发、`stopResolutionSerial` |
| `src/v86-runtime.ts` | start() 的端口注册替换为 `startResolutionSerial(next.bus)`（同一开关门控）；`setResolution` 增加 `notifyResolutionTargetChanged()`；`destroyCurrent()` 里加 `stopResolutionSerial()` |
| `src/resolution-port.ts` | 删 `installResolutionPort` 与 `PORT_RESOLUTION_TARGET`；保留打包值状态机（clamp 先行 / 复位 / debug 覆写）供串口编码复用 |
| `src/guest-poweroff.ts` | 回退 `V86IoPortEntry` 的 read8/16/32 可选字段（实验期产物） |
| `src/guest-channel-test.ts` | `__setChannelValue(v)` 追加 `notifyResolutionTargetChanged()`：debug 钩子推值即推帧 |
| `src/resolution-serial.test.ts` | **新增**：帧编码/校验和/无目标静默/debug 越界照发/泵节奏/坏 bus 容错。期间排掉两个坑：帧长是 7 不是 8；测试等待不能用主线程 `Atomics.wait`（会堵死被等的 setInterval，改 promise 式让出） |

**验证**：13 个测试套全绿 + tsc --noEmit + vite build。

### 第一轮：端口载体（2026-08-26 早；同日晚已被串口载体取代）

| 文件 | 改动 |
|---|---|
| `src/protocol.ts` | 片段一：`setResolution` 消息常量、`InstantVmSetResolutionMessage` 类型与守卫、`InstantVmStartConfig.resolutionAutoAlign?: boolean` 及校验、host→runtime 联合类型收编 |
| `src/guest-channel-test.ts` | **新增**：debug 构建 `window.__setChannelValue(v)` 控制台钩子（01 §2；可写越界值实测客机溢出守卫） |
| `src/host.ts` | 片段二：`InstantVmController.setResolution` + dispatch 分支（回 `started` 确认帧） |
| `src/v86-runtime.ts` | 片段三：`start()` 里开关打开才注册端口（`v86IoFromEmulator(next)`），每次启动先清零目标值；关闭时不碰 io 表 |
| `src/main.ts` | 接线：`installGuestChannelTest()` |

**为什么可以创建后注册端口**：查过 vendor bundle，v86 的 IO 分发每次 IN 都动态
`ports[addr].read*` 查表调用，且构造时已把全部 65536 个槽填上空条目——与
guest-poweroff 拦 OUT 同一条路径。（这条机制认识本身没错，错的是假设 ring3
能执行到查表那一步——见 00 §8.3。）**验证记录**：`pnpm test` 12 套全过（含新增
`resolution-port.test.ts` 与 protocol.test.ts 的 set-resolution 用例）；`pnpm build`
（tsc --noEmit + vite）通过；wasm 未动。

---

以下为原始片段设计稿：

## 1. 与 00 §5 原计划的差异（先读这个）

原计划把 ResizeObserver / debounce / clamp 放在 `v86-runtime.ts`。第一期实际实现时
把这整套逻辑放在了 instant-app 侧 `src/apps/virtual-machine/resolution-channel.ts`
（配套单测 16 例全绿）。所以 VM 仓库**不需要**任何观察器代码，只承担三件事：

1. 协议认识新字段 / 新消息；
2. 收到 set-resolution 时更新打包值闭包；
3. 开关打开时把 0xE000 的 read 处理器挂上 io 表。

## 2. 片段一：`src/protocol.ts`

参照实现就在 instant-app 同名镜像文件 `src/apps/virtual-machine/virtual-machine-protocol.ts`
（两边逐字段一致即可；下面名字若与你仓库本地命名不同，跟着你的惯例走）。

```ts
// InstantVmStartConfig 接口里加一个可选字段：
resolutionAutoAlign?: boolean

// isInstantVmStartConfig 校验函数里补一条（字段可选，出现必须是 boolean）：
if ('resolutionAutoAlign' in raw && typeof (raw as any).resolutionAutoAlign !== 'boolean') {
  return false
}

// MESSAGE_TYPE 表加一项：
setResolution: 'instant-vm:set-resolution'

// 新消息类型 + 守卫：
export interface InstantVmSetResolutionMessage {
  requestId: string
  type: 'instant-vm:set-resolution'
  width: number   // 宿主已 clamp 过：[640, 2560]
  height: number  // 宿主已 clamp 过：[480, 1600]
}

export function isInstantVmSetResolutionMessage(value: unknown): value is InstantVmSetResolutionMessage {
  // 跟同文件其它 is* 守卫同构
}
```

## 3. 片段二：消息 dispatch 处接 case

在你处理宿主→运行时消息的 switch/dispatch 处（host.ts 或 v86-runtime.ts，视你仓库
结构），新增一个分支：

```ts
if (isInstantVmSetResolutionMessage(message)) {
  resolutionTargetPacked =
    ((message.width & 0xffff) << 16) | (message.height & 0xffff)
  return
}
```

clamp 在宿主侧已做（`resolution-channel.ts` 的 `clampResolutionTarget`，先 clamp 再
移位）；这里 `& 0xffff` 只是防御性收尾。

## 4. 片段三：`src/v86-runtime.ts` —— 端口注册

创建 emulator 之后接线（与既有的 `installAbsoluteMouseRemap(next.bus, ...)` 同一区域；
拿 io 表走 `guest-poweroff.ts` 已验证的那条路径）：

```ts
let resolutionTargetPacked = 0 // (w<<16)|h；0 = 无目标

// 仅开关打开才注册：关闭时行为与现状逐字节一致（00 §5 硬要求）
if (startConfig.resolutionAutoAlign === true) {
  const ports = emulator.v86.cpu.io.ports
  ports[0xE000] = {
    read8:  () => resolutionTargetPacked & 0xff,
    read16: () => resolutionTargetPacked & 0xffff,
    read32: () => resolutionTargetPacked,
  }
}
```

端口地址 0xE000 与 instant-app 侧常量
`RESOLUTION_CHANNEL_PORT`（`resolution-channel.ts`）/ agent 侧 `RES_PORT`（res-agent.c）
三处必须一致。快照恢复不用额外处理：io 表和闭包都是宿主 JS 对象，不在 v86
`save_state` 序列化范围内（00 §8.7）。

## 5. 片段四：`src/guest-channel-test.ts` —— debug 钩子（[01 §2](./01-channel-mvp.md)）

第三期通道实测也可以不靠 postMessage，用这个更省事：

```ts
import { isDebugMode } from './debug' // 按你仓库实际路径

export function installGuestChannelTest(emulator: V86Emulator): void {
  if (!isDebugMode()) return
  let packed = 0
  const ports = emulator.v86.cpu.io.ports
  ports[0xE000] = {
    read8: () => packed & 0xff,            // debug.exe -i E000 读的就是它
    read16: () => packed & 0xffff,
    read32: () => packed,
  }
  ;(window as any).__setChannelValue = (v: number) => { packed = v >>> 0 }
}
```

注意：这个钩子和片段三都往 0xE000 写 io 表，正式注册与 debug 钩子别同时开
（钩子有 isDebugMode 门控 + 只在测试会话装，天然错开）。

## 6. 套完之后的自检

1. `npm run build`（或仓库对应命令）过编译，release/debug 两套产物都含此改动
   （纯 TS，不涉及 v86 wasm 重编，00 §5）。
2. instant-app 里开「分辨率自动对齐」后启动 XP，浏览器控制台发一次
   `{ type: 'instant-vm:set-resolution', requestId: 't', width: 1280, height: 960 }`，
   然后 `window.__setChannelValue(0)` 复位再设 `(1280<<16)|960` 都应能被
   agent / debug.exe 看到。
3. 关掉开关重新启动：对比一次启动消息 JSON——不得出现 `resolutionAutoAlign`
   字段（byte-for-byte 兼容回归项）。
