# guest-agent 部署规格（第三期照抄）

> 本文件是 `guest-agent.spec` 的等价物：定义 res-agent.exe 在客机里的
> 安装位置、启动项、注册表键值、v2 操控协议。部署步骤逐字照抄即可。

## 产物

| 项 | 值 |
|---|---|
| 文件 | `res-agent.exe`（构建：`make` 或 `scripts/build-res-agent.sh`，产物统一落 `guest/out/`） |
| 架构 | PE32 i386，GUI 子系统，OS/Subsystem 版本 5.01 |
| 导入表 | 仅 kernel32.dll / user32.dll / advapi32.dll（XP 裸机自带） |
| 体积 | < 200 KB（实测 ~9.7 KB） |
| 运行形态 | 双击 / HKCU Run = 交互进程；`sc create` 注册后由 SCM 启动 = XP 服务（免登录） |

## 客机内位置

```
C:\Tools\res-agent.exe
```

（`C:\Tools` 不存在就先建。放别的目录也行，但下面的服务/注册表路径要跟着改。）

## 开机自启（推荐：XP 服务，免登录即起）

todo/vm-remote-control §7 预防层——服务形态开机即起，不依赖用户登录桌面：

```bat
sc create InstantVmResAgent type= own start= auto binPath= "C:\Tools\res-agent.exe"
sc description InstantVmResAgent "Instant VM guest agent (resolution + remote control)"
```

要点：

- `start= auto`（= StartType 2，开机自动启动）。`sc` 的参数格式是
  `key= value`——等号后必须有空格，漏了会静默建错；
- exe 内已实现 `StartServiceCtrlDispatcherA`：SCM 启动走服务入口
  （报告 RUNNING 后进主循环），非 SCM 启动自动落回交互模式，同一 exe 两用；
- 服务入口的单实例冲突直接报告停止（session 0 弹框会挂死 SCM），
  交互入口保留弹框提示；弹框内容带版本号与构建日期
  （`res-agent is already running. version 2, built <时间戳>`）——
  双击 exe 即可确认 XP 里跑的是哪次构建；
- 移除：`sc delete InstantVmResAgent`。

### 旧形态：HKCU Run（需登录，保留兼容）

注册表键：

```
HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run
  "ResAgent" = "C:\Tools\res-agent.exe"
```

等价的 reg 文件（存为 `res-agent-install.reg`，双击导入）：

```reg
Windows Registry Editor Version 5.00

[HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run]
"ResAgent"="C:\\Tools\\res-agent.exe"
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
opcode，宿主经 `__vm.serialSend` 下发（resolution-serial 泵每秒的分辨率帧
与 v2 命令帧在同一字节流上交错，逐字节+校验和解析天然免疫）：

| len | 命令 | payload | 行为 / 回执（`[IVM]…\r\n`，COM1 回传） |
|---|---|---|---|
| 0x04 | 分辨率（v1） | `(w<<16)\|h` LE | 就近吸附切换显示模式 |
| 0x01 | PING（0x01） | — | 回 `[IVM]PONG=<tick> ver=2 built=<YYYYMMDD-HHMMSS>`（构建时间戳由构建脚本注入） |
| 0x01 | SHUTDOWN（0x02） | — | 回 `[IVM]SDWN=1` 后 `ExitWindowsEx(EWX_SHUTDOWN\|EWX_POWEROFF\|EWX_FORCE)` |
| 0x01 | REBOOT（0x03） | — | 回 `[IVM]RBOOT=1` 后 `ExitWindowsEx(EWX_REBOOT\|EWX_FORCE)` |
| N | EXEC（0x10） | `0x10 <cmdline\0>`（ASCII，≤198 字符） | `CreateProcessA`（CREATE_NO_WINDOW）；回 `[IVM]EXEC=1` 或 `[IVM]EXEC=0 err=<GLE>` |
| 0x05 | CLICK（0x20） | `0x20 <x:u16><y:u16>` LE | `SetCursorPos` + `mouse_event` 左键单击；回 `[IVM]CLICK=1` |
| 0x05 | DBLCLICK（0x21） | `0x21 <x:u16><y:u16>` LE | 同上双击（两次单击间隔 60ms）；回 `[IVM]DBLCLK=1` |

关机路径：`ExitWindowsEx` 触发客机 ACPI 切电 → 宿主 `guest-poweroff`
watcher → `destroyCurrent`（stop → 写回落盘 → 销毁）——即「软关机」，
宿主 `scripts/vm-safe-reload.sh` 依赖这条链路，禁止直接断电 reload。

## COM1 已知坑（§8.8，勿再踩）

1. **串口初始是 7 数据位**：必须显式 `BuildCommDCBA("9600,n,8,1")` +
   `SetCommState`（DCB 往返无效），且显式 `SetCommTimeouts`
   （默认无限阻塞，读循环会卡死）；
2. **单实例**：`CreateMutexA("InstantVmResAgent")`，第二实例退出。

## 常用 EXEC 配方

```text
# 根治蓝屏秒重启（XP 默认 AutoReboot=1——「只能手机慢动作拍」的根源）
reg add "HKLM\SYSTEM\CurrentControlSet\Control\CrashControl" /v AutoReboot /t REG_DWORD /d 0 /f

# 探活产物（宿主靠 PONG 判断 agent 存活，不需要这个；留作 EXEC 链路自检）
cmd /c echo alive %DATE% %TIME% > C:\Tools\agent-alive.txt

# agent 自愈（§7 自救层）：重拷新版 exe 后重启服务
sc stop InstantVmResAgent & sc start InstantVmResAgent
```
