# guest —— XP 客机侧组件

这个目录存放所有需要「拷进 XP 虚拟机」的客机侧组件的源码。

**给你（操作虚拟机的人）的约定：所有构建出来要拷进 XP 的文件，统一放在
[`out/`](./out/) 文件夹里。要拿什么进虚拟机，只看这一个目录就够了，
不用去各处源码目录里翻。**

## out/ 里的交付物（拷进 XP 就拿这些）

| 文件 | 是干什么的 | 放到 XP 哪里 |
|---|---|---|
| `ivm-agent.exe` | 客机全家桶（一个 exe 三重身份）：服务身份跑 COM1 遥控代理（PING / EXEC / EXEC_R（带退出码执行）/ SHM_QUERY / CLICK / SHUTDOWN / REBOOT）+ 分辨率自动对齐；登录身份跑 OLE 剪贴板桥（文本 + 虚拟文件双向互拷）；`ivm-agent.exe /mouse-install` 给 VMware 鼠标驱动做注册 | 由安装脚本放进 `C:\Tools\ivm-agent.exe` |
| `ivm-shm.sys` | 共享内存信箱内核驱动：分配 64KB 连续物理内存供宿主（v86 DMA）与客机直连，剪贴板/文件通道的数据面底座 | 由安装脚本放进 `C:\Windows\System32\drivers\` |
| `vmmouse.sys` + `vmmouse.inf` + `vmmouse.cat` | VMware 绝对坐标鼠标驱动 12.4.0.2（vendor 二进制，见 `vmmouse/README.md`）：装好后客机光标 1:1 跟随宿主光标 | 由安装脚本放进 `C:\Windows\System32\drivers\` 并注册 |
| `install-agent-v2.bat` | **推荐安装方式**：右键管理员运行，一键装全家桶（agent 服务 + 信箱驱动 + 登录自启 + vmmouse 鼠标驱动；会自动清掉旧的 res-agent.exe / clipboard-bridge.exe 旧装） | 和 exe/sys 放同一目录，双击运行 |
| `install.reg` | 旧安装方式（仅 HKCU Run 自启；无驱动无剪贴板）；不推荐，仅兼容保留 | 双击导入即可 |
| `boxvideo.sys` + `vidmini.inf` | 显卡驱动（boxvnt，分辨率自动对齐用） | 设备管理器装驱动，见 `boxvnt/README.md` |

> `out/` 里如出现 `.pdb`、`triage*.bat`、`boxvideo-min*.sys` 等其他文件，
> 是调试用的附属产物，**不用拷进虚拟机**。

## 怎么构建 / 更新 out/

```sh
# 一键把全部交付物备齐（缺哪个补哪个，已存在的不重复构建）
sh scripts/collect-guest-files.sh

# 或者单独构建
sh scripts/build-ivm-agent.sh          # ivm-agent.exe → out/（合编三个 .c）
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
| `ivm-agent/` | `/mouse-install` 鼠标驱动安装助手源码 + `ivm-agent-binary.test.ts` 产物校验 |
| `ivm-shm/` | 共享内存信箱驱动源码（信箱布局见文件头注释） |
| `vmmouse/` | VMware 鼠标驱动 vendor 二进制 + 说明；见 `vmmouse/README.md` |
| `boxvnt/` | 显卡驱动源码；见 `boxvnt/README.md` |
