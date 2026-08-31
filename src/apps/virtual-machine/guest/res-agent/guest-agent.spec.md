# guest-agent 部署规格（第三期照抄）

> 本文件是 `guest-agent.spec` 的等价物：定义 ivm-agent.exe（res-agent 与
> clipboard-bridge 的合并产物，见 ../README.md）在客机里的安装位置、启动项、
> 注册表键值、v2 操控协议。部署步骤逐字照抄即可。

## 产物

| 项 | 值 |
|---|---|
| 文件 | `ivm-agent.exe`（构建：`make` 或 `scripts/build-ivm-agent.sh`，产物统一落 `guest/out/`） |
| 架构 | PE32 i386，GUI 子系统，OS/Subsystem 版本 5.01 |
| 导入表 | 仅 kernel32.dll / user32.dll / advapi32.dll / ole32.dll（XP 裸机自带） |
| 体积 | < 300 KB（合并后实测 ~34 KB） |
| 运行形态 | 双击 / HKCU Run = 交互进程；`sc create` 注册后由 SCM 启动 = XP 服务（免登录） |

## 客机内位置

```
C:\Tools\ivm-agent.exe
```

（`C:\Tools` 不存在就先建。放别的目录也行，但下面的服务/注册表路径要跟着改。）

## 开机自启（推荐：XP 服务，免登录即起）

todo/vm-remote-control §7 预防层——服务形态开机即起，不依赖用户登录桌面：

```bat
sc create InstantVmAgent type= own start= auto binPath= "C:\Tools\ivm-agent.exe"
sc description InstantVmAgent "Instant VM guest agent (resolution + remote control)"
```

要点：

- `start= auto`（= StartType 2，开机自动启动）。`sc` 的参数格式是
  `key= value`——等号后必须有空格，漏了会静默建错；
- exe 内已实现 `StartServiceCtrlDispatcherA`：SCM 启动走服务入口
  （报告 RUNNING 后进主循环），非 SCM 启动自动落回交互模式，同一 exe 两用；
- 服务入口的单实例冲突直接报告停止（session 0 弹框会挂死 SCM），
  交互入口保留弹框提示；弹框内容带版本号与构建日期
  （`ivm-agent is already running. version 3, built <时间戳>`）——
  双击 exe 即可确认 XP 里跑的是哪次构建；
- 登录身份与 COM1 归属解耦（合并改造）：COM1 归属看 Global 互斥
  `Global\InstantVmAgent`（服务与登录实例谁先起谁跑），剪贴板桥归属看
  会话互斥 `InstantVmClipboardBridge`。登录实例输掉 COM1 也不再退场，
  改为只跑剪贴板桥（服务摸不到交互会话的剪贴板）；
- 移除：`sc delete InstantVmAgent`。

### 旧形态：HKCU Run（需登录，保留兼容）

注册表键：

```
HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run
  "InstantVmAgent" = "\"C:\Tools\ivm-agent.exe\" /autostart"
```

等价的 reg 文件（`res-agent-install.reg.source` 模板，collect 时展开为 `install.reg`）：

```reg
Windows Registry Editor Version 5.00

[HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run]
"InstantVmAgent"="\"C:\\Tools\\ivm-agent.exe\" /autostart"
```

从 Run 键迁到服务时，记得删除 Run 键值（两个实例并存时第二个会单实例退出）。

## 端口协议

### v1 分辨率帧（原样不变）

| 项 | 值 |
|---|---|
| 载体 | COM1 串口，8N1 9600（**必须显式 SetCommState**，见下） |
| 帧 | `A5 | 04 | w_lo w_hi h_lo h_hi | 校验和`（校验和 = 前 6 字节累加 & FF） |
| 编码 | `(width << 16) \| height`，小端 |
| `0` / 重复值 | 保持现状（agent 侧去重） |
| 越界 | 宽 > 2560 或高 > 1600 → 拒绝（溢出守卫） |

### v2 操控帧（todo/vm-remote-control §6）

帧格式 `[A5][len][payload...][csum]` 与 v1 同构，`len≠4` 时 `payload[0]` 是
opcode，宿主经运行时串口发送下发（resolution-serial 泵每秒的分辨率帧
与 v2 命令帧在同一字节流上交错，逐字节+校验和解析天然免疫）：

| len | 命令 | payload | 行为 / 回执（`[IVM]…\r\n`，COM1 回传） |
|---|---|---|---|
| 0x04 | 分辨率（v1） | `(w<<16)\|h` LE | 就近吸附切换显示模式 |
| 0x01 | PING（0x01） | — | 回 `[IVM]PONG=<tick> ver=2 built=<YYYYMMDD-HHMMSS>`（构建时间戳由构建脚本注入） |
| 0x01 | SHUTDOWN（0x02） | — | 回 `[IVM]SDWN=1` 后 `ExitWindowsEx(EWX_SHUTDOWN\|EWX_POWEROFF\|EWX_FORCE)` |
| 0x01 | REBOOT（0x03） | — | 回 `[IVM]RBOOT=1` 后 `ExitWindowsEx(EWX_REBOOT\|EWX_FORCE)` |
| N | EXEC（0x10） | `0x10 <cmdline\0>`（ASCII，≤198 字符） | `CreateProcessA`（CREATE_NO_WINDOW）；回 `[IVM]EXEC=1` 或 `[IVM]EXEC=0 err=<GLE>` |
| 0x02 | SHM_QUERY（0x12） | — | 每次现查 `\\.\IVMSHM` 后回 `[IVM]SHM=<物理基址> size=<n>`（剪贴板信箱握手，v3）；驱动不在回 `SHM=0`。客机重启会重新分配基址，宿主须按应答值重建信箱（未握手 5s 周期重问，已握手 30s 低频复问） |
| 0x05 | CLICK（0x20） | `0x20 <x:u16><y:u16>` LE | `SetCursorPos` + `mouse_event` 左键单击；回 `[IVM]CLICK=1` |
| 0x05 | DBLCLICK（0x21） | `0x21 <x:u16><y:u16>` LE | 同上双击（两次单击间隔 60ms）；回 `[IVM]DBLCLK=1` |
| 0x02 | SNAP（0x13） | `0x13 <0\|1>` | 窗口吸附开关（v4）：挂/卸 LL 钩子（切到 snap 线程执行），fire-and-forget 无回执；宿主「体验增强 → 窗口吸附」实时下发 |
| 0x02 | SNAP_EDGE（0x14） | `0x14 <px>` | 吸附触发距离（v5）：光标贴近屏幕边缘多少像素触发吸附，客机 clamp 2..64、默认 12；fire-and-forget 无回执；宿主「体验增强 → 窗口吸附 → 吸附触发距离」实时下发 |

关机路径：`ExitWindowsEx` 触发客机 ACPI 切电 → 宿主 `guest-poweroff`
watcher → `destroyCurrent`（stop → 写回落盘 → 销毁）——即「软关机」。
（2026-08-29 起 `vm-safe-reload.sh` 与调试桥已删除，改虚拟机代码为普通刷新，
需落盘时用产品侧「关机」按钮走这条链路。）

## COM1 已知坑（§8.8，勿再踩）

1. **串口初始是 7 数据位**：必须显式 `BuildCommDCBA("9600,n,8,1")` +
   `SetCommState`（DCB 往返无效），且显式 `SetCommTimeouts`
   （默认无限阻塞，读循环会卡死）；
2. **单实例**：COM1 归属 `CreateMutexA("Global\\InstantVmAgent")`，
   剪贴板桥归属 `CreateMutexA("InstantVmClipboardBridge")`（均由合并入口持有）。

## 常用 EXEC 配方

```text
# 根治蓝屏秒重启（XP 默认 AutoReboot=1——「只能手机慢动作拍」的根源）
reg add "HKLM\SYSTEM\CurrentControlSet\Control\CrashControl" /v AutoReboot /t REG_DWORD /d 0 /f

# 探活产物（宿主靠 PONG 判断 agent 存活，不需要这个；留作 EXEC 链路自检）
cmd /c echo alive %DATE% %TIME% > C:\Tools\agent-alive.txt

# agent 自愈（§7 自救层）：重拷新版 exe 后重启服务
sc stop InstantVmAgent & sc start InstantVmAgent
```

## 驱动安装子命令

合并入口 `ivm_agent_entry` 按命令行开关分发（先于服务调度器），安装脚本
与诊断脚本调用；两个常驻身份（服务 / 登录）每次启动还会各调一次自愈，
已装幂等零开销：

| 子命令 | 行为 | 退出码 | 日志 |
|---|---|---|---|
| `/mouse-install` | 注册 vmmouse 服务 + 挂上 PS/2 鼠标实例的 UpperFilters | 0=成功 1=无 PS/2 设备实例 2=驱动文件/服务/注册表失败 | `C:\Tools\mouse-install.log` |
| `/mouse-check` | 只读体检 + 报告弹窗 | 0=已挂 1=未挂 2=驱动文件/服务缺失 | 同上 |
| `/audio-install` | 就地提取 XP 内置 ctlsb16.sys + 注册/解禁服务 + 绑定 `*CTL00xx` 声卡实例 + 给缺资源的 `Root\` 实例补 LogConf 启动资源；无实例时**自建** `Enum\Root\*CTL0031\0000`；清回滚标记 | 0=成功 1=无实例且建不成 2=提取/服务/注册表失败 | `C:\Tools\audio-install.log` |
| `/audio-uninstall` | 回滚：删自建的 `*CTL0031` 实例 + 禁用 ctlsb16 服务 + 落回滚标记 `C:\Tools\audio-uninstalled.flag`（BIOS/向导枚举的实例不碰） | 0=成功（含本来没装）2=注册表失败 | 同上 |
| `/audio-check` | 只读体检 + 报告弹窗（服务 Start 类型、实例 `LogConf` 资源现状） | 0=已装 1=未装 2=驱动文件缺失或服务缺失/被禁用 | 同上 |

失败模式备忘（2026-08-30 真机）：`/mouse-check` 报「service: MISSING + filter
attached: YES」时，PS/2 鼠标设备开机即启动失败（PnP 加载 UpperFilters 找不到
服务），光标全模式冻死——重装 bat 的 `sc delete vmmouse` → `/mouse-install`
撞 1072 竞态所致；`/mouse-install` 重跑即愈（重建服务，过滤链幂等）。自愈已
改为服务+过滤链两者都查。另：此镜像 reg.exe 任何查询都退 1（疑似精简版阉
割），诊断只信 agent 弹窗（advapi32）与命令退出码，别信 reg.exe。

`/audio-install` 细节（源码见 `../ivm-agent/ivm-audio-install.c`）：

- 背景：v86 下 XP 对 SB16 的 PnP 自动安装经常不触发（设备管理器黄叹号
  「多媒体音频控制器」），这是客机无声的根源。驱动是 XP 内置（inbox
  WDM），仓库不 vendor 微软文件，文件就地在客机内提取：
  `%SystemRoot%\Driver Cache\i386\sp3.cab / sp2.cab / driver.cab`
  （`expand <cab> -f:ctlsb16.sys drivers\`）→ 各 CD-ROM 的
  `I386\CTLSB16.SY_`（`expand -r`）→ `C:\Tools\ctlsb16.sys` 人工放置
  （bat 第 4 步会把脚本同目录的 `ctlsb16.sys` 代放过去）；
- 无实例时自建设备（**只有显式 /audio-install 会做**）：v86 不模拟 ISA
  PnP，注册表里常常连声卡实例都没有（v86 官方指引因此是「添加硬件向导 →
  手动从列表选 SB16 WDM」）——此时自建 `Enum\Root\*CTL0031\0000`
  （DeviceDesc/HardwareID=`*CTL0031`、ClassGUID=MEDIA、Service=ctlsb16、
  ConfigFlags=0、MatchingDeviceId），与向导产物同构，重启后 PnP 按
  HardwareID 匹配 inbox INF 自动装驱动。**开机自愈绝不建实例**（只绑定
  已存在的实例）——凡「给系统造新设备」的写操作只许放在显式子命令里，
  这是 2026-08-30 鼠标事故后的铁律（同段教训见 README「声音」节）；
- 绑定既有实例 = 给实例写 `Service=ctlsb16`、`Class=MEDIA`、
  `ClassGUID={4D36E96C-E325-11CE-BFC1-08002BE10318}`、`ConfigFlags=0`
  （清 CONFIGFLAG_FAILEDINSTALL），删掉陈旧的 `Driver` 值；注册表直改
  无向导无签名问题，重启设备重新枚举后生效；
- 设备识别：设备键名或 HardwareID 有 `CTL00` 前缀（前导 `*` 忽略）；
  游戏口 `CTL7xxx` 天然排除。自建失败时把扫到的全部硬件 ID 落日志
  （回答「声卡到底被枚举出来没有」）；
- 服务解禁与回滚标记（2026-08-31）：`/audio-uninstall` 禁用 ctlsb16 服务
  后，向导/BIOS 枚举出的绑定实例不删，install 与自愈曾全被「已绑定」短路，
  服务禁用永久化 → 设备管理器 Code 32（CM_PROB_DISABLED_SERVICE），手动
  INF 重装也救不回（INF 不覆盖既有 Start 值）。现版：install/self-heal 见
  Start=SERVICE_DISABLED 必 `ChangeServiceConfig` 翻回按需启动；
  uninstall 落回滚标记、显式 install 清标记，self-heal 见标记退出——回滚
  与自愈不再互相打架；
- LogConf 启动资源补写（2026-08-31 同日）：服务解禁后设备转 Code 10——
  根枚举实例没资源。注册表直改写完 Service 即「已配置」（ConfigFlags=0），
  PnP 跳过 INF，`wdma_ctl.inf` 的 LogConfigOverride 永不应用；向导能响正
  是走了完整 INF。现版对 `Root\` 下缺资源的已绑定实例补写 116 字节
  REG_RESOURCE_LIST（端口 220-22F/330-331/388-38B、IRQ 5 边沿、DMA 1+5，
  与 v86 sb16.js 硬编码一致），BootConfig/ForcedConfig/AllocConfig 三值
  同内容；walk 增 `root_nologconf` 出参，早退/自愈静默条件都算上它；
- 血泪教训（2026-08-30 真机）：mlog 的 msg 缓冲曾只有 600 字节，装不下
  wvsprintfA 上限 1024 的 `%s` 长转储，agent 开机即崩（「遇到问题需要
  关闭」）。msg/line 缓冲必须 ≥ wvsprintfA 上限，mouse/audio 两模块同改。

## Aero Snap（v4 起，登录会话身份专属）

ivm-agent v4 在登录常驻实例（持有会话互斥 `InstantVmClipboardBridge` 的
那个进程）顺带启动窗口吸附线程（源码 `../ivm-agent/ivm-aero-snap.c`）：

- 行为 = Win7 Aero Snap 平价：标题栏拖到屏幕左/右缘贴半屏、顶边最大化、
  拖离恢复原尺寸（吸附链与 Win7 一致）、Win+方向键（左/右半屏、上最大化、
  下还原→最小化）；
- 服务身份不跑（交互增强一律跟桥走）；v4 时 COM1 协议零变化，v5 新增
  SNAP_EDGE（0x14）触发距离帧——0x13 开关帧与 v1/v2/v3 帧全部原样；
- 边缘触发距离宿主可配（v5）：设置「体验增强 → 窗口吸附 → 吸附触发距离」
  经 SNAP_EDGE 帧实时下发，客机 clamp 2..64、默认 12（与宿主
  `VM_SNAP_EDGE_PX_DEFAULT` 同步）；旧宿主不下发时用客机默认值；
- 技术要点与边界（WH_MOUSE_LL 免注入、跨进程 NCHITTEST 带
  SMTO_ABORTIFHUNG 超时、吸附表静态 16 项不用 SetProp、预览窗为半透明
  分层单窗、不做毛玻璃实时缩略图——XP 无合成器、XP 最大化 8px 越界用
  rcNormalPosition 绕开）见模块文件头注释；
- 升级注意：旧版 agent 进程还持着会话互斥时，新 exe 登录实例会单实例
  退场，先结束旧 `ivm-agent.exe`（或重启 XP）再登录。
