# res-agent —— 分辨率自动对齐客机代理

Windows XP（32 位）里的常驻小工具：轮询 io 端口 `0xE000`，读到宿主下发的目标
分辨率 `(w<<16)|h` 变化后，枚举显示模式并用 `ChangeDisplaySettingsExA` 切换。
协议与整体设计见 instant-app 仓库 `todo/vm-resolution-auto-align/00-overview.md`；
灌进镜像的完整步骤见仓库根 `docs/guest-installation.md`（照抄即可）。

## 构建

```bash
brew install zig        # 一次性
make                    # 或 scripts/build-res-agent.sh
```

产物统一落到 `../out`（`src/apps/virtual-machine/guest/out/`，客机交付物目录）：
`res-agent.exe` 为 PE32 i386、GUI 子系统（开机自启不闪控制台）。
产物不进 git（见 `out/.gitignore`）。

## Emacs 闭环

- `c-mode` 打开 `res-agent.c`，`M-x eglot`（clangd）补全 Win32 API。
- `M-x compile` → `make -C src/apps/virtual-machine/guest/res-agent`。
- 调试：EXE 在 XP 里没有控制台，日志走 `OutputDebugStringA`，
  XP 里用 DebugView，或命令行重定向 `res-agent.exe > log.txt 2>&1`（需临时改控制台子系统）。

## 文件

| 文件 | 作用 |
|---|---|
| `res-agent.c` | 全部逻辑：轮询 + 模式枚举 + 切换 + 日志 |
| `Makefile` | zig cc 一条命令 |
| `res-agent-binary.test.ts` | 产物校验单测（PE 头 / 导入表 / 体积 / 可重现） |
| `guest-agent.spec.md` | 部署规格：EXE 位置、自启注册表键值 |
| `res-agent-install.reg.source` | 注册表脚本模板（复制为 `.reg` 后照抄执行） |

## 行为约定

- 端口值 `0` = 宿主未提供目标，保持现状。
- 目标超出 `2560×1600`（v86 硬上限）或客机模式表没有的模式：拒绝并保持现状。
- 值没变化不重排；轮询间隔 250ms（低频信令，见 00 §7）。
