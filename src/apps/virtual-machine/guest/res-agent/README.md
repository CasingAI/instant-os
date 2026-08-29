# res-agent —— COM1 遥控代理 + 合并入口（ivm-agent）

本目录的 `res-agent.c` 现在承担两件事：COM1 遥控/分辨率对齐的全部逻辑，
以及 ivm-agent.exe 的合并入口 `ivm_agent_entry`（与 `../clipboard-bridge/`、
`../ivm-agent/` 合编，见 `../README.md`）。

Windows XP（32 位）里的常驻小工具：串口（COM1，8N1）收宿主广播的目标
分辨率 `(w<<16)|h` 变化后，枚举显示模式并用 `ChangeDisplaySettingsExA` 切换；
v2/v3 协议扩展（PING/EXEC/EXEC_R/CLICK/SHUTDOWN/REBOOT/SHM_QUERY）见
`guest-agent.spec.md`。协议与整体设计见 instant-app 仓库
`todo/vm-resolution-auto-align/00-overview.md`。

## 构建

```bash
brew install zig        # 一次性
make                    # 或 scripts/build-ivm-agent.sh
```

产物统一落到 `../out`（`src/apps/virtual-machine/guest/out/`，客机交付物目录）：
`ivm-agent.exe` 为 PE32 i386、GUI 子系统（开机自启不闪控制台）。
产物不进 git（见 `out/.gitignore`）。

## Emacs 闭环

- `c-mode` 打开 `res-agent.c`，`M-x eglot`（clangd）补全 Win32 API。
- `M-x compile` → `make -C src/apps/virtual-machine/guest/res-agent`。
- 调试：EXE 在 XP 里没有控制台，日志走 `OutputDebugStringA`，
  XP 里用 DebugView，或命令行重定向 `ivm-agent.exe > log.txt 2>&1`（需临时改控制台子系统）。

## 文件

| 文件 | 作用 |
|---|---|
| `res-agent.c` | 全部逻辑：轮询 + 模式枚举 + 切换 + 日志 |
| `Makefile` | zig cc 一条命令 |
| `../ivm-agent/ivm-agent-binary.test.ts` | 产物校验单测（PE 头 / 导入表 / 体积 / 可重现） |
| `guest-agent.spec.md` | 部署规格：EXE 位置、自启注册表键值 |
| `res-agent-install.reg.source` | 注册表脚本模板（复制为 `.reg` 后照抄执行） |

## 行为约定

- 端口值 `0` = 宿主未提供目标，保持现状。
- 目标超出 `2560×1600`（v86 硬上限）或客机模式表没有的模式：拒绝并保持现状。
- 值没变化不重排；轮询间隔 250ms（低频信令，见 00 §7）。
