# guest-agent 部署规格（第三期照抄）

> 本文件是 `guest-agent.spec` 的等价物：定义 res-agent.exe 在客机里的
> 安装位置、启动项、注册表键值。逐字照抄 `docs/guest-installation.md`
> 即可完成部署。

## 产物

| 项 | 值 |
|---|---|
| 文件 | `res-agent.exe`（构建：`make` 或 `scripts/build-res-agent.sh`） |
| 架构 | PE32 i386，GUI 子系统 |
| 导入表 | 仅 kernel32.dll / user32.dll / gdi32.dll / msvcrt.dll |
| 体积 | < 200 KB |

## 客机内位置

```
C:\Tools\res-agent.exe
```

（`C:\Tools` 不存在就先建。放别的目录也行，但下面的注册表路径要跟着改。）

## 开机自启（HKCU Run）

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

## 端口协议

| 项 | 值 |
|---|---|
| io 端口 | `0xE000`（32 位 IN） |
| 编码 | `(width << 16) \| height` |
| `0` | 无目标，保持现状 |
| 越界 | 宽 > 2560 或高 > 1600 → 拒绝（溢出守卫） |
| 轮询间隔 | 250 ms |
