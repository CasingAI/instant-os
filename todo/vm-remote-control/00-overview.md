# vm-remote-control · 00 Overview —— AI 远程操控 XP 虚拟机（状态感知 / 输入注入 / 电源控制 / 安全 reload）

> 分支建立：2026-08-28。前置依赖：`todo/vm-arbitrary-resolution/`（boxvnt 驱动 + res-agent，
> 其中 res-agent 的 COM1 双向串口通道与 `[IVM]` 串口 tap 是本能力的直接基础）。
> 触发背景：boxvnt 蓝屏排查期间，AI 只能靠「客机跑脚本 + 用户拍屏 + 宿主读串口日志」三板斧
> 驱动每一轮验证，一轮十几分钟且瞬态（蓝屏 1 秒内报错→崩溃→蓝屏→自动重启）只能靠手机
> 超级慢动作追拍。本能力把整个 VM 变成 AI 可直接操作的受控设备。
>
> **设计总原则（两条，所有组件向其对齐）：**
> 1. **感知永远不依赖客机软件**——res-agent 死透、没装、蓝屏、没进桌面，宿主侧感知照常工作；
>    agent 只是高效下命令的加速通道，不是感知的前提。
> 2. **模拟器的帧与 CPU 时间是可控的**——不需要摄像头追拍瞬态：帧产生的那一刻即可拦截
>    （帧级巡检），CPU 可随时冻结（1 秒的蓝屏瞬态 → 无限长的稳态），整机状态可存档快照
>    （蓝屏现场可反复恢复分析），崩溃前历史帧可环形回看（无限帧率的「超级慢动作」）。
>
> **2026-08-29 移除**：debug-mode 调试桥（`installAgentBridge` / `/poll` / `/eval` / `/log`）
> 与 `scripts/vm-safe-reload.sh` 已整体删除——桥只服务于脚本，`/log` 上报在 dev 模式
> 每次开机都刷 `ERR_CONNECTION_REFUSED`，用户裁决全部不留。**改虚拟机代码后为普通刷新**；
> 硬断电顾虑由产品侧「关机（软关机）」按钮承担。下文涉及桥 / safe-reload 的段落
> 仅作历史记录，不再描述现状；感知层同日也已移除（见 01-roadmap）。

## 0. 原始目的与实现状态（先读这里）

**原始目的（2026-08-28 用户提出，按原话要点）**：基于项目里已经打通的双向通讯
（COM1 串口通道 + debug-mode 桥），让 AI 能像操作一台受控设备一样远程操控这台 XP 虚拟机：

- 控制虚拟机开关机——这一步 JS 直接能做到（`emulator.stop` / `destroyCurrent` 落盘 /
  reload 后自动开机），用户明说这是简单部分；
- 真正的难点是**感知**：知道 XP 现在处于什么状态、屏幕上显示的是什么画面、画面上有哪些内容；
- 能点击客机画面里的按钮、在客机里执行命令；
- 判断系统是否崩溃、是否蓝屏；蓝屏卡住时知道它卡在那、内容是什么；
- 判断系统是否正在启动、启动到哪个阶段——**包括引导结束到进桌面之间的图形阶段**
  （那段时间没有任何文本可读）；
- 捕获「报错→崩溃→蓝屏→自动重启」整个过程——全程约 1 秒，此前只能用手机的超级慢动作
  逐帧追拍（用户真实经历，本能力的直接动因之一）；
- agent（res-agent）没跑起来时，要有办法重新注入/恢复；
- **硬约束（用户原话）**：「这个项目还没有启用热更新，是禁用状态。所以你挂好 debug 的
  这些埋点之后，每次做完更改之后，还要调用 reload。reload 之前还得把虚拟机先执行关机，
  不然每次都直接硬断电，对硬盘不好。」

**实现状态（2026-08-28 搭建完成）**：§9 三步代码全部落地——
1. 运行时控制面：`Instant-virtual-machine/src/vm-agent-control.ts`（`__vm` +
   瞬态捕获器 + 启动时间线 + `installAgentBridge`）+ v86-runtime 接线（region
   `vm-agent`）+ main.ts 挂桥；单测 `vm-agent-control.test.ts` 进测试链，
   `pnpm build` 全绿。live 验证（真实引导文本/截图/蓝屏全链路）待下个调试会话做；
2. res-agent v2：六命令 + XP 服务化（StartServiceCtrlDispatcher）+ 关机特权
   （advapi32）；zig cc 产物 9.7KB 过 `res-agent-binary.test.ts`（白名单+
   v2 依赖断言）；重拷进 XP 与 serialSend 实机验证待做；
3. `scripts/vm-safe-reload.sh`：全流程（起桥→state→shutdown→等 vm-destroyed→
   reload→等 PONG）已用模拟页面桥端到端冒烟通过；实机演练待做。

**补充（2026-08-28 同日）**：新增宿主侧 postMessage 包装层（§12）——协议加
`agentCommand`/`agentResult` 一对消息，运行时 host.ts 转调 `window.__vm` 白名单方法
（`vmAgentMethod`），instant-app 侧 `virtual-machine-runtime.ts` 池级 `agentCommand()`
+ `virtual-machine-agent.ts` 类型化门面。宿主页面从此不必依赖调试桥 /eval，
也不必跨域摸 `contentWindow`，像调本地函数一样调 `agent.exec('notepad.exe')`。
调试桥路径保留：两者互补（桥能跑任意 eval 与探针，postMessage 只通白名单方法）。
§3 列出的机制是**已存在的其他能力**，不是本能力的产物。

## 1. 一句话

在 v86 运行时挂一个门控的 `window.__vm` 控制面（感知：文本层读字 / canvas 截图 / 蓝屏帧级
捕获即冻结 / 启动时间线；命令：COM1 下发 res-agent v2 的 PING/EXEC/CLICK/SHUTDOWN），
把「AI 驱动 XP 验证」从十几分钟一轮的人工循环压缩成秒级的自主循环，并附
`vm-safe-reload` 脚本保证每次改代码后的 reload 都是先软关机落盘再刷新（禁止硬断电）。

## 2. 能力清单（用户原始诉求逐条映射）

| 诉求 | 实现 | 依赖客机？ |
|---|---|---|
| 知道 XP 现在显示什么画面 | `__vm.screenshot()` → canvas PNG → AI 看图 | 否 |
| 知道画面上有哪些内容（文字） | `__vm.readText()` 读 VGA 文本层 DOM（BIOS/引导/蓝屏文字是文本模式字符） | 否 |
| 判断系统是否正在启动、卡在哪 | 启动时间线：VBE 模式切换 + 文本层内容 + 磁盘 IO 轮廓 + PONG 首现 | 否 |
| 判断是否蓝屏、蓝屏内容 | 帧级巡检（文本层 diff + canvas 像素特征）→ 命中即冻结 CPU → 读 STOP 码/截图/存快照 | 否 |
| 捕获 1 秒内的崩溃瞬态（不用手机慢动作） | 崩溃前 N 秒环形帧缓冲，事件触发 dump，逐帧回看 | 否 |
| 点击画面里的按钮/坐标 | res-agent `CLICK x,y`（SetCursorPos+mouse_event，像素级） | 是（有兜底） |
| 在客机里执行命令 | res-agent `EXEC <cmdline>`（CreateProcess） | 是（有兜底） |
| 手动开关机 | 软关机/重启 = agent SHUTDOWN/REBOOT（ExitWindowsEx→guest-poweroff watcher→干净落盘）；开机 = reload 后 app 自动 start；硬复位 = `__vm.restartVm()` | 关机是 |
| agent 没跑起来也能干活 | 三层递进：服务化自启 → EXEC 自愈 → 纯视觉+键盘兜底（见 §7） | — |
| 改代码后安全 reload | `scripts/vm-safe-reload.sh`：软关机→等落盘→reload（§8） | 关机是 |

### 2.1 设计答疑（用户挑战 → 设计回应，定稿依据）

用户在定稿前逐条挑战过设计，这些问答是方案成立的理由，后续实现者推翻前先读完：

| 挑战 | 回应（落点） |
|---|---|
| 蓝屏了你要怎么感知？卡在蓝屏上怎么知道卡在哪？ | XP 蓝屏本质是 80×25 VGA 文本模式（写 0xB8000），v86 同步进文本 div 的 DOM 字符——**免 OCR 直接读出 STOP 码全文**（§5.1）；命中即冻结 CPU，瞬态变稳态 |
| XP 不是 Linux，启动进桌面之间那段时间（图形阶段）怎么办？ | 不靠文本：VBE 模式切换 + canvas 截图 + 磁盘 IO 轮廓 + PONG 首现四路信号拼时间线（§5.2），全程客机无关 |
| 1 秒内完成的崩溃瞬态怎么捕获？ | 模拟器的帧与 CPU 时间是可控的：帧产生那一刻即可拦截（100ms 帧级巡检），崩溃前历史帧进环形缓冲、事件触发整段 dump（§5.1）；再用 EXEC 写 `AutoReboot=0` 根治秒重启 |
| Service 没跑起来你怎么往里重新注入？ | agent 不是感知的前提，只是命令加速通道（设计总原则 1）；注入走三层递进：服务化自启→EXEC 自愈→纯视觉+键盘兜底（§7） |

## 3. 现状基础（本计划落地时已存在、不重复建设的机制）

| 机制 | 位置 | 与本能力的关系 |
|---|---|---|
| debug-mode 双向桥 | `~/.zcode/skills/debug-mode/scripts/log-server.mjs`（/hook /eval /poll /result /log /health） | AI「执行 JS」的唯一入口：`/eval` 在页面全局作用域执行任意 JS，结果同步回传；`/log` 收日志与截图 |
| `[IVM]` 串口 tap | `Instant-virtual-machine/src/v86-runtime.ts`（`serial0-output-byte` 监听，POST 到桥） | 客机→宿主遥测通道（本计划转正为常驻 agent 通道，不再按调试产物清理） |
| 客机切电监听 | `Instant-virtual-machine/src/guest-poweroff.ts` | 客机自身关机（ExitWindowsEx 触发的切电端口写）→ `destroyCurrent`（先 stop 再落盘再销毁） |
| 磁盘写回 | `Instant-virtual-machine/src/disk-write-back.ts` | 关机路径的落盘保证 |
| 快照 | `saveState` 消息 → `emulator.save_state()` | 蓝屏现场整机存档/恢复 |
| 键盘注入 | `keyboard_send_text` + `injectKeyboard`（host-inject KeyboardEvent） | 兜底输入路径 |
| v86 文本层 | `#screen_container` 里 canvas 之外的文本 div（`screen-fit.ts visibleLayer` 证明存在） | 免 OCR 读屏 |
| res-agent COM1 通道 | `src/apps/virtual-machine/guest/res-agent/res-agent.c`（7 字节帧轮询解析） | v2 扩展的基座（§6） |
| 宿主→客机串口写 | `Instant-virtual-machine/src/resolution-serial.ts`（`bus.send('serial0-input', …)`） | 命令下发通道（`__vm.serialSend` 复用同一机制） |
| debug 门控 | `Instant-virtual-machine/src/v86-loader.ts isDebugMode()` | `__vm` 控制面的启用开关 |

### 3.1 桥操作要点（AI 侧，实现 §9 前必读）

- 起桥：`node ~/.zcode/skills/debug-mode/scripts/log-server.mjs --out <repo>/.zcode/debug/<yyyyMMdd-HHmmss>.log --port 0`，
  后台运行；实际端口从 stdout 的 `DEBUG_LOG_SERVER_PORT=` 读出。
- **端口不是永久契约**：每个会话 `--port 0` 随机分配（会话隔离规则）。52622 只是
  上一调试会话的既成值；实现时把实际端口写进 `vm-agent-control.ts` 的
  `AGENT_DEFAULT_PORT` 常量，或用 URL `?agent=<port>` 覆盖。tap 现硬编码的 52622
  同样要在参数化时一并处理。
- AI 命令面：`POST /eval {code}`（页面全局执行，结果同步回传 ≤60s）、`GET /health`
  （`bridgeWaiters>0` = 页面桥在轮询）、`POST /log`（收日志/截图/环形帧）。
  探针 `/hook` 可选（埋点原地执行代码），本能力一期用全局 eval + `__vm` 就够。
- 页面侧入口桥（`installAgentBridge`）是 `/poll` 长轮询循环：领 eval → 执行 → `/result`
  回传；reload 后自动重连，探针注册表以服务器为唯一事实源、无需重设。
- `[IVM]` tap 现状：按 `\n` 分帧、行首 `[IVM]` 才转发、单行 120 字节上限；
  BSOD 杀 CPU 前字节已到 JS 侧，`fetch keepalive` 保落盘。

## 4. 架构总图

```
[ZCode AI]
  ├─ 桥 /eval ──────► app 页面 + 运行时 iframe 的 window.__vm（感知查询 / 命令下发 / 电源控制）
  ├─ 桥 /log ◄──────  tap（[IVM] 行）、巡检事件、截图 PNG、启动时间线、PONG 心跳
  └─ Read ◄─────────  .zcode/debug/*.log + 截图文件（AI 看图/读字）
                         ▲
[v86 运行时 iframe]       │ serial0-output-byte
  __vm: readText/screenshot/巡检(蓝屏→冻结→快照)/state/serialSend/key/shutdown/restartVm
                         │ serial0-input（7 字节帧 v2）
[XP 客机]                 ▼
  res-agent v2（XP 服务，COM1）：PING→PONG / EXEC / CLICK / SHUTDOWN / REBOOT
  boxvideo.sys（[IVM]F*/DR 标记，既有）
```

## 5. 感知层详细设计（全部客机无关）

### 5.1 瞬态捕获器（核心，`vm-agent-control.ts` 内）

- **巡检循环**（~100ms interval，捕获器启用时才跑）：
  - 文本层字符串 diff：读文本 div 的 `textContent`，变更即记录时间线，匹配蓝屏指纹
    （`A problem has been detected` / `*** STOP:`）；
  - canvas 降采样特征：每 ~100ms 把 canvas 画到 64×64 离屏 canvas 读像素，命中
    「大面积 #0000AA + 白字」特征即判定蓝屏（与文本层互为备份，不赌单一手段）；
- **事件触发即时检查**：CPU halt、`v86-fatal-error` onFatal、重启检测（文本层重新出现
  BIOS 内容）时立刻跑一轮巡检；
- **命中蓝屏 → 自动冻结**：立即 `emulator.stop()` 暂停 CPU（复用 `saveState` 前的暂停手法），
  上报日志（含 STOP 码文本、截图、时间戳），冻结状态可无限期分析；
- **环形帧缓冲**：巡检器顺手把每次 canvas 变化帧存成低分辨率 JPEG（q≈0.5）入环形队列
  （默认容量：120 帧 × ~100ms ≈ 最近 12s）；崩溃/重启事件触发时整段 dump 到 `/log`，
  AI 逐帧回看「报错→崩溃→蓝屏→自动重启」全过程；
  注意批量 dump 不能用 `fetch keepalive`（浏览器 64KB 在途总预算会静默丢帧），用普通 POST；
- **现场快照**：冻结后可 `snapshot()`（走既有 saveState）把整机状态存档，可反复恢复。
- **根治蓝屏秒重启**（调试期增强）：`EXEC` 写
  `HKLM\SYSTEM\CurrentControlSet\Control\CrashControl` `AutoReboot=0`（XP 默认开——
  这正是「只能手机慢动作拍」的根源），蓝屏从此停住不走，变成稳态。

### 5.2 启动时间线（回答「正在启动吗 / 卡在哪」）

| 阶段 | 信号（全部客机无关） |
|---|---|
| BIOS POST | 文本层出现 BIOS 字符 |
| NTLDR/引导 | 文本层出现引导文字 |
| 内核加载（黑屏） | 文本层清空 + CPU 忙 + 磁盘 IO 高位（diskRead 轮廓，已有消息） |
| XP splash（图形） | VBE 模式切换事件（文本→图形/分辨率变化）+ canvas 截图 |
| 登录屏 | 截图视觉确认 |
| 进桌面完成 | res-agent PONG 首现（同时=agent 存活） |

时间线事件全部打 `/log`，AI 按日志回答「启动到哪一步 / 是否卡死（IO+CPU 双停 = 卡死）」。
PING 由控制面每 5 秒主动下发（`serialSend` PING 帧），PONG 经 `[IVM]` tap 回流——
所以「进桌面 / agent 存活」这个信号是控制面主动探出来的，不等客机自己报。
bootStage 只前进不回退（桌面后文本层再变化不得降级阶段），实例重绑时复位。

### 5.3 `window.__vm` API 面

```ts
readText(): string                      // 文本层 textContent
screenshot(): void                      // canvas PNG → POST /log（type:'screenshot'）
state(): { running, halted, bootStage, lastPongAgeMs, bsod: {frozen, stopText}|null }
serialSend(bytes: number[]|string): void // bus.send('serial0-input', …) 下发 agent 命令
key(text: string): void                 // keyboard_send_text
keyEvent(msg: InstantVmKeyboardMessage) // 复用 dispatchGuestKeyboard
shutdown(): void                        // serialSend(SHUTDOWN 帧)
reboot(): void                          // serialSend(REBOOT 帧)
restartVm(): void                       // emulator.restart()（硬复位，调试用）
snapshot(): Promise<ArrayBuffer>        // 既有 saveState
captureStart()/captureStop()            // 巡检器/环形录像开关（默认开）
freeze: boolean                         // 蓝屏自动冻结开关（默认开）
```

安装点：`v86-runtime.ts` 里 emulator 实例**构造后立即绑定**（不要等 emulator-loaded——
越早绑定，BIOS/引导期的文本层与时间线才能被记录）；定时器跨实例复用，一律经共享 state 取
当前绑定（不能闭包旧实例，否则 restart 后 PING 打进已销毁的 emulator）。
启用条件 `isDebugMode() || URL 带 ?agent=<port>`
（端口=桥端口，默认沿用 52622；tap 同参可配，替换现硬编码）。
销毁路径（`destroyCurrent`）里解绑并摘除 `window.__vm`；`v86-fatal-error` 的 onFatal
先跑一轮即时巡检再销毁（fatal 常伴随画面定格，那是最后一帧证据）。

## 6. 命令通道：res-agent v2（向后兼容协议扩展）

帧格式 `[A5][len][payload...][csum]`（csum = 前 len+2 字节和 & 0xFF，与现协议一致）：

| len | 含义 | payload | 行为 |
|---|---|---|---|
| 0x04 | 分辨率（**现协议原样**） | `(w<<16)|h` LE | 行为完全不变 |
| 0x01 | PING | `0x01` | 回 `[IVM]PONG=<tick> ver=2 built=<构建时间戳>\r\n`（版本/构建日期由构建脚本注入；单实例弹窗同源展示，双击 exe 即见） |
| 0x01 | SHUTDOWN | `0x02` | 回 `[IVM]SDWN=1` 后 `ExitWindowsEx(EWX_SHUTDOWN\|EWX_POWEROFF)` |
| 0x01 | REBOOT | `0x03` | 回 `[IVM]RBOOT=1` 后 `ExitWindowsEx(EWX_REBOOT)` |
| N | EXEC | `0x10 <cmdline\0>` | CreateProcess 执行；回 `[IVM]EXEC=1`（完成检测靠产物文件/PING） |
| 0x05 | CLICK | `0x20 <x:u16><y:u16>` | SetCursorPos+mouse_event 左键单击 |
| 0x05 | DBLCLICK | `0x21 <x:u16><y:u16>` | 同上双击 |

- COM1 重开为 `GENERIC_READ|GENERIC_WRITE`，回传写 `[IVM]…\r\n`（ring3 WriteFile 与
  ring0 驱动裸 OUT 并存，字节流交错无害——tap 按行收）；
- **COM1 链路的已知坑别再踩一遍**：串口初始化是 7 数据位（必须显式
  `BuildCommDCBA("9600,n,8,1")` 8N1 + 显式 `SetCommTimeouts`，否则 0xA5 被剥成 0x25、
  读循环卡死）、单实例 mutex（`InstantVmResAgent`）——完整证据链见
  [vm-resolution-auto-align/00-overview.md §8.8](../vm-resolution-auto-align/00-overview.md)；
- 解析器复用现有状态机，仅 `len≠4` 分支加 opcode 分发；
- 构建：沿用 zig cc + `patch-pe-xp-version.mjs`；导入白名单测试（res-agent-binary.test.ts）
  同步加 `user32!ExitWindowsEx/SendInput/mouse_event/SetCursorPos`；
- 命令下发方（AI）通过 `__vm.serialSend` 编帧；resolution-serial 泵仍每秒广播分辨率帧，
  字节流交错由现有「逐字节+校验和」解析天然免疫。

## 7. agent 缺位三层递进

1. **预防**：交付/安装手册把 res-agent 从 `HKCU\...\Run`（需登录）提升为 XP 服务
   （`sc create` + `StartType=1`，开机即起免登录）；install 流程同步更新；
2. **自救**：agent 活着时 `EXEC` 可重装/重启它自己（copy exe → 重启服务）；
3. **兜底（agent 彻底死）**：纯视觉+键盘——`screenshot()` 看画面 → `key()` 注入键盘
   （Win+R 运行对话框输 `C:\Tools\res-agent.exe` 等，键盘路径已存在可靠）；合成鼠标事件
   仅作最后手段（XP PS/2 相对鼠标对合成事件精度差，`movementX=0` 风险）。

## 8. 安全 reload 脚本（高频流程收口，禁止硬断电）

新 `scripts/vm-safe-reload.sh`（AI 每次改完运行时/客机代码后执行）：

```
1. __vm.shutdown()（bridge /eval）→ XP ExitWindowsEx → guest-poweroff watcher
   → destroyCurrent（stop → 写回落盘 → 销毁）
2. 轮询 /health + 日志：等 'guest-powered-off' / stopped 事件 + 写回 flush 完成
   （超时 60s → 报错退出，绝不带电 reload）
3. bridge /eval location.reload() → iframe 重载新代码 → app 自动 start = 开机
4. 轮询日志等 PONG 首现（= 客机起来了且 agent 活着）→ 收口
```

## 9. 实现顺序（每步自验证，全部 AI 自主驱动）

> 2026-08-28 状态：三步代码全部完成。① 单测+tsc+build 绿；② zig cc 产物过
> PE 断言（导入表 KERNEL32/USER32/ADVAPI32）；③ 模拟页面桥端到端冒烟通过
> （软关机→vm-destroyed→reload→PONG）。带 ⏳ 的实机项待下个调试会话：
> 客机里重拷 res-agent v2、真实蓝屏全链路、safe-reload 实机演练。

1. **运行时控制面**（零客机改动）：`vm-agent-control.ts`（含页面侧入口桥 `installAgentBridge`）+
   tap 参数化 + `main.ts` 挂桥；
   验证：/eval 读引导文本、截图看桌面、构造一次蓝屏走通「巡检命中→自动冻结→读 STOP 码→
   存快照→环形回看」全链路（构造手段任选：换用会蓝屏的驱动产物，或临时给巡检器加自测
   开关强制命中——不依赖 boxvnt 排查线的状态）；⏳
2. **res-agent v2**：协议扩展 + 服务化安装脚本 → 重拷进 XP → serialSend 驱动逐项验证
   （PONG 落日志 / CLICK 点开始菜单后截图确认 / EXEC 写 AutoReboot=0+type 回传 /
   SHUTDOWN 走 guest-poweroff 干净落盘）；⏳ 重拷与实机验证
3. **vm-safe-reload.sh** 全流程演练：软关机→落盘→reload→自动开机→PONG 恢复。⏳ 实机

## 10. 文件级改动清单（含删除指南依据）

**新增（删除能力时整个文件/目录可删）：**

| 文件 | 内容 |
|---|---|
| `Instant-virtual-machine/src/vm-agent-control.ts` | `__vm` 控制面 + 瞬态捕获器 + 启动时间线 + `vmAgentMethod` 白名单解析（全部运行时侧代码集中此文件） |
| `scripts/vm-safe-reload.sh` | 安全 reload 脚本 |
| `instant-app/src/apps/virtual-machine/virtual-machine-agent.ts` | 宿主侧类型化门面（`createVmAgent`/`vmAgentFor`），把 postMessage 往返包成 `agent.exec(...)` 式调用 |
| `todo/vm-remote-control/`（本目录） | 设计文档 |
| res-agent 侧：`res-agent.c` 内 v2 分支 | 见下「修改」 |

**修改（每处用 `// #region vm-agent` / `#endregion` 折叠包裹，删除时按 region 整体摘除；协议/转发散点除外——它们是普通增量 diff，按提交回滚）：**

| 文件 | 改动 |
|---|---|
| `Instant-virtual-machine/src/protocol.ts`、`instant-app/.../virtual-machine-protocol.ts` | 消息集新增 `agentCommand`/`agentResult`（类型 + 校验器 + 两个方向路由）；两份拷贝同步改 |
| `Instant-virtual-machine/src/host.ts` | `InstantVmController.runAgentCommand?` 可选成员 + agentCommand 分发分支（成功回 agentResult，失败走既有 error 回执） |
| `Instant-virtual-machine/src/v86-runtime.ts` | ① import + 安装 `installVmAgentControl(...)`（emulator 构造后、门控内）；② tap 端口硬编码 52622 → URL 参数；③ tap 注释从「调试产物待删」改「agent 通道常驻」；④ `destroyCurrent` 解绑 + onFatal 即时巡检（均 region 包裹）；⑤ 控制器实现 `runAgentCommand`（读 `window.__vm` 过 `vmAgentMethod`） |
| `instant-app/src/apps/virtual-machine/virtual-machine-runtime.ts` | 回执路由（agentResult 带 value resolve）+ 实例/pool 两级 `agentCommand()`（snapshot 用 10 分钟长超时） |
| `instant-app/src/apps/virtual-machine/virtual-machine-runtime-surface.tsx` | 注册 API 时带上 `agentCommand` |
| 两边 protocol 测试 + `virtual-machine-agent.test.ts` | agent 消息校验器、白名单解析（`vmAgentMethod`）、门面往返形状用例 |
| `Instant-virtual-machine/src/main.ts` | 最早位置调 `installAgentBridge()`（region 包裹；桥是纯增量，门控关闭时零行为变化） |
| `instant-app/src/apps/virtual-machine/guest/res-agent/res-agent.c` | COM1 开 GENERIC_WRITE + len≠4 opcode 分发 + 五个新命令处理（region 包裹） |
| `instant-app/.../res-agent-binary.test.ts` | 导入白名单 + 新断言 |
| `instant-app/src/apps/virtual-machine/guest/res-agent/guest-agent.spec.md` | v2 协议 + 服务化安装 |

**删除本能力的完整步骤（未来照此执行）：**
1. 删 `vm-agent-control.ts`、`vm-safe-reload.sh`、`virtual-machine-agent.ts(+test)`、本 todo 目录；
2. 还原 protocol.ts 两份拷贝的 agentCommand/agentResult 增量、host.ts 分发分支、
   v86-runtime.ts 内全部 `#region vm-agent` region 与 `runAgentCommand`、
   virtual-machine-runtime(+surface) 的 agentCommand 路由（tap 若保留分辨率排查需要则仅还原参数化改回 52622）；
3. res-agent.c 摘除 v2 region（保留 v1 7 字节帧原样）；重编译 res-agent 并重拷 XP；
4. XP 客机内：`sc delete <agent服务名>`（若已服务化）；AutoReboot 注册表值按需还原。

## 11. 明确不做

- ~~不动 app UI / postMessage 协议层~~ → 同日按用户要求放开：协议加 `agentCommand`/`agentResult` 一对消息（§12），仍不动 app UI；
- 不做生产部署（wrangler/vm.casing-ai.com）变更——能力仅 dev/debug 门控生效（`?agent=` 可显式打开）；
- boxvnt 驱动现有插桩维持现状（属 `vm-arbitrary-resolution` 验证线，完成后另行清理）；
- 不引入新服务进程（复用 debug-mode 桥，不另起端口服务）。

## 12. 宿主侧 postMessage 包装（agentCommand 通路）

调试桥（/eval 在 iframe 全局跑任意代码）与 `contentWindow` 直取在跨域下各有
限制：前者要桥服务器在线，后者本就被同源策略禁止。本节给宿主页面一条
**不依赖桥、协议化的正式通道**：

```
instant-app（宿主页面）                       Instant-virtual-machine（跨域 iframe）
virtual-machine-agent.ts 门面
  agent.exec('notepad.exe')
    └─ virtual-machine-runtime.ts agentCommand()
         postMessage {agentCommand, requestId, method, args} ──▶ host.ts agentCommand 分支
                                                                  └─ v86-runtime.runAgentCommand
                                                                       └─ vmAgentMethod(window.__vm, method, args)
                                                                            （白名单 + freeze 特判）
postMessage ◀── {agentResult, requestId, value}  ◀── 成功；失败走既有 {error, requestId} 回执
```

- **白名单**：`VM_AGENT_METHODS`（两侧各有一份常量，注释互指；运行时侧 `vmAgentMethod`
  是唯一入口，白名单外/非函数/参数形态不符一律 undefined → 报错回执）。`freeze` 是
  开关属性，无参读值、布尔写值，特判放行。
- **能力边界**：这是「包装」不是新权限——宿主页面本来就能 fetch 桥的 /eval（CORS 全开）。
  通道门控与 `__vm` 相同：debug 构建（dev 即是）或 iframe URL `?agent=<端口>`。
- **超时**：普通命令 60s；`snapshot` 要序列化整个物理内存，与 saveState 同用 10 分钟。
- **用法**：`vmAgentFor(pool, machineId)` 拿门面；或池级 `pool.agentCommand(id, method, args)`
  原始调用。`scripts/vm-safe-reload.sh` 仍走桥 /eval（桥离线时脚本自身会起桥），
  不受本通路影响。

## 13. v3 扩展（2026-08-28 当日）：EXEC 退出码 + 共享内存信箱 + 剪贴板

原五期任务（双向通讯 / EXEC 返回值 / 键盘 / 剪贴板 / 文件调研）已完成重构与
部分落地，**完整路线图与状态台账见 `01-roadmap.md`，文件传输调研见
`05-file-transfer.md`**。要点：

- **通道形态改版**：键盘/剪贴板/文件等数据面一律不走串口——v86 是模拟器，
  宿主 JS 用 `read_memory/write_memory` 直接读写 XP 物理内存（DMA 语义）；
  串口保持控制面（命令帧 + 回执行），双向通讯由共享内存信箱天然提供。
- **已落地**：EXEC_R(0x11) 任务槽回退出码（`EXIT=<码>[ to=1]`，不阻塞 PING）；
  ivm-shm.sys（64KB 连续物理内存信箱驱动，Watcom 构建）+ clipboard-bridge.exe
  （XP 剪贴板 ↔ 信箱双向桥）+ res-agent v3 `SHM_QUERY` 握手 + 宿主侧
  `guestClipboard` 上行 / `clipboardWrite` 下行 + 显示中虚拟机的宿主剪贴板
  1s 轮询同步（回声抑制）。键盘确认无需开发（v86 `keyboard_send_text` 现成）。
- **res-agent 版本 v2 → v3**（`AGENT_VERSION` 3），PONG 回执 ver 字段可辨。

## 14. v8 扩展（2026-08-31）：文件传输改为桥接管方案

宿主→XP 文件粘贴从「压缩成 zip + OLE 虚拟文件 FileContents」改为桥接管：

- 宿主侧 `virtual-machine-file-transfer.ts` 把选中文件/文件夹递归展开成相对路径树，
  目录条目以 `/` 结尾且 `size=0`，文件条目带真实大小，路径可含 `/` 表示嵌套；
  总量上限从 512 条放宽到 4096 条，并按 PENDING 帧 entries 区字节上限
  （≈32716）分片，同 session 连续调用 `filePending` 推给 XP。
- XP 侧桥收到第一片就在剪贴板里挂一个空 `CF_HDROP` 占位，Explorer 的粘贴按钮
  立刻亮；用户按 Ctrl+V 时，`IDataObject::GetData(CF_HDROP)` 被桥拦截，桥自己
  解析目标路径、弹出 XP 风格进度对话框、逐目录 `CreateDirectory`、逐文件
  `REQ` 回宿主拉数据并 `WriteFile` 落盘。
- 完成/取消/失败发 `DONE{ok|cancel|error}`，cut 模式宿主据此删源；取消时
  保留已写完文件，只删当前半成品。
- XP→宿主方向保持不变：XP 复制文件时桥读 `CF_HDROP` 发 `OFFER`，宿主在文件
  APP 粘贴时按 `REQ` 拉数据。

产物变化：ivm-agent v8 起导入表新增 `shell32.dll`（目标文件夹探测、浏览对话框）
和 `oleaut32.dll`（BSTR/Variant 辅助），`AGENT_VERSION` 升到 8。
