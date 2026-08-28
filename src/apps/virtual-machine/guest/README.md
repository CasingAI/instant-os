# guest —— XP 客机侧组件

这个目录存放所有需要「拷进 XP 虚拟机」的客机侧组件的源码。

**给你（操作虚拟机的人）的约定：所有构建出来要拷进 XP 的文件，统一放在
[`out/`](./out/) 文件夹里。要拿什么进虚拟机，只看这一个目录就够了，
不用去各处源码目录里翻。**

## out/ 里的交付物（拷进 XP 就拿这些）

| 文件 | 是干什么的 | 放到 XP 哪里 |
|---|---|---|
| `res-agent.exe` | COM1 遥控代理：响应宿主的 PING / EXEC（执行命令）/ CLICK（点击）/ SHUTDOWN / REBOOT | 建议 `C:\Tools\res-agent.exe` |
| `install-agent-v2.bat` | **推荐安装方式**：右键管理员运行，一键删旧 Run 键 + 拷 exe + 注册 XP 服务（开机自启免登录） | 和 `res-agent.exe` 放同一目录，双击运行 |
| `install.reg` | 旧安装方式（HKCU Run 开机自启，需登录才起）；不推荐，仅兼容保留 | 双击导入即可 |
| `boxvideo.sys` + `vidmini.inf` | 显卡驱动（boxvnt，分辨率自动对齐用） | 设备管理器装驱动，见 `boxvnt/README.md` |

> `out/` 里如出现 `.pdb`、`triage*.bat`、`boxvideo-min*.sys` 等其他文件，
> 是调试用的附属产物，**不用拷进虚拟机**。

## 怎么构建 / 更新 out/

```sh
# 一键把 5 个交付物备齐（缺哪个补哪个，已存在的不重复构建）
sh scripts/collect-guest-files.sh

# 或者单独构建
sh scripts/build-res-agent.sh     # res-agent.exe → out/
sh scripts/build-boxvnt.sh        # boxvideo.sys + vidmini.inf → out/
```

改了 `res-agent/res-agent.c` 之后：重新跑构建脚本，把新的 `res-agent.exe`
重新拷进 XP 覆盖旧的，然后重启虚拟机里的 agent（或直接重启 XP）。

`out/` 里的产物不进 git（见 `out/.gitignore`），换机器克隆后先跑一次
`collect-guest-files.sh` 即可。

## 源码与文档在哪

| 目录 | 内容 |
|---|---|
| `res-agent/` | 遥控代理源码；协议与安装说明见 `res-agent/guest-agent.spec.md` |
| `boxvnt/` | 显卡驱动源码；见 `boxvnt/README.md` |
