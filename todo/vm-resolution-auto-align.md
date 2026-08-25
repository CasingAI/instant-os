# 分辨率自动对齐（独立功能）

> 建立时间：2026-08-24
> 涉及项目：`instant-app` / `Instant-virtual-machine`
> 归属：**独立功能**，不属于 vm-xp-3d。通讯通道一并独立实现，不依赖任何 3D 图形设备。
> 前置实验：方案 A（宿主直写 v86 内部 SVGA 寄存器）已验证失败，结论见 `Instant-virtual-machine/todo/vm-xp-3d/02-resolution-poke-experiment.md`。
> 状态：本节目标与选型已收敛并记录；以下实现清单属参考，是否落地与先后未定。

## 1. 背景与目标

VMware 的体验：拖动宿主窗口，客机分辨率自动跟随，画面 1:1 无缩放。我们也要这个。

这个能力与「XP 里跑 3D」是两回事：**是否会实现 3D 通道不影响分辨率对齐**。因此它自成一份计划，通讯通道也单独设计，不搭 3D 图形设备的车。

## 2. 结论：分辨率变化必须由客机内部发起

方案 A 已被否决：帧缓冲尺寸变了、canvas 也变了，但客机 OS（XP）不知道模式变化，仍按旧分辨率逐行写显存，行宽错位导致斜向撕裂花屏。宿主只负责「告诉客机目标分辨率」，模式切换动作在客机内部完成（走 XP 自带 VGA/SVGA 驱动标准模式切换路径）。

## 3. 三件事

1. **过墙通道**：宿主 → 客机的单向小数据通道，传递目标分辨率（宽、高两个数，低频）。
2. **客机代理**：XP 里常驻小工具，收到分辨率后枚举显示模式确认支持，再 `ChangeDisplaySettingsEx` 切换。
3. **触发**：宿主侧 ResizeObserver + debounce + 阈值 + DPR 换算 + clamp。

## 4. 过墙通道选型（已收敛）：宿主注册 IO 读端口，不改 v86

**核心约束**：不修改 v86 源码、不重新编译 v86。这直接排除了「改 `vmware.js` backdoor」和「复用 3D PCI 设备」两条路。

**已确认的事实依据**：

- v86 的 `cpu.io.ports[]` 是一本**开放登记表**：`ports[port_addr]` 塞个 `read8/read16/read32` 处理器，客机 CPU 执行 `IN` 即调用它。
- `Instant-virtual-machine/src/guest-poweroff.ts` 的 `v86IoFromEmulator()` 已经证明**宿主 TS 能在运行时拿到 `emulator.v86.cpu.io.ports`**（它一直在用它改 write 处理器拦截关机端口）。也就是说这套能力已在 fork 里用着，**不用改 v86 就能注册 read 处理器**。
- 宿主在 `v86-runtime.ts` 创建 emulator 后已能获得 `emulator.bus`（`installAbsoluteMouseRemap(next.bus, ...)` 就是实证）。

**方案语义（重要澄清）**：I/O 指令只能由**客机 CPU 主动执行**，宿主没有「凭空模拟一次 IN」的能力。所以这不是「宿主推送」，而是「宿主把值放好，客机来拉」：

- **poweroff（已在做）** = 客机主动 `OUT` → 宿主在 write 处理器里收到（客机 → 宿主）。
- **分辨率** = 宿主把 `(w,h)` 存在闭包里 → 客机代理主动 `IN` → read 处理器把当前值递给客机（宿主 → 客机）。

二者都在同一张 io 表上、都能由宿主 TS 挂，方向相反，**都不用改 v86**。

**数据流（两跳）**：

```
[宿主 JS]   ResizeObserver → debounce → (w, h)
              │  经 emulator.bus.send("resolution", {w,h})
              ▼
[v86 io 表]  ports[RES_PORT] = { read32: () => (w<<16)|h }   // 宿主 TS 注册
              ▲  客机 IN
              ▼
[XP 代理]    32 位常驻轮询 → 值变化 → ChangeDisplaySettingsEx(w, h)
```

- 端口号选一个未被 v86 占用的 I/O 口（避开 0x60/0xF4/0x5658 等已有设备）。
- 每次 `read32` 返回 `(w<<16)|h`；代理记录上次值，变化才切模式，避免拖窗口连续重排。
- 代理未安装/不支持时静默保持现状（计划 §6 原有约定）。

## 5. 宿主侧接入（`Instant-virtual-machine`）

- [ ] `src/protocol.ts`：`InstantVmStartConfig` 增加 `resolutionAutoAlign?: boolean`（缺省 false）；与 `instant-app/src/apps/virtual-machine/virtual-machine-protocol.ts` 同步。
- [ ] `src/host.ts`：`InstantVmController`（或 displayController 思路）加 `setResolution(w, h)` 注入方法。
- [ ] `src/v86-runtime.ts`：创建 emulator 后，若开关打开，挂 `ResizeObserver`（screen container）→ debounce ~300ms → 阈值 ~80px → DPR 换算 → clamp → 在 io 表上注册 `RES_PORT` 的 read32（或经 bus 交给已注册的设备）。
- [ ] 开关未开时，不挂 observer、不注册端口，行为与现在完全一致（纯 CSS 缩放）。
- [ ] debug / release 两套产物都带这条改动（改动全在宿主 TS，不涉及 v86 wasm）。

## 6. instant-app 接入

- [ ] `VirtualMachineSettings` 增加「分辨率自动对齐」开关（默认关）。
- [ ] 开机配置带上开关（`virtual-machine-protocol.ts` 同步）。
- [ ] 客机不支持 / 代理未安装时静默降级，不报错。

## 7. 客机代理（XP 侧）

- [ ] 32 位常驻小工具，轮询 `RES_PORT`。
- [ ] 读到 `(w,h)` 变化后：枚举显示模式确认支持 → `ChangeDisplaySettingsEx(CDS_UPDATEREGISTRY)` → XP 显示子系统重布局。
- [ ] 随镜像分发、开机自启；镜像资产不进 git（参照 `todo/vm-xp-3d/04-guest-image-and-files.md` 的约定）。
- [ ] 工具链：llvm-mingw 32 位旧运行库（与 `todo/vm-xp-3d/02-guest-d3d-proxy.md` 第 3 节一致），或 zig 一条命令交叉编译。

## 8. 调研记录（不承诺实现，仅存档）

以下结论来自 2026-08-24 讨论，供后续排期参考。

### 8.1 端口语义与 load/带宽不适合传文件

- 端口 read 是一颗 32 位寄存器，一次 IN 拿 4 字节，且只能客机主动拉。适合低频、几字节的**信令**（分辨率即此），不适合文件载荷。
- 若未来做「拖文件进 XP」：**端口做公告/信令，文件本体走 v86 自带的 UART/串口通道**（`uart.js` 已注册 `serial*-input` bus，宿主可 `bus.send` 注入字节；计划 `vm-xp-3d/04` §2 的「客机送文件代理：模拟串口」正是同一条）。真实 VM 厂商（QEMU/SPICE、VBox、VMware）也都是「小命令走控制口、大文件走专用大通道」。

### 8.2 分辨率上限：三层取交集的最短板

- **v86 硬上限**：`vga.js` 的 `MAX_XRES=2560` / `MAX_YRES=1600` / `MAX_BPP=32`，每次 set 宽度/高度都 clamp。改大需改源码并重编 v86（与「不改 v86」约束冲突），且 XP 驱动不见得会选 4K。
- **`vgaMemoryMb` 的真实角色**：是**显存大小**，不是分辨率开关。帧缓冲字节 = 宽×高×bpp/8，必须 `≤ vgaMemoryMb`（软约束），再 `≤ 2560×1600`（硬约束）。`[2,4,8,16]MB` 对应能装的屏约 800×600 / 1024×768 / 1280×1024 / 2560×1600×32（≈15.6MB，16MB 刚够生死线）。16MB 与 2560×1600×32 是 v86 默认设计成恰好握手的一对。
- **XP 32 位**：无系统级固定分辨率上限；实际由**驱动枚举的模式表**决定，XP 时代典型到 1280×1024 / 1600×1200 / 1920×1200。即便放开模拟器到 4K，XP 的 `EnumDisplaySettings` 多半枚举不出、`ChangeDisplaySettingsEx` 失败。宿主 clamp 的上界应以「XP 实际可用的模式白名单」为依据，而不是 v86 的 2560 上限。

### 8.3 用户态读端口的权限边界

- 机制：IOPL 恒为 0（无关）；真正闸门是 **TSS 的 I/O Permission Bitmap**。
- 判定标准是**内核位数**，不是「exe 是 32 位还是 64 位」，也不是系统版本：
  - 32 位内核（XP / 32 位 Win7 / 32 位 Win10）→ 用户态直接 `IN` 可用，不需要驱动。
  - 64 位内核（Win7/10/11 x64，含跑 32 位 exe 的 WOW64）→ 用户态 `IN` 触发 #GP，需 ring0 驱动。
- 影响：当前 XP 目标用「寄存器 IO 端口」最简解成立；**若未来要支持 64 位 Win7，这条通道整个不通**，需换内存映射/共享内存设备或写客机驱动。选型要预留可替换性。

### 8.4 寄存器位宽

- `(w<<16)|h` 两个 u16 最大各 65535；相对 v86 上限 2560×1600 富余大。clamp 必须发生在移位之前，否则中间值溢出。
- 代理校验 `w≤2560 && h≤1600` 天然充当「溢出守卫」。未来要传版本/校验再扩读宽度，协议约好位数即可向后兼容。

## 9. 验收

- [ ] 手动：XP 控制台用测试工具直接读通道得 `(1280, 960)`，XP 桌面无闪烁地切换。
- [ ] 手动：宿主窗口拖大/拖小，客机分辨率数秒内跟随，画面 1:1 无 CSS 拉伸。
- [ ] 边界：目标超 XP 可用模式白名单 / v86 上限时，clamp/拒绝并保持原状。
- [ ] 回归：开关关闭时，现有镜像行为与现在完全一致。

## 10. 风险

- 在不改 v86 的前提下挂 read 端口，依赖 `v86IoFromEmulator()` 那条「宿主拿 io 表」的既有路径；若 v86 升级改内部结构需复查。
- XP 模式切换会闪屏/重排图标，debounce 阈值要偏保守，避免拖窗口时连续切模式。
- 快照恢复后代理状态：分辨率同步是无状态命令，恢复后宿主重发一次当前目标值即可。