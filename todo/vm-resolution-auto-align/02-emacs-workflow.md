# 02 · Emacs 闭环开发方案（推荐）

> 建立时间：2026-08-26
> 定位：把 `01-channel-mvp.md` 第 3 级（原生 32 位 XP 小工具）的「写 → 编译 → 调试 → 灌进镜像」完整动作，全部收在 Emacs 里完成。
> 不在仓库根加 `.dir-locals.el`，本文件即文档。

## 0. 一句话结论

可以。zig + 手写 Makefile + eglot(clangd)，在 Emacs 里编、查、跑、和宿主侧调试全部自洽。XP 那边因为在浏览器（v86）里跑，「把 EXE 灌进镜像」这一步是宿主/分发问题，不是 Emacs 闭环内的卡点。

## 1. 选型理由（已收敛）

| 决策点 | 选 | 理由 |
|---|---|---|
| 交叉编译器 | **zig cc** | `zig cc -target x86-windows-msvc` 一条命令走通；自带 MSVCRT（XP 友好）；不依赖 brew 装额外工具链；与 00 号文档 §7 提到的「zig 一条命令交叉编译」一致 |
| 构建系统 | **手写 Makefile** | XP 代理就一个 C 文件 + Win32 链接；CMake 是给 v86 上游那种大项目用的；just 不在 Emacs 主流里 |
| LSP | **eglot + clangd** | Emacs 29 内置 eglot，零额外包；Makefile 项目下 eglot 行为稳定，不用生成 `compile_commands.json` 也能用（见 §4） |
| 目录布局 | `src/apps/virtual-machine/guest/res-agent/` | 与宿主侧 `virtual-machine-*.ts` 平级；产物走 `.gitignore`（符合 00 号文档 §7 镜像资产不进 git 的约定） |
| 调试链 | zig → EXE → 灌镜像 → v86 浏览器跑 | 跟 v86 自身的开发方式一致；「XP 里调试」只能靠 print + log，没有真调试器（v86 不导出 XP 内 GDB stub） |

明确不选：
- ~~CMake~~ —— 单文件代理用 Makefile 即可；CMake 配置成本超过收益。
- ~~lsp-mode~~ —— eglot 在 Emacs 29+ 已成熟，且不需要 dash/lsp-ui 那堆周边。
- ~~llvm-mingw~~ —— zig 走 MSVCRT 已能编；如果未来要纯静态链再补，不预先加重。
- ~~`.dir-locals.el`~~ —— 仓库目前无 Emacs 配置；按你确认不污染主项目；本文件即文档。

## 2. 目录与文件

```
src/apps/virtual-machine/guest/
├── res-agent/
│   ├── .gitignore          # 忽略 build/ 与产物 *.exe
│   ├── Makefile            # zig cc 一行命令
│   ├── res-agent.c         # 单一 C 源，< 200 行
│   └── README.md           # Emacs 起步、镜像灌入步骤
└── (未来) dos-test/        # MVP 第 2 级 FreeDOS 软盘的 NASM 轮询工具
```

`.gitignore` 内容（仅这一个子目录的范围）：

```
build/
*.exe
*.pdb
*.obj
```

`Makefile`（关键三行）：

```make
CC      ?= zig
CFLAGS  ?= -target x86-windows-msvc -O2 -D_WIN32_WINNT=0x0501 -Wall
LDLIBS  ?= -lkernel32 -luser32 -lgdi32

res-agent.exe: res-agent.c
	$(CC) $(CFLAGS) -o $@ $< $(LDLIBS)

.PHONY: clean run
clean:
	rm -f res-agent.exe
```

`README.md` 内容纲要（与 `todo/vm-resolution-auto-align/01-channel-mvp.md` 第 3 级对齐）：

1. 一行安装：`brew install zig`
2. 编译：`make`
3. 灌入镜像（具体路径按 `todo/vm-xp-3d/04-guest-image-and-files.md` 约定）
4. 在 XP 启动项里注册（开机自启）

## 3. Emacs 里的闭环

### 3.1 编辑与跳转

- 主模式：`c-mode`（Emacs 内置）
- 头文件索引：仅 Win32 + C 标准库，不需要 GTAGS/CTags
- 项目搜索：`project-find-file` / `project-find-regexp`（Emacs 内置 project.el，已能识别 git 根）

### 3.2 LSP（eglot + clangd）

需要：

```bash
brew install llvm   # clangd
```

Emacs 配置（写到 `~/.config/emacs/init.el`，**不进仓库**）：

```elisp
(require 'eglot)
(add-hook 'c-mode-hook #'eglot-ensure)
```

行为：
- `res-agent.c` 一打开，eglot 自动拉起 clangd
- 因为 Makefile 简单，eglot 用 `cc` 启发即可识别 `-D_WIN32_WINNT=0x0501`；遇到 include 找不到（Win32 SDK 头），补一个项目级 `.clangd`：

```yaml
# res-agent/.clangd
CompileFlags:
  Add: [-D_WIN32_WINNT=0x0501, -target, x86-windows-msvc]
  Remove: [-m*, -f*]
```

（不强制。绝大多数 Win32 API 在 clangd 默认 SDK 头里都能找到解析；真缺再补。）

### 3.3 flycheck（拼写/语法层）

`eglot` 自带 flymake 已能覆盖；如果习惯 flycheck：

```elisp
(add-hook 'c-mode-hook #'flycheck-mode)
```

### 3.4 编译

`M-x compile` → `make -C src/apps/virtual-machine/guest/res-agent` → 走默认 zig cc。

错误定位：Emacs 直接跳到出错行（`*compilation*` buffer 的 next-error）。

### 3.5 真机/真 XP 调试

v86 在浏览器里跑，**不能挂 GDB stub 到 XP 内核**。所以「XP 里的代理」调试方式：

- 加 `OutputDebugStringA` / `fprintf(stderr, ...)` 输出到 XP 里
- XP 端：命令提示符重定向 `res-agent.exe > log.txt 2>&1`；或启动时挂一个 telnet 串口到宿主看 log
- 宿主端：v86 串口 log 在浏览器控制台

经验上这一步 90% 调通；剩下 10% 靠 `OutputDebugStringA` + v86 串口抓。

### 3.6 提交前自检

`M-x compile` → `make clean && make` → 退出码 0 → 提交。无需额外 CI 配置（客机代理代码小到不需要单独流水线）。

## 4. 跟 `01-channel-mvp.md` 的衔接

按 MVP 三级递进，Emacs 闭环实际触达的级：

| MVP 级别 | Emacs 闭环 | 备注 |
|---|---|---|
| 第 1 级（`debug.exe -i E000`） | 不在 Emacs 内 | 在 XP 控制台里手敲；宿主侧 30 行 `guest-channel-test.ts` 在 `src/apps/virtual-machine/` 下，跟其他 `virtual-machine-*.ts` 一起写 |
| 第 2 级（FreeDOS + NASM） | 半闭环 | NASM 汇编用 `asm-mode`，编 `.img` 走 `nasm -f bin`；可放 `src/apps/virtual-machine/guest/dos-test/` |
| 第 3 级（zig/llvm-mingw 原生 XP 工具） | **完整闭环** | 即本文件第 2、3 节描述 |

**第 1 级通过后，本文件第 2、3 节即开始落地。**

## 5. 风险与回退

| 风险 | 触发条件 | 回退 |
|---|---|---|
| zig 升级后改 `-target` 语义 | zig 0.14+ 偶有 breaking | 锁 `zig 0.13.x`，CI/Makefile 里用 `zig version` 检查 |
| clangd 在 Makefile 项目下不识别 `-D_WIN32_WINNT` | 系统 include 找不到 winsock 等 | 加 `.clangd` 的 `CompileFlags.Add`（见 §3.2） |
| XP 镜像不携带 MSVCRT 路径 | DLL 找不到 | 改 Makefile 加 `-static`（zig cc 支持 `-static`），代价是 EXE 体积变大 |
| 宿主侧 `v86IoFromEmulator()` 路径在 v86 升级中消失 | 00 号文档 §10 风险项 | 走 00 号文档 §8.1 预留的 UART 通道，Emacs 侧零改动（zig/宿主解耦） |

## 6. 执行清单（增量于 `01-channel-mvp.md`）

- [ ] 创建 `src/apps/virtual-machine/guest/res-agent/` 子目录
- [ ] 写 `.gitignore`、`Makefile`、`README.md`（按 §2）
- [ ] 写 `res-agent.c` 骨架（轮询 `0xE000` 32 位 + `ChangeDisplaySettingsEx`，< 200 行）
- [ ] Emacs 内 `M-x compile` 一次跑通
- [ ] 灌入 XP 镜像（路径按 `todo/vm-xp-3d/04-guest-image-and-files.md`）
- [ ] 在 XP 启动项注册，开机自启
- [ ] 完成 `01-channel-mvp.md` §6 结果记录

## 7. 不在本方案范围内

- 宿主侧 `guest-channel-test.ts`（属 00 号文档 §5、01 号文档 §2）
- v86 内部代码改动（被 00 号文档 §4「不改 v86」明确排除）
- 镜像资产（属 00 号文档 §7，不进 git）
