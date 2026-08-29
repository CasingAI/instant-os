# vmmouse —— VMware 绝对坐标鼠标驱动（vendored 二进制）

来源：`/Users/john/Downloads/Drivers/MOUSE/WIN2K/32BIT`（VMware Pointing
Device Driver 12.4.0.2，2007，VMware 官方发布）。无源码，二进制直接入 git。

| 文件 | 作用 |
| --- | --- |
| `VMMOUSE.SYS` | 32 位内核驱动：作为 PS/2 鼠标栈的上层过滤驱动，向 VMware backdoor（io 端口 0x5658）要绝对坐标。v86 已实现该 backdoor，驱动生效后客机光标 1:1 跟随宿主光标（指针「自动」模式自动从独占切到跟随）。 |
| `VMMOUSE.INF` | 安装描述（本仓库安装脚本走注册表直改，不跑 INF 向导；文件保留供手动安装/参考）。 |
| `VMMOUSE.CAT` | 官方签名目录（注册表直改方式不校验，保留备用）。 |

安装：由 `install-agent-v2.bat` 完成——拷 `vmmouse.sys` 到
`C:\Windows\System32\drivers\`，再调 `ivm-agent.exe /mouse-install` 注册
服务并把 `vmmouse` 追加进 PS/2 鼠标设备的 UpperFilters，重启后生效。
