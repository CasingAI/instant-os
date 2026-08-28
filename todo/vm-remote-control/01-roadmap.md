# vm-remote-control · 01 Roadmap —— 通道能力分期（v3 已落地）

> 2026-08-28 定稿。前置：`00-overview.md`（控制面 + res-agent v2 已落地）。
> 本文是多期任务的路线图与状态台账：哪些期已做完、做成了什么形态、哪些明确不做。

## 0. 期次总览

| 期 | 主题 | 状态 | 形态 |
|---|---|---|---|
| 原一期 | 双向通讯 | ✅ 并入 v3 信箱 | 共享内存天然双向；串口保持控制面（命令帧 + 回执行） |
| 原二期 | EXEC 返回值 | ✅ v3 已落地 | EXEC_R(0x11) 任务槽 + `[IVM]EXIT=` 回执行，不阻塞 PING |
| 原三期 | 键盘输入 | ✅ 无需开发 | v86 `keyboard_send_text` 现成（`__vm.key` / `agentCommand('key')`） |
| 原四期 | 剪贴板（文本、内外、双向） | ✅ v3 已落地 | ivm-shm.sys 信箱驱动 + clipboard-bridge 桥 + v86 DMA 直读 |
| 原五期 | 文件双向传输 | 📋 只调研 | `05-file-transfer.md`（信箱分块 vs 镜像直写，9p 已排除） |

## 1. 为什么通道形态从「串口扩展」改成「共享内存信箱」

v86 是模拟器，宿主 JS 可以用 `emulator.read_memory / write_memory` 直接读写
XP 的物理内存（DMA 语义，v86.d.ts:852/860）。串口虽有 `len≤200` 帧和行缓冲，
但它是单字节吞吐的控制面，拿来做数据面（剪贴板/文件）既慢又要自己处理流控；
一块 XP 侧驱动分配的连续物理内存就是宿主和客机之间的天然共享内存，零拷贝、
零串口占用、天然双向。**控制面留串口（命令与握手），数据面走信箱**。

## 2. v3 落地清单（2026-08-28）

### 2.1 EXEC 返回值（EXEC_R）

- 协议：`EXEC_R(0x11)` 帧payload 同 EXEC；受理回 `[IVM]EXEC=1`（槽忙
  `EXEC=0 err=busy`），结果回 `[IVM]EXIT=<码>`，15s 超时击杀回 `[IVM]EXIT=<码> to=1`。
- res-agent：单任务槽（无锁无线程），主循环每轮 `poll_exec_r()`（WaitForSingleObject(0)
  + GetExitCodeProcess），不阻塞 ReadFile——PING/CLICK 照常响应。
- 宿主：`__vm.execResult(cmdline)` 单 pending 槽（30s 兜底超时），运行时解析
  EXEC/EXIT 行收敛 promise；白名单 `execResult` 两侧同步。
- 单测：`vm-agent-control.test.ts`（EXEC_R 帧 + 行解析）、`virtual-machine-agent.test.ts`。

### 2.2 剪贴板（文本、内外、双向）

三层组件（信箱布局三方一致：64KB = G2H 32KB + H2G 32KB，块头 16B
magic/seq/status/len + UTF-16LE 数据）：

1. `guest/ivm-shm/ivm-shm.sys`（ring0，Open Watcom + ntoskrnl.lib）：
   boot 期分配 64KB 连续物理内存并清零，`IOCTL_IVM_SHM_INFO` 返回
   物理基址 + 调用进程的用户态映射（MmMapLockedPagesSpecifyCache，按
   FILE_OBJECT 缓存）。无线程无中断无卸载（常驻到关机）。
2. `guest/clipboard-bridge/clipboard-bridge.exe`（ring3，zig cc）：XP 剪贴板 ↔ 信箱
   双向搬运（CF_UNICODETEXT，150ms 轮询，GetClipboardSequenceNumber 触发；
   lastSelfText 防自环；G2H 3s 无确认自动复位）。
3. 宿主：`Instant-virtual-machine/src/ivm-shm.ts` 信箱模块（read_memory/
   write_memory 直读物理内存，200ms 轮询）；SHM_QUERY(0x12) 5s 重问直到握手
   （res-agent 侧每次询问都会重探驱动，后装驱动可自动恢复）；
   `guestClipboard` postMessage 上行 + `__vm.clipboardWrite` 下行；
   instant-app 侧 1s 剪贴板轮询 + 回声抑制（`virtual-machine-clipboard.ts` 纯函数），
   只同步当前显示的虚拟机。

单测：`ivm-shm.test.ts`（信箱状态机）、`ivm-shm-binary.test.ts`（驱动 PE 断言）、
`clipboard-bridge-binary.test.ts`、`virtual-machine-clipboard.test.ts`（防环决策）。

### 2.3 已知边界（v3 有意不做）

- 图片/文件剪贴板格式（CF_HDROP 等）：桥只认 CF_UNICODETEXT；
- 多虚拟机同时同步：只有当前显示的那台参与（宿主侧决策）；
- 非交互会话剪贴板：clipboard-bridge 走 HKCU Run（服务摸不到交互会话剪贴板）；
- `read_memory` 的 ABI 依赖：v86 提供；XP 非 PAE 下物理地址 32 位封顶。

## 3. 感知层移除（2026-08-29）

原控制面里的「感知层」——100ms 巡检、canvas 蓝屏守卫、环形帧缓冲、启动时间线、
readText/screenshot/snapshot/dumpRing/freeze——是「AI 自主操作 VM」目标的专属产物，
该目标实测效率低被用户取消，且感知层零产品依赖、实机还暴露误冻结回归（XP 启动
画面被蓝屏指纹误判即 stop()，表现为开机卡死）。已整层删除（git 历史可寻回），
保留命令通道与调试桥：

- 保留：PING/SHUTDOWN/REBOOT（关机按钮）、EXEC/EXEC_R、ivm-shm 剪贴板、
  agentCommand 转发、installAgentBridge（vm-safe-reload 的软关机靠它）；
- 移除：感知层全部 + 对应 __vm 方法与两侧白名单条目。

## 4. 后续候选（未排期）

- 剪贴板：图片格式（位图进信箱数据区，len 按字节计）、客机主动查询方向开关；
- EXEC：stdout 捕获（信箱做数据面，EXEC_R 只报退出码的现状可平滑升级）；
- 文件传输：见 `05-file-transfer.md` 调研结论，两个候选方案待定夺。
