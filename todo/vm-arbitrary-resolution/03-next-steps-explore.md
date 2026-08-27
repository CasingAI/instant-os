# vm-arbitrary-resolution · 03 下一步与周边技术调研

> 2026-08-27，第一期完成当天。两部分：A. 本特性下一步（含 R1 调研定论）；
> B. 周边技术格局（v86 生态 / 同类方案 / 客机集成先例 / 外设现状）。
> 所有结论标注证据来源；无来源的写明「推测」。

## A-0. R1 定论：XP 会重查模式列表（主路径成立）

风险 R1（XP win32k 缓存 miniport 模式表 → 动态项不即时生效）**基本解除**：

- **VirtualBox 生产代码注释（真 XP 多年验证的行为事实）**：`VBoxTray/VBoxDisplay.cpp`
  XPDM 路径原注释 *"Re-requesting modes with EnumDisplaySettings forces Windows
  to again ask the miniport for its mode table"*，其对每台显示器先调一次
  `EnumDisplaySettings(dev, 0xffffff)`（越界索引）再 CDS；
  `VBoxDispIf.cpp`（Vista 路径）注释 *"Without this, Windows will not ask the
  miniport for its mode table but uses an internal cache instead"*——证明
  缓存存在，但**一次任意索引的 EnumDisplaySettings 即可刷新**。
- **MSDN**：iModeNum=0 时 "initializes and caches"；XP 实际比文档更宽
  （越界索引也刷新，VBox 依赖此行为）。
- **ReactOS**：`NtUserEnumDisplaySettings` → `UserEnumDisplaySettings` 无条件
  `PDEVOBJ_vRefreshModeList`；2022-05 曾改回「仅 iModeNum=0 刷新」同日被回滚
  （CORE-18189），回滚理由就是破坏 VBox 动态分辨率。
- **CDS 校验语义**：ReactOS（按 XP 建模）`LDEVOBJ_bProbeAndCaptureDevmode`
  对列表**精确匹配**，列表外模式 → `DISP_CHANGE_BADMODE`，不会下发 IOCTL。
  即 res-agent「先枚举（顺带刷新缓存）→ 精确匹配 → CDS」的顺序是必需且正确的
  （既有实现已满足）。

**由此发现并已落地的隐患修正（fce99f2）**：VBox `VBoxMPVidModes.cpp` 原注释
*"We need to alternate mode index entry for a pending mode change, else windows
will ignore actual mode change call"*——动态模式固定在同一索引时，连续切换会被
win32k 忽略。已把 boxvnt 动态项改为**双槽交替**（目标变化换槽，同目标稳定）。

剩余开放点（第二期实测）：XP SP2/SP3 间差异无公开证据；framebuf.dll 对
900+ 模式列表的透传（R11）仍需实机确认。

## A-1. 本特性的收尾清单

| # | 项 | 说明 | 时机 |
|---|---|---|---|
| 1 | **第二期实机验证** | `02-user-phase.md`；唯一需要人的步骤。注意存量机器显存要手动调 16MB | 用户一次 |
| 2 | 阈值调优（R10） | 现阈值 80px：拖动慢时最多 79px 不跟随。逐像素贴合诉求下可降到 16–32px（≥8px 网格防抖），debounce 300ms 已足够防抖 | 第二期反馈后 |
| 3 | 驱动并入发布资产 | `boxvideo.sys`+`vidmini.inf` 进 dist/发布通道（02 §5 收尾） | 第二期通过后 |
| 4 | CI 实际启用 | `.github/workflows/build-boxvnt.yml` 已提交；组织侧从未用过 Actions，推送后需确认能跑 | 下次 push |
| 5 | 上游 PR（可选） | v86 正处「Windows 客机化」快车道（2026-04~08 大量相关合并）；`VBE_DISPI_IOPORT_INDEX` 读实现（`167c891c`）等先例表明 dispi 小改动可进上游。我们的 host→guest 分辨率机制可拆 PR | 第二期验证后 |

## A-2. 下一步候选（产品方向，按建议优先级）

1. **剪贴板 + 绝对鼠标：对齐 VMware backdoor（0x5658）**
   - 事实：v86 已合并 VMware 绝对鼠标 backdoor（PR #1542，felixrieseberg，
     2026-06）；文本剪贴板命令 PR #1589 开放中（GETSELLENGTH/SETNEXTPIECE 等，
     bus 事件 `vmware-clipboard-host/guest`）。
   - 客机侧可复用成熟驱动（VBADOS 的 VBMOUSE、NT4 VMware Tools vmmouse.inf——
     v86 `docs/windows-nt.md` 官方推荐此路线）。
   - 启示：res-agent 的下一代不必自造协议，走 0x5658 backdoor 与上游/社区
     同路；#1589 合并后宿主侧零成本获得剪贴板。
2. **「窗口→分辨率」产品化 + 嵌入 API**
   - 事实：WebVM（CheerpX）的 `setKmsCanvas` 每次 window resize 重设客机分辨率，
     并设**最小内部分辨率 1024×768**（小窗口反向放大）；Infinite Mac 2025-07
     的 Construction Set 提供嵌入方指定分辨率的 API。
   - 启示：小视口策略可借鉴 WebVM（下限抬到 640×480 以上 + canvas 拉伸），
     并把 setResolution 包装成对外嵌入 API（v86 生态独一份）。
3. **网络（零安装可行）**
   - 事实：v86 NIC 仅 ne2k（PCI 10EC:8029 = RTL8029，**XP 自带驱动**）与
     virtio-net；后端四选：inbrowser/wsproxy/wisp/fetch，其中 **fetch 后端
     免服务器**（浏览器 fetch+CORS 代理，支持 `http://<port>.external` 访问
     宿主 localhost）。
   - 启示：XP 客机联网 = rtl8029.sys（自带）+ fetch/wisp 后端，无需客机安装。
4. **声音（零安装）**：v86 SB16 含 OPL3；XP 自带 "Sound Blaster 16 or AWE32
   or compatible (WDM)" 驱动（v86 `docs/windows-nt.md` §4.3）。宿主侧把
   `dac-send-data` 接 WebAudio 即可。
5. **文件交换**：XP 无 9p/virtio-fs 客户端（virtio-win 不含 9p；virtio-fs 面向
   Win10+）。务实路线：①网络通了走 HTTP；②磁盘镜像导入导出（runtime 已有
   create_file/read_file 与软盘/CD 下载）。
6. **不做/缓做**：USB（v86 无 host controller，成本高）；DirectDraw 加速
   （v86 无 2D 加速，VBEMP 也不支持 DDraw，issue #1342）；多核/64 位
   （上游明确不支持）。

## B. 周边技术格局速览

| 方案 | 现状 | 与我们的关系 |
|---|---|---|
| **v86（copy/v86）** | 极活跃（2026-08 仍有日常提交）；Rust JIT；指令集 ~P4/SSE3；无多核/64 位 | 底座；「宿主窗口→客机任意分辨率」上游空白，是我们的差异点 |
| **CheerpX/WebVM** | CheerpX 1.0 闭源商用授权；用户态+syscall 层（非全系统），跑 Linux；System mode（Windows）是未来工作 | 分辨率跟随交互的对拍对象（setKmsCanvas）；引擎不可替换 |
| **qemu-wasm** | GPLv2、面向容器演示 | 只作设备模拟参考（e1000/USB 逻辑），不换引擎 |
| **JSLinux** | 闭源非商业 | 无可借鉴工程物 |
| **ReactOS bochsmp.c** | GPL-2.0+，Bochs BGA miniport（23 档固定表、32bpp-only、I/O 或 MMIO dispi、GETCAPS/显存探测、EDID-in-MMIO） | boxvnt 的官方对拍样本：能力探测与设置序列可比对；EDID 需求时抄 vbe/edid.c |
| **BottleShip** | HLE 路线（不装 OS，重实现 Win32/DirectDraw） | 不同赛道；说明全系统路线在「任意软件」场景不可替代 |
| **Infinite Mac** | Mac 系；分辨率启动时指定（Construction Set API） | 嵌入 API 的形态参考 |
| **v86 Windows 客机生态** | felixrieseberg 连投 VMware backdoor PR（推测在做 Windows-on-v86 产品）；progrium/env86 做镜像工具链 | 社区方向与 A-2.1 一致，跟进而非另起炉灶 |

## C. 一页结论

- 第一期（AI 全自动）已完成并双仓库提交；唯一剩余人工步骤 = 第二期装驱动验证。
- R1 有强证据解除；顺手修掉 VBox 揭示的「同索引切换被忽略」隐患（双槽交替）。
- 下一步最高价值的工程方向：VMware backdoor 剪贴板/鼠标（等 #1589 或自实现）、
  嵌入 API、网络（rtl8029+fetch，零安装）、声音（SB16 WDM，零安装）。
- 保持差异点：窗口→任意分辨率在 v86 生态没有对位功能，值得做成产品能力并向
  上游回馈小改动。
