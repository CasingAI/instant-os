# guest —— XP 客机侧组件

这个目录存放所有需要「拷进 XP 虚拟机」的客机侧组件的源码。

**给你（操作虚拟机的人）的约定：所有构建出来要拷进 XP 的文件，统一放在
[`out/`](./out/) 文件夹里。要拿什么进虚拟机，只看这一个目录就够了，
不用去各处源码目录里翻。**

## out/ 里的交付物（拷进 XP 就拿这些）

| 文件 | 是干什么的 | 放到 XP 哪里 |
|---|---|---|
| `res-agent.exe` | COM1 遥控代理：响应宿主的 PING / EXEC / EXEC_R（带退出码执行）/ SHM_QUERY / CLICK / SHUTDOWN / REBOOT，负责共享内存信箱的握手寻址 | 建议 `C:\Tools\res-agent.exe` |
| `ivm-shm.sys` | 共享内存信箱内核驱动：分配 64KB 连续物理内存供宿主（v86 DMA）与客机直连，剪贴板通道的数据面底座 | 由安装脚本放进 `C:\Windows\System32\drivers\` |
| `clipboard-bridge.exe` | 剪贴板桥：XP 系统剪贴板 ↔ 信箱双向搬运（CF_UNICODETEXT，150ms 轮询，自防回环） | 建议 `C:\Tools\clipboard-bridge.exe` |
| `install-agent-v2.bat` | **推荐安装方式**：右键管理员运行，一键装全家桶（agent 服务 + 信箱驱动 + 剪贴板桥自启） | 和 exe/sys 放同一目录，双击运行 |
| `install.reg` | 旧安装方式（仅 HKCU Run 的 res-agent 自启；无驱动无剪贴板）；不推荐，仅兼容保留 | 双击导入即可 |
| `boxvideo.sys` + `vidmini.inf` | 显卡驱动（boxvnt，分辨率自动对齐用） | 设备管理器装驱动，见 `boxvnt/README.md` |

> `out/` 里如出现 `.pdb`、`triage*.bat`、`boxvideo-min*.sys` 等其他文件，
> 是调试用的附属产物，**不用拷进虚拟机**。

## 怎么构建 / 更新 out/

```sh
# 一键把全部交付物备齐（缺哪个补哪个，已存在的不重复构建）
sh scripts/collect-guest-files.sh

# 或者单独构建
sh scripts/build-res-agent.sh          # res-agent.exe → out/
sh scripts/build-ivm-shm.sh            # ivm-shm.sys → out/（需要 Open Watcom，见脚本头注释）
sh scripts/build-clipboard-bridge.sh   # clipboard-bridge.exe → out/
sh scripts/build-boxvnt.sh             # boxvideo.sys + vidmini.inf → out/
```

改了任一客机源码之后：重新跑对应构建脚本，把新产物拷进 XP 覆盖旧的，
然后跑一遍 `install-agent-v2.bat`（或重启 XP）。

`out/` 里的产物不进 git（见 `out/.gitignore`），换机器克隆后先跑一次
`collect-guest-files.sh` 即可。

## 源码与文档在哪

| 目录 | 内容 |
|---|---|
| `res-agent/` | 遥控代理源码；协议与安装说明见 `res-agent/guest-agent.spec.md` |
| `ivm-shm/` | 共享内存信箱驱动源码（信箱布局见文件头注释） |
| `clipboard-bridge/` | 剪贴板桥源码（信箱布局与 ivm-shm、Instant-virtual-machine 的 ivm-shm.ts 三方一致） |
| `boxvnt/` | 显卡驱动源码；见 `boxvnt/README.md` |
