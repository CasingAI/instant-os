# vm-arbitrary-resolution · 00 Overview —— XP 任意分辨率（boxvnt 驱动改造）

> 分支建立：2026-08-27。调研背景见
> [vm-resolution-auto-align/05-arbitrary-resolution-explore.md](../vm-resolution-auto-align/05-arbitrary-resolution-explore.md)。
> 硬约束（沿用全项目）：**第一期零用户干预**（AI 只动仓库文件/命令行/单测/CI）；
> 需要干预的实机装驱动与最终验证**单独立为第二期**。

## 1. 定案一句话

把现成 MIT 开源 miniport [boxvnt](https://github.com/ivanagui2/boxvnt)
（专为 1234:1111 + dispi 显卡写的 Windows NT 显示驱动，正好是我们模拟的硬件）
改造成「每次 win32k 枚举模式表时，从宿主 IO 端口读目标 W×H 并动态加入列表」，
实现 **XP 任意分辨率（逐像素精确）**。

## 2. 机制（三层各就各位）

```
[宿主 Instant-virtual-machine]
  resolutionTargetPacked 闭包（已有，clamp 后 (w<<16)|h）
  → 新注册 IO 端口（仅开关打开时）：
      ports[0xE001].read16 = packed >> 16          // 目标宽度
      ports[0xE002].read16 = packed & 0xffff       // 目标高度
      ports[0xE003].read16 = 0x5AB0                // 握手魔数（驱动探测通道）

[XP 内 boxvnt 改造（ring0）]
  IOCTL_VIDEO_QUERY_NUM_AVAIL_MODES / QUERY_AVAIL_MODES：
    = 静态表（密阶梯，bValid 过滤）+ 动态项（读端口，校验后追加）
  IOCTL_VIDEO_SET_CURRENT_MODE：
    modeNumber 命中动态项 → BOXV_ext_mode_set(W, H, 32) → dispi 写寄存器

[XP win32k]
  EnumDisplaySettings 每次 → PDEVOBJ_vRefreshModeList（清缓存重建列表）
  → miniport IOCTL_VIDEO_QUERY_AVAIL_MODES → 驱动实时读端口 → 返回含目标的列表
  → res-agent EnumDisplaySettings 精确命中 → ChangeDisplaySettingsEx(W,H)
  → IOCTL_VIDEO_SET_CURRENT_MODE → 切任意分辨率
```

**为什么可行（证据）**：
- ring0 驱动 IN 端口无特权限制（当初 ring3 IN #GP 是 res-agent 的事，驱动不受限）；
- v86 io.ports 表动态注册对 IN/OUT 全量生效（guest-poweroff 拦 OUT 已有先例）；
- ReactOS `pdevobj.c:432-460` `PDEVOBJ_vRefreshModeList`：每次枚举前**清空并重建**模式列表（`pdevmodeInfo=NULL` → 重新调 `LDEVOBJ_bBuildDevmodeList` → 重调驱动），
  动态项**即时生效，无需重启**（风险 R1：XP 真身是否与 ReactOS 一致，第二期验证）；
- boxvnt `BOXV_ext_mode_set`（boxv.c:281）已支持任意 xres/yres（dispi 无对齐约束）；
- v86 dispi 上限 2560×1600（vga.js MAX_XRES/MAX_YRES），32bpp 需 16MB 显存（协议已支持）。

## 3. 分期

| 期 | 名称 | 谁做 | 内容 |
|---|---|---|---|
| **第一期** | 代码/构建/单测 | **AI 全自动** | vendor boxvnt、改驱动（动态模式+0xB0C5）、宿主端口、CI 构建管线（Linux Open Watcom）、产物校验单测、typecheck 全绿、文档 |
| **第二期** | 实机装驱动+验证 | **用户**（一次） | 拷驱动/装 INF/重启/开开关/拖窗口验证/回报 |

## 4. 验收

- 第一期（✅ 2026-08-27 完成）：
  - `pnpm typecheck` 净、单测全绿（两仓库）；
  - `scripts/build-boxvnt.sh` 在 macOS arm64 实测产出 `boxvideo.sys`
    （PE32、i386、native、校验和位非零、入口点非零、导入表仅 VIDEOPRT.SYS、
    15,616B < 200KB、两次构建校验和相等）；`.github/workflows/build-boxvnt.yml`
    提供等价的 Linux CI 管线（本仓库首个 workflow，Actions 是否启用待组织侧确认）；
  - 宿主端口单测覆盖门控/更新即时性/越界 clamp/魔数/优雅降级
    （`Instant-virtual-machine/src/resolution-mode-port.test.ts`）；
  - 生成器防漂移单测（`scripts/gen-boxvnt-modes.test.ts`）。
  - 与初稿的三处出入（复查后修正）：① 密阶梯实际 **821 项**（初稿预估
    100–130 与其自身参数——步长 8 × 4 纵横比——矛盾，以参数为准）；② NT
    驱动**无导出表**，`DriverEntry` 走 PE entry point，验收项改为「入口点
    非零」；③ 仓库本无 CI 体系，按 res-agent 惯例落地为「本地脚本 + SKIP
    型产物单测」+ 新增 workflow 文件；
  - §0 gate 结论：Open Watcom V2 `Last-CI-build` snapshot 自带 macOS arm64
    工具（armo64/）+ `h/nt/ddk` + `lib386/nt/ddk/videoprt.lib`，R2/R3 风险
    消除；pristine boxvnt 原样编译通过（9,984B），需要的适配全部在构建
    层（`-fo=$@`、`wrc -bt=nt`、`wlink @boxvideo.lnk`、`INCLUDE` 三层），
    详见 VENDOR.md。
- 第二期：XP 内拖动窗口到任意尺寸，画面无黑边无溢出、逐像素贴合（视觉验证，以截图回报）。

## 5. 风险与回退

| # | 风险 | 影响 | 回退 |
|---|---|---|---|
| R1 | XP 真身 EnumDisplaySettings 可能不重建列表（ReactOS 会） | 动态项不即时生效 | 静态表直接扩成**驱动级密阶梯**（~100 项，8px 步进×常见纵横比）——即使列表缓存，任何目标就近吸附误差 ≤4px，视觉无差；此回退同时取代原 T1（无需 BIOS 重建） |
| R2 | Open Watcom V2 与 1.9 makefile 语法不兼容 / 编译失败 | CI 构建失败 | 01 §0 的可行性 gate 先试编；失败用 owmake/改 makefile 语法，或换 ReactOS ddk 头/库（MIT/GPL 兼容）；boxvnt 已有 `SIZE_OF_*` 自补宏先例 |
| R3 | OW 自带 videoprt.lib 缺失/头不全 | 链接失败 | 同上；从 XP DDK 镜像或 ReactOS 取 videoprt.lib |
| R4 | v86 io.ports 动态注册对 ring0 IN 不生效 | 驱动读不到目标 | 直接复用 serial0-input 字节流（驱动也可读 COM1，但需与 res-agent 分时）——**不启用，仅记录** |
| R5 | 动态模式显存越界 | 花屏 | **已修复**（01 §2.1）：BOXV_detect 改读 dispi index 0x0A 真实显存；驱动校验 `w*h*4 ≤ FramebufLen`；宿主 clamp 已有 |
| R6 | **INF 设备 ID 是 80EE:BEEF（VBox）不是 1234:1111**（复查发现） | PnP 自动安装不认设备 | 01 §2.4 改为 `VEN_1234&DEV_1111`；手动安装路径仍可用 |
| R7 | **INF 引用 vidmini.sys，makefile 产出 boxvideo.sys**（复查发现） | 安装找不到文件 | 01 §2.4 统一文件名 |
| R8 | **BOXV_detect 显存探测读 -1（v86 read32 未注册）**（复查发现） | 显存校验失效 → 8MB 显存下越界花屏 | 01 §2.1 修复：读 index 0x0A ×64KB |
| R9 | 显存默认 8MB，动态模式 2560×1600×32 需 16MB | 高分辨率被拒/花屏 | 默认显存 8→16MB（`virtual-machine-types.ts`），设置档位可选至 256MB；驱动显存校验兜底 |
| R10 | 任意值直推后拖动切换更频繁（不再吸附档位） | 闪屏次数增多 | 已知 UX 行为：debounce 300ms + 切换毫秒级，可接受；第二期用户反馈后调阈值 |
| R11 | framebuf.dll 对动态追加模式的透传未实证 | 模式列表出不来 | 低风险（作者在 VBox 实测 19 项能枚举，格式相同）；第二期实证，失败则回到纯密阶梯 |

## 6. 与既有分支的关系

- 调研/定案历史：`vm-resolution-auto-align/05-*.md`（v1→v2→v3，含 boxvnt 全源码分析）；
- 本分支不依赖 `vm-resolution-auto-align` 的档位表（宿主直推任意值，不再走 17 档标准表）；
- res-agent（COM1 通道）**不改**：它本来就「枚举→精确匹配→切换」，现在精确匹配能命中任意值。
