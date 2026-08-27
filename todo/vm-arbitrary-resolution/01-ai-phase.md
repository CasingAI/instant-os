# vm-arbitrary-resolution · 01 第一期：AI 全自动（零用户干预）

> 本期的边界：**AI 唯一允许触达的 = 仓库内文件、命令行、单元测试、CI**。
> 全部工作可在两个仓库内完成并自验，不需要用户启动 XP。

## 0. 可行性 gate（本期的第一个动作，先于一切代码）

> 2026-08-27 复查发现 plan 初稿有 3 个硬伤（INF ID、文件名、显存探测），
> 且 Open Watcom V2 编译从未实际跑过。**先 spike 再写码**：

1. 在 CI/本地 Linux 容器下载 Open Watcom V2 Linux 版，**原样编译 boxvnt 原始源码**
   （不改一行），确认 `boxvideo.sys` 产出。失败则记录具体错误（头文件/库缺失、
   wlink 语法）并转入 §9 的构建替代路线，**不得跳过本 gate**；
2. 产物校验：`file` 确认 PE32 i386、导出 `DriverEntry@8`、体积 <200KB。

## 1. Vendor boxvnt 源码进仓库

目标目录：`src/apps/virtual-machine/guest/boxvnt/`（与 res-agent 同级）。

- 拉取 https://github.com/ivanagui2/boxvnt master 全部 14 个文件（含 MIT LICENSE 头，
  保留版权声明——MIT 必须保留原文）；
- 目录内新增 `VENDOR.md`：来源 URL、commit hash、许可证、改动清单；
- 改造一律**不修改版权头**，在文件内用 `/* Instant VM changes: ... */` 标注。

## 2. 驱动代码改造（全部 ~150 行内）

### 2.1 `boxv.c`：识别 v86 的 dispi ID + 修复显存探测

- `BOXV_detect`（boxv.c:431-444）范围 `<= VBE_DISPI_ID4` → `<= VBE_DISPI_ID5`（0xB0C5，
  加 `#define VBE_DISPI_ID5 0xB0C5`）。
- **显存探测修复（硬伤 #3，安全必需）**：原 `BOXV_detect` 连续读两次数据端口，
  第二次把 ID 当显存大小；且在 v86 上 `vid_ind` 走未注册的 read32 返回
  `0xFFFFFFFF` → FramebufLen=4GB → 显存校验失效 → 8MB 显存下切大模式会越界花屏。
  改为：`outw(0x1CE, 0x0A)` + `inw(0x1CF)`（v86 已实现 `svga_register_read` case 0x0A
  返回 `vga_memory_size / 64KB`）× 64KB。
- `VBE_DISPI_MAX_XRES/MAX_YRES`（boxv.c:92-93 现为 1024×768）改为 2560/1600（若参与校验）。

### 2.2 `vidmpdat.c`：静态表扩为密阶梯（R1 回退兼兜底）

- 保留 19 项基础表，**追加密阶梯**（生成器产出，见 §4）：
  - 宽度 640→2560，步长 8（8px 网格，视觉误差 ≤4px）；
  - 每宽度 × 常见纵横比 {4:3, 16:10, 16:9, 3:2}；
  - bpp 只留 32（XP 实际用 32bpp；8/15/16/24 保留原 19 项的即可）；
  - 预估 ~100–130 项（win32k 无列表上限问题，EnumDisplaySettings UI 过长无妨——
    res-agent 是程序化枚举）。
- 数组尾部预留动态槽位（如 8 个 `VIDEOMP_MODE` 空位 + `ulDynamicModes` 计数）。

### 2.3 `videomp.c`：动态模式注入 + 切换

- `HwVidFindAdapter`：`pExt->NumDynamicModes = 0`；`vmpValidateMode` 逻辑不动
  （静态表仍按 %8+显存 校验；密阶梯天然通过）。
- `IOCTL_VIDEO_QUERY_NUM_AVAIL_MODES`：`NumModes = NumValidModes + NumDynamicModes`。
- `IOCTL_VIDEO_QUERY_AVAIL_MODES`：先填静态 bValid 项，再填动态项
  （`vmpFillModeInfo(modeInfo, W, H, 32)`，`ModeIndex = ulAllModes + i`）。
- 新增 `vmpRefreshDynamicMode(pExt)`（每次 QUERY 前调）：
  1. `in 0xE003` == 0x5AB0 才继续（握手，避免无宿主时读垃圾）；
  2. `in 0xE001`/`0xE002` 读 W/H；
  3. 校验：`W,H ∈ [640,2560]×[480,1600]` 且 `W*H*4 ≤ FramebufLen`；
  4. 若与已缓存的动态项相同则不动；否则覆盖（防抖动）；
  5. 动态项只在「宿主推了有效目标」时存在——无目标时 NumDynamicModes=0，
     行为与原始 boxvnt 逐字节一致（硬要求）。
- `IOCTL_VIDEO_SET_CURRENT_MODE`：
  - `modeNumber < ulAllModes`：走原逻辑；
  - `modeNumber >= ulAllModes`（动态项）：取动态 W/H → `BOXV_ext_mode_set(...)`；
  - `pExt->CurrentModeNumber` 按实际切换值记录（QUERY_CURRENT_MODE 读它）。
- `IOCTL_VIDEO_RESET_DEVICE`：顺带清 `NumDynamicModes=0`（复位到纯静态）。

### 2.4 INF：修正设备 ID 与文件名（硬伤 #1/#2）

- `vidmini.inf` `[BOXV.Mfg]` 段原为 `PCI\VEN_80EE&DEV_BEEF`（VirtualBox），
  **改为 `PCI\VEN_1234&DEV_1111`**（我们的设备）；可保留 80EE 行为兼容段；
- `[SourceDisksFiles]` 原引用 `vidmini.sys`，**统一为 makefile 产出的 `boxvideo.sys`**；
- 设备描述改为「Instant VM Graphics Adapter」；版本号/日期更新；
- `InstalledDisplayDrivers=framebuf`（REG_MULTI_SZ）保持（XP 自带 framebuf.dll，
  boxvnt 作者实测 NT4+ 预装）。

## 3. 宿主侧（Instant-virtual-machine）IO 端口

新文件 `src/resolution-mode-port.ts` + `src/resolution-mode-port.test.ts`：

- 常量：`PORT_MODE_W=0xE001, PORT_MODE_H=0xE002, PORT_MODE_MAGIC=0xE003, MODE_MAGIC=0x5AB0`；
- `installResolutionModePort(emulator, getPacked)`：
  - 复用 `resolution-port.ts` 的打包值闭包（同一目标源，改一处两边同步）；
  - 仅当 `startConfig.resolutionAutoAlign === true` 时注册（关闭时行为逐字节不变，
    沿用 00 §5 硬要求）；
  - `ports[0xE001].read16 = () => packed >>> 16`；`0xE002` 同；`0xE003` 返回魔数；
- `v86-runtime.ts`：在 `startResolutionSerial` 同一门控处挂载 `installResolutionModePort`；
- 单测覆盖：门控开/关、打包值更新即时反映、越界 clamp 后端口值、魔数常量、
  未注册时端口读默认 0（无副作用）。

## 4. 生成器（单一事实源）

`scripts/gen-boxvnt-modes.mjs`（或 .ts，跟仓库脚本惯例）：

- 输入：步长/纵横比/上限参数；
- 输出 A：`vidmpdat.c` 的 `VideoModes[]` C 数组片段（密阶梯 + 19 基础项）；
- 输出 B：宿主侧 `resolution-channel.ts` 的期望表（供测试断言）；
- 输出 C：模式数/最大显存需求（供文档）；
- 单测：`scripts/*.test.ts` 断言生成器输出与两份产物一致（防漂移）。

## 5. CI 构建管线（产出 boxvideo.sys）

`scripts/build-boxvnt.sh`（仿 `build-res-agent.sh`）：

1. 下载 Open Watcom V2 Linux 版（github.com/open-watcom/open-watcom-v2 releases，
   走代理；CI 缓存）；
2. `export WATCOM=...`，`wmake`（或 owmake）跑 `guest/boxvnt/makefile`；
3. 产物 `boxvideo.sys` 落到 `src/apps/virtual-machine/guest/boxvnt/out/`；
4. 产物校验单测 `boxvnt-binary.test.ts`（仿 res-agent-binary.test.ts）：
   - PE32 i386、`DriverEntry@8` 导出、导入表仅 videoprt/kernel32、
     校验和位非零、体积 <200KB；
   - 断言 C 数组生成器产物与 `vidmpdat.c` 内嵌表一致。

## 6. 宿主选档逻辑收口（任意直推）

`resolution-channel.ts`：

- `resolutionTargetFromViewport` 不再吸附 17 档标准表：直接返回
  `clamp(cssWidth, 640, 2560) × clamp(cssHeight, 480, 1600)`（四舍五入到 8px 网格，
  与驱动 %8 校验对齐——或驱动去掉 %8 后任意值，二选一，选**四舍五入到 8px**，
  驱动零改动风险最小）；
- `selectResolutionMode` 保留（17 档表仍用于「驱动未装」的降级路径？——
  判定：**降级路径不需要**，驱动未装时 res-agent 不存在，行为与现状一致；
  但为稳妥，`displayMode` 参数与旧逻辑保留为可开关，默认开新路径）；
- 更新 `resolution-channel.test.ts` 全部期望（此改动面最大，逐条重算并断言）。

## 7. 文档

- `guest/boxvnt/` 内 `README.md`（构建/产物/校验和/INF 安装要点——第二期手册的原料）；
- `todo/vm-arbitrary-resolution/02-user-phase.md`（第二期用户照抄手册，见下）；
- 00-overview 的验收勾选更新。

## 8. 提交与验证

- 两个仓库分别 `tsc --noEmit` + `pnpm test`（instant-app）/ `pnpm test`（runtime）全绿；
- pre-commit 钩子通过；
- 提交信息遵循项目惯例（如 `feat(vm): arbitrary resolution via boxvnt dynamic modes`）。

## 9. 第一期完成态

- 代码全部落地、CI 能产出已校验的 `boxvideo.sys`；
- 宿主端口与选档逻辑单测全绿；
- 唯一未验证项 = XP 实机行为（R1）——明确移交第二期。
