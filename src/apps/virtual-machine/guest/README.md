# guest —— XP 客机侧组件

这个目录存放所有需要「拷进 XP 虚拟机」的客机侧组件的源码。

**给你（操作虚拟机的人）的约定：所有构建出来要拷进 XP 的文件，统一放在
[`out/`](./out/) 文件夹里。要拿什么进虚拟机，只看这一个目录就够了，
不用去各处源码目录里翻。**

## out/ 里的交付物（拷进 XP 就拿这些）

| 文件 | 是干什么的 | 放到 XP 哪里 |
|---|---|---|
| `ivm-agent.exe` | 客机全家桶（一个 exe 多重身份）：服务身份跑 COM1 遥控代理（PING / EXEC / EXEC_R（带退出码执行）/ SHM_QUERY / CLICK / SHUTDOWN / REBOOT）+ 分辨率自动对齐；登录身份跑 OLE 剪贴板桥（文本 + 虚拟文件双向互拷）+ Aero Snap 窗口吸附（见下文「窗口吸附」）；`ivm-agent.exe /mouse-install` 给 VMware 鼠标驱动做注册；`/audio-install` 把 XP 内置的 SB16 声卡驱动绑上（客机无声的解药，见下文「声音」）；`/mouse-check`、`/audio-check` 只读体检；两个常驻身份每次启动还会自愈补挂鼠标与声卡驱动 | 由安装脚本放进 `C:\Tools\ivm-agent.exe` |
| `ivm-shm.sys` | 共享内存信箱内核驱动：分配 64KB 连续物理内存供宿主（v86 DMA）与客机直连，剪贴板/文件通道的数据面底座 | 由安装脚本放进 `C:\Windows\System32\drivers\` |
| `vmmouse.sys` + `vmmouse.inf` + `vmmouse.cat` | VMware 绝对坐标鼠标驱动 12.4.0.2（vendor 二进制，见 `vmmouse/README.md`）：装好后客机光标 1:1 跟随宿主光标 | 由安装脚本放进 `C:\Windows\System32\drivers\` 并注册 |
| `install-agent-v2.bat` | **推荐安装方式**：右键管理员运行，一键装全家桶（agent 服务 + 信箱驱动 + 登录自启 + vmmouse 鼠标驱动 + SB16 声卡驱动；会自动清掉旧的 res-agent.exe / clipboard-bridge.exe 旧装） | 和 exe/sys 放同一目录，双击运行 |
| `check-mouse.bat` | vmmouse 过滤驱动诊断：双击弹报告窗（驱动文件 / 服务 / 每个 PS/2 鼠标实例的过滤链），同文落 `C:\Tools\mouse-install.log`；`0=已挂 1=未挂 2=文件/服务缺失` | 和 exe 放同一目录，双击运行 |
| `install.reg` | 旧安装方式（仅 HKCU Run 自启；无驱动无剪贴板）；不推荐，仅兼容保留 | 双击导入即可 |
| `boxvideo.sys` + `vidmini.inf` | 显卡驱动（boxvnt，分辨率自动对齐用） | 设备管理器装驱动，见 `boxvnt/README.md` |

> `out/` 里如出现 `.pdb`、`triage*.bat`、`boxvideo-min*.sys` 等其他文件，
> 是调试用的附属产物，**不用拷进虚拟机**。

## 声音：SB16 声卡驱动自动安装

v86 模拟的是一张标准 Sound Blaster 16（ISA PnP，IRQ 5 / DMA 1、5 / 端口
0x220）。XP 自带它的 WDM 驱动（`ctlsb16.sys`，inbox 驱动，INF 为
`wdma_ctl.inf`），但在 v86 下 XP 的自动安装经常不触发，设备管理器里留下
黄叹号「多媒体音频控制器」——这正是客机无声的根源（v86 官方文档因此写了
手动安装步骤）。

`ivm-agent.exe /audio-install`（安装脚本第 8 步会调；两个常驻身份每次启动
也会自愈补装）自动把这层补上，全程零弹窗：

1. 在注册表里找硬件 ID 为 `*CTL00xx`（SB16 系）且还没绑驱动的设备实例；
   **一个实例都没有是 v86 的常态**（v86 不模拟 ISA PnP，设备管理器里连
   黄叹号都没有）——显式跑 `/audio-install` 时会自建一个根枚举设备实例
   （`Enum\Root\*CTL0031\0000`，与 v86 官方文档「添加硬件向导 → 手动从
   列表选 Sound Blaster 16 WDM」的产物同构）；**开机自愈只绑定已存在的
   实例，绝不自建设备**；
2. `ctlsb16.sys` 不在位就**就地提取**（驱动是 XP 内置的，仓库不 vendor
   微软文件）：`Driver Cache\i386` 的 cab（sp3 / sp2 / driver.cab）→ 已
   挂载 XP 光盘的 `I386\CTLSB16.SY_`（`expand` 解开）→
   `C:\Tools\ctlsb16.sys` 人工放置（bat 第 4 步会把脚本同目录的
   `ctlsb16.sys` 代放到这里）；
3. 注册 `ctlsb16` 内核服务，给实例直写 `Service` / `Class` / `ClassGUID`
   并清 `ConfigFlags`（注册表直改，无向导无签名问题），重启一次设备重新
   枚举后生效——任务栏出现音量图标。

退出码：`0`=已装/新装成功；`1`=注册表里没有 SB16 设备实例且（显式安装时）
自建失败（看 `C:\Tools\audio-install.log` 里记录的全部硬件 ID）；`2`=驱动
文件提取失败/注册表操作失败（挂上 XP 光盘重开机，或把 `ctlsb16.sys` 放到
脚本同目录再跑一遍 bat）。诊断：双击跑 `ivm-agent.exe /audio-check`（弹
报告窗）。**回滚**：`ivm-agent.exe /audio-uninstall` 删掉自建设备实例并
禁用 ctlsb16 服务，重启生效。首次部署（2026-08-30 之前）的版本在「无实
例」场景会因日志缓冲溢出崩掉 agent（弹「遇到问题需要关闭」）——换新 exe
即可。

> 血泪教训（2026-08-30）：首版把「自建设备实例」放进了每次开机的自愈路
> 径，同一次软重启后 XP 鼠标彻底不动（机制未完全定罪，同批还撞上 v86 软
> 重启不清绝对鼠标状态的缺陷）。现版本自愈只做幂等补写，建设备只在显式
> `/audio-install`；给系统造新设备的写操作永远不要放进自动路径。

已知限制：装好驱动只解决「无声」；XP 上 SB16 播放尾段偶发循环是 v86 侧
模拟时序问题（`todo/vm-windows-xp-sb16-audio-loop.md`），与本驱动无关。

## 窗口吸附（Aero Snap）

ivm-agent v4 起，登录身份的常驻实例顺带提供 Win7 Aero Snap 的 XP 复刻
（源码 `ivm-agent/ivm-aero-snap.c`，服务身份不跑，COM1 协议零变化）：

- 拖标题栏到屏幕**左/右边缘** → 贴半屏；拖到**顶边** → 最大化；
- 拖动已吸附的窗口 → 恢复吸附前尺寸跟随光标；拖离后随手放下，链条结束
  （与 Win7 一致）；
- **Win+方向键**：左/右半屏、上最大化、下还原→最小化（宿主若截获 Win 键
  则键盘路径失效，鼠标路径不受影响）；
- 松手前有白色实线边框预览（内部完全透明）——XP 时代吸附工具的主流画法，
  有意不用毛玻璃半透明整块（XP 没有 DWM）；
- **开关**：宿主「虚拟机设置 → 体验增强 → 窗口吸附」，运行中经 OP_SNAP 帧
  实时下发（挂/卸钩子在客机完成），未运行只存设置；
- 只吸有标题栏、可改大小/可最大化的普通窗口；工具窗与本 agent 自己的
  窗口不参与；
- 升级注意：旧版 agent 还持着会话互斥时，新 exe 的登录实例会单实例退场，
  先结束旧 `ivm-agent.exe`（或重启 XP）再用新功能。

## 怎么构建 / 更新 out/

```sh
# 一键把全部交付物备齐（缺哪个补哪个，已存在的不重复构建）
sh scripts/collect-guest-files.sh

# 或者单独构建
sh scripts/build-ivm-agent.sh          # ivm-agent.exe → out/（合编五个 .c）
sh scripts/build-ivm-shm.sh            # ivm-shm.sys → out/（需要 Open Watcom，见脚本头注释）
sh scripts/build-boxvnt.sh             # boxvideo.sys + vidmini.inf → out/
```

改了任一客机源码之后：重新跑对应构建脚本，把新产物拷进 XP 覆盖旧的，
然后跑一遍 `install-agent-v2.bat`（或重启 XP）。

`out/` 里的产物不进 git（见 `out/.gitignore`），换机器克隆后先跑一次
`collect-guest-files.sh` 即可。

## 源码与文档在哪

| 目录 | 内容 |
|---|---|
| `res-agent/` | COM1 遥控代理 + 合并入口（`ivm_agent_entry`）源码；协议与安装说明见 `res-agent/guest-agent.spec.md` |
| `clipboard-bridge/` | 剪贴板桥源码（信箱布局与 ivm-shm、Instant-virtual-machine 的 ivm-shm.ts 三方一致） |
| `ivm-agent/` | `/mouse-install`、`/audio-install`（注册）与 `/mouse-check`、`/audio-check`（诊断）驱动助手源码；Aero Snap 吸附（`ivm-aero-snap.c`）；`ivm-agent-binary.test.ts` 产物校验 |
| `ivm-shm/` | 共享内存信箱驱动源码（信箱布局见文件头注释） |
| `vmmouse/` | VMware 鼠标驱动 vendor 二进制 + 说明；见 `vmmouse/README.md` |
| `boxvnt/` | 显卡驱动源码；见 `boxvnt/README.md` |
