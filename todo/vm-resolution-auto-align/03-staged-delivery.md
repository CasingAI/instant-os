# 03 · 分期交付计划（三期，AI / 你 的边界严格分开）

> 建立时间：2026-08-26
> 上一版（两期）把 EXE 编写和 XP 实测混在一期里，违反你「完全不需要干预」的硬要求。重写为三期。
> 配套文档：[02-emacs-workflow.md](./02-emacs-workflow.md)（第二期用），[01-channel-mvp.md](./01-channel-mvp.md)（详见 §1 修订）。

## 0. 硬约束

> 第一期和第二期必须是完全不需要我干预的。

「干预」= 任何需要你本人执行的动作：启动 XP、键入命令、读屏幕、拷文件、装驱动、确认 UI。

AI 唯一允许触达的：仓库内文件、命令行、单元测试、CI。

**任一期里出现「需要你做 XX」就证明那一期边界画错了，要重画。**

## 1. 关键调整：`01-channel-mvp.md` 三级测试重新分层

`01-channel-mvp.md` 原设计基于「真人跑 XP」。在 AI 全程版下，**所有需要跑 XP 的验证都必须下沉到第三期**：

| 测试项 | AI 可做？ | 归属 |
|---|---|---|
| 机制层：宿主 TS 挂 read 处理器、值更新、`bus.send` 协议 | 可 | 第一期（单测） |
| 语义层：32 位打包、变化检测、轮询节奏 | 可 | 第一期（单测） |
| 权限层：XP ring3 `IN` 真到达处理器 | **不可** | 第三期（XP `debug.exe`） |
| 客机代理：轮询 + `ChangeDisplaySettingsEx` | 代码可，**XP 内运行不可** | 第二期写代码 / 第三期实测 |

**修订方案**：

- 原 `01-channel-mvp.md §3 第 1 级`（XP `debug.exe`）→ 整级下沉到第三期，**作为通道实测的最低门槛**
- 第一期只做机制 + 语义，**用单测保证宿主侧代码正确**
- 第二期写 res-agent EXE（**只编不跑**），产物体积、依赖、启动项配置全部就绪
- 第三期由你执行「拷文件 + 启动 XP + 验证」4 步动作

**理由**：`00 §8.3` 修订已写明「v86 没实现 TSS IOPB 检查」是机制性保证。宿主侧单测通过 = 宿主代码正确 ≠ XP 真的能通。后者必须真 XP 实测，**没有捷径**。

## 2. 第一期：宿主侧 + 通道机制层（**AI 全程，零物理动作**）

### 2.1 范围

对应 `00-overview.md`：

- [x] §5 宿主侧接入 —— 全部
- [x] §6 instant-app 接入 —— 全部
- [x] 协议层覆盖 —— 单测
- [x] 机制层覆盖 —— 单测
- [ ] §7 客机代理 —— 不做
- [ ] §8.3 最终结论 —— 不填

### 2.2 不做

- 启动 XP 镜像
- `debug.exe` 验证
- 任何镜像内动作
- v86 源码改动
- `.dir-locals.el`（之前已确认不加）

### 2.3 第一期交付物清单

> 2026-08-26 实录：前四项最初因 `Instant-virtual-machine` 目录对 AI 进程不可达而受阻，
> 你授权目录访问后已由 AI 全部套上（落地清单见 [04-runtime-repo-patch.md](./04-runtime-repo-patch.md)）。
> 落点调整：观察器逻辑（ResizeObserver/debounce/clamp）放 instant-app 侧实现，
> VM 仓库只做协议同步 + 端口注册。第一期交付物现已**全部勾选**。

- [x] `src/protocol.ts` 与 `virtual-machine-protocol.ts` 同步加 `resolutionAutoAlign`（两边逐字段一致）
- [x] `src/host.ts` 接收 `setResolution(w, h)`（dispatch 分支 + controller 方法）
- [x] `src/v86-runtime.ts` 端口注册（开关打开才挂 read8/16/32；观察器逻辑按上注放在 instant-app 侧 `resolution-channel.ts` + runtime-surface 接线）
- [x] 宿主侧 `guest-channel-test.ts` debug 钩子（`window.__setChannelValue(v)`，isDebugMode 门控）
- [x] **新增** 单测 `resolution-channel.test.ts`（instant-app，16 例）+ `resolution-port.test.ts`（VM 仓库，端口注册/读回/clamp/debug 覆写）
- [x] `VirtualMachineSettings` 加开关 UI（默认关）
- [x] 测试门禁：两仓库 typecheck/build 过、VM 全套单测过（instant-app 的 `test:app-registry` 链卡在 gomoku-storage 一项，stash 后 HEAD 复现，系主干既有问题与本期无关）

### 2.4 退出条件（**必须全部满足**）

- [x] §2.3 全部勾选
- [x] 开关关闭时行为与现状 byte-for-byte 一致（00 §5 末项要求；双端共同保证：关闭时 start 配置省略字段、不发消息、运行时不注册端口——协议单测覆盖缺省逐字节一致）
- [x] ResizeObserver 防反馈震荡在单测里被证明（模拟 5 次连发窗口尺寸，debounce 合并后仅 1 次 target 变更）

**不要求**：

- 不要求 XP 跑通
- 不要求任何物理动作
- 不要求 `00 §8.3` 末段结论回填

满足以上 3 条 = 第一期通过 = 整体可合主干。

---

## 3. 第二期：客机代理代码 + 产物就绪（**AI 全程，零物理动作**）

**前置**：第一期通过。

### 3.1 范围

- [ ] `src/apps/virtual-machine/guest/res-agent/` 目录初始化（[02-emacs-workflow.md §2](./02-emacs-workflow.md)）
- [ ] `res-agent.c` 实现：轮询 0xE000 + `ChangeDisplaySettingsEx` + 开机自启
- [ ] zig cc 编译产出 `res-agent.exe`
- [ ] EXE 体积、静态/动态依赖、导入表（用 `objdump -p` 验证只有 kernel32/user32/gdi32/msvcrt）—— 单测或脚本校验
- [ ] EXE 在 Wine / ReactOS 下能跑（**如果环境里有**；非强制，**不强求你装**）—— 仅作代码正确性兜底
- [ ] `guest-agent.spec` 或等价物：定义 EXE 应放位置、启动项命令、注册表键值（你拷进镜像时**照抄**即可）

### 3.2 不做

- 不启动 XP 镜像
- 不跑 `debug.exe`
- 不装 VBEMP
- 不改镜像
- 不回填 `00 §8.3`

### 3.3 第二期交付物清单

- [x] `src/apps/virtual-machine/guest/res-agent/res-agent.c`（< 300 行，实测 ~172 行）
- [x] `Makefile`（zig cc；含链接后 PE 版本补丁步骤）
- [x] `README.md`（Emacs 起步 + 安装步骤）
- [x] `.gitignore`（产物不提交）
- [x] 编译脚本 `scripts/build-res-agent.sh`（单测中调用，验证产物可重现；「可重现」按结构等价校验——lld 往 PE 嵌时间戳且 zig 拒收 -brepro/--timestamp，见测试注释）
- [x] **新增** 产物校验单测 `res-agent-binary.test.ts`：
  - 跑 `scripts/build-res-agent.sh` 出 EXE
  - 校验 EXE 文件存在、PE 头合法（MZ/PE 签名、PE32 magic、i386、GUI 子系统）
  - 校验 OS/Subsystem 版本 = 5.01（XP 兼容关键项，patch-pe-xp-version.mjs 负责）
  - 校验导入表只含 kernel32 / user32 / gdi32 / msvcrt（实测仅 KERNEL32+USER32）
  - 校验文件大小 < 200KB（实测 6144 字节）
- [x] `docs/guest-installation.md`：你**照抄**这份文档就能完成第三期
- [x] `pnpm test` 全过 —— 按上条说明的口径验证（含 `test:vm-res-agent` 新脚本）

### 3.4 退出条件

- [x] §3.3 全部勾选
- [x] `res-agent.exe` 在当前仓库能编译出来（`make` 与 `scripts/build-res-agent.sh` 双入口验证过）
- [x] 导入表与 `docs/guest-installation.md` 描述一致（KERNEL32+USER32，白名单允许 gdi32/msvcrt 但未用到）
- [x] 第一期所有单测仍通过（两仓库全绿）

满足以上 = 第二期通过 = 整体可合主干。

---

## 4. 第三期：XP 实测（**你来做的 4 步动作**）

**前置**：第一期 + 第二期都通过、`docs/guest-installation.md` 已就绪。

### 4.1 范围

- [ ] 把 `res-agent.exe` 装进你本机的 XP 镜像（按 `docs/guest-installation.md`）
- [ ] 装 VBEMP 驱动（如 00 §8.6 风险确认；`docs/guest-installation.md` 会告诉你判定方法）
- [ ] XP 启动后确认 `res-agent.exe` 自启
- [ ] 运行 `debug.exe -i E000` 验证通道（这一步对应 `01-channel-mvp.md §3 第 1 级`，**从第二期下沉到第三期**）
- [ ] 验收 [00 §9](./00-overview.md) 三条
- [ ] 回填 `00 §8.3` 末段最终结论

### 4.2 你需要做的全部动作（**一次性、按顺序**）

1. **确认 EXE 路径**：从 `src/apps/virtual-machine/guest/res-agent/res-agent.exe` 取
2. **拷入镜像**（任选其一）：
   - A. 拖到 `C:\Tools\res-agent.exe`
   - B. 烧进第二块盘
   - C. 临时软盘 / u 盘镜像挂载
3. **注册启动项**（`docs/guest-installation.md` 给你注册表脚本，**照抄即可**）
4. **装 VBEMP 驱动**（仅在 00 §8.6 判定需要时；`docs/guest-installation.md` 给出判定命令）
5. **启动 XP，跑实测**：
   - XP 命令行：`debug` → `- i E000` → 记下值
   - 切到 instant-app，`window.__setChannelValue(...)` 改一次
   - XP 再 `- i E000` → 验证值变化（**通道层实测**）
   - 拖大拖小 instant-app 窗口 → 验证 XP 桌面 1:1 跟随（**功能层验收**）
6. **告诉我结果**（「通过」/「卡在 XX」），AI 据此回填 `00 §8.3` 末段

**预期耗时**：30~60 分钟（VBEMP 装驱动可能 30~60 分钟，看网络）。

### 4.3 退出条件

- [ ] §4.1 全部勾选
- [ ] §4.2 第 5 步通道层 + 功能层都过
- [ ] 镜像内 res-agent 开机自启稳定（连续重启 3 次都能跑）
- [ ] `00 §8.3` 末段写完最终结论

满足以上 = 整个 todo 完成。

---

## 5. 时间盒（仅参考，不承诺）

| 期 | 主要工作 | 量级 |
|---|---|---|
| 第一期 | 宿主侧 TS 接入 + 单测 + 协议同步 | 1~3 天（AI 全程） |
| 第二期 | 客机代理 EXE + 产物校验 + 安装文档 | 1~2 天（AI 全程） |
| 第三期 | 你做 6 步动作 | 30~60 分钟（含 VBEMP） |

**AI 总投入** ≈ 2~5 天。**你总投入** ≈ 1 小时。

---

## 6. 与既有 todo 的关系

- `01-channel-mvp.md §3 第 1 级`：**下沉到第三期**（建议在 `01` 内加一段引用本文）
- `01-channel-mvp.md §6 结果记录`：第三期末由你填
- `02-emacs-workflow.md`：第二期才完整激活
- `00-overview.md §5/§6`：第一期完成勾选
- `00-overview.md §7`：第二期完成勾选
- `00-overview.md §8.3` 末段：第三期末填
- `vm-host-filesystem-sharing.md` / `vm-xp-3d/04 §2`：长远自动化，属另议
- `vm-windows-xp-sb16-audio-loop.md`：**无关联**，独立 todo

## 7. 不在本方案范围内

- 自动送文件到 XP（属 `vm-host-filesystem-sharing.md` 串口代理计划，另议）
- v86 内部代码改动
- 镜像资产的版本管理
- 在 XP 命令行手敲 `debug.exe`（属物理动作，归第三期）
