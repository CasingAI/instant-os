# Instant OS · QuickJS 运行时演进路线图

> 目标：把当前「会话级 QuickJS 实例」（可多次 `eval`、保留全局、关闭即销毁）逐步补齐成可在 Instant OS 内执行脚本、安装纯 JS 依赖、最终驱动构建流水线的宿主环境。  
> 非目标：在浏览器沙箱里 1:1 复刻桌面 Node + 官方 Vite 原生二进制链路。

本文按 **L1 → L4** 递进。每一层有明确「目标 / 交付物 / 大致工作 / Todo / 明确不做 / 验收标准」。上层依赖下层；未完成下层时，不要提前承诺上层能力。

---

## 状态看板（给模型 / 协作者）

**用法**：开工前先读本看板与当前层的 Todo；完成一项就把 `- [ ]` 改成 `- [x]`；一层全部勾完且验收通过后，把该层状态改为 `done`，并把「当前焦点」下移。不要跳层把上层 Todo 标成进行中。

| 层级 | 状态 | 说明 |
|------|------|------|
| L0 基线 | `done` | 实例服务 + Virtual JS REPL 已落地 |
| L1 迷你 Node 宿主 | `doing` | **当前焦点** |
| L2 包与依赖 | `blocked` | 依赖 L1 |
| L3 样例构建 | `blocked` | 依赖 L2 |
| L4 自举 | `blocked` | 依赖 L3 |

状态枚举：`todo`（未开始）/ `doing`（进行中）/ `done`（已验收）/ `blocked`（被下层挡住）/ `cancelled`。

**当前焦点**：L1  
**上次更新**：2026-07-23

---

## 现状基线（L0）

**已有**

- [x] 系统级 QuickJS 实例服务：创建、订阅快照、`eval`、中断、销毁、控制台缓冲
- [x] 一次性沙箱（`runQuickJsSandbox`）仍保留，供短生命周期求值
- [x] Virtual JS 内置应用：演示「一窗一实例」的 REPL
- [x] 系统侧已有 VFS / Files API、终端会话模型（**尚未**桥接到 QuickJS）

**缺口（相对 L1）**

- [x] 模块加载（ESM 文件 + 内建；文件级 CJS require 见 L1.9）
- [x] 文件系统、路径、进程、二进制缓冲等宿主 API
- [x] 异步调度桥（宿主 Promise / I/O 回调回灌实例）
- [ ] 包安装、伪进程、构建后端（属 L2+）

---


## 总原则

1. **同一引擎，明确宿主表面**：QuickJS 跑语言；Instant OS 提供受控 API。不把浏览器 DOM 与完整 Node 全局混装进同一个默认环境。
2. **实例与宿主会话同寿**：一个终端会话或一个 Virtual JS 窗口对应一个实例；关闭即销毁，全局状态随之消失。
3. **优先接现有系统能力**：`fs` 走 Files/VFS，而不是另起一套内存盘然后双写。
4. **纯 JS / WASM 优先**：凡依赖原生 addon 或本机 bash 的路径，一律视为「需裁剪或替换」，不是「再补几个 API」。
5. **同步 I/O 走 Asyncify**：`*Sync` 在 guest 侧外观阻塞，宿主仍异步打 VFS（L1.6）。代价是 WASM ~2×、全体 JS 更慢、同模块不可嵌套挂起。策略见 L1.7（文档）：长驻实例统一 Asyncify，不做内存工作区/通用双轨。勿在 UI 线程忙等 IndexedDB。
6. **权限默认最小**：可读工作区、可写约定目录、网络按白名单；禁止逃逸到宿主真实磁盘。

---

## L1 — 会话级迷你 Node 宿主

### 目标

让 Virtual JS /（后续）终端会话里的 QuickJS 实例，能加载并执行 **VFS 中的多文件脚本**，具备读写文件、解析路径、读取进程环境、处理基础二进制的能力。  
这一层结束后，Instant OS 内第一次具备「可复用的 JS 执行环境」，而不再只是粘贴型 REPL。

### 成功标准（验收）

- 能从工作区入口文件启动，按相对路径拉取其它模块并执行。
- 脚本可通过文件系统 API 读写 VFS 中的文本/二进制，并在 Virtual JS 或终端输出中看到 `console` 与返回值。
- 同一实例内多次运行共享全局；关闭窗口/会话后实例销毁，再次打开是干净环境。
- 超时与手动中断仍然有效；销毁后不可再执行。

### 大致要做的事

1. **模块系统（最关键）**
   - 支持 ESM 加载；视需要提供薄 CJS `require` 兼容层。
   - 解析相对路径；ESM 须显式扩展名（对齐 Node；CJS `require` 的扩展名/index 补全见 L1.9）。
   - 目录 `package.json` 的 `main` / 基础 `exports["."]`（CJS `require` 目录入口；L1.10）。ESM 相对路径无 folder mains（对齐 Node）。
   - 支持 `node:` 前缀中「已实现」的内建模块；未实现的给出清晰错误。
   - 实例级模块缓存：同一文件在同一实例内只求值一次（与 Node 语义对齐的方向）。

2. **文件系统桥（接到现有 VFS）**
   - 提供 Node 风格 `fs` / `fs/promises` 的常用子集：读、写、追加、mkdir、readdir、stat、rename、unlink、exists 等。
   - 路径落在 Instant OS 卷模型上；权限跟随会话/应用策略。
   - 明确二进制与文本编码约定；大文件策略（限额或流式，可先限额）。

3. **路径与 URL 工具**
   - `path`（POSIX 语义为主，与 VFS 一致）。
   - `url` / `URL` / `URLSearchParams` 的常用能力，供模块解析与后续网络使用。

4. **`process` 子集**
   - `cwd`、`chdir`（若允许）、`env`、`argv`、`exitCode`。
   - stdout / stderr 接到宿主输出通道（与现有 console 捕获协同；与 `console.*` 同管道、按级别区分即可）。
   - 不实现真实进程退出杀死 OS；`exit` 映射为「结束当前任务并记录码」。
   - `nextTick` 不在本项：见 L1.16（宿主调度队列，非引擎内建）。

5. **`Buffer` 与文本编解码**
   - 提供与常见 npm 包兼容的 `Buffer` 表面，或等价互转层。
   - `TextEncoder` / `TextDecoder` 可用。

6. **定时器与异步桥**
   - `setTimeout` / `setInterval` / `clear*` / `queueMicrotask`。
   - 宿主异步（VFS、后续网络）完成后，把续体安全调度回该 QuickJS 实例。
   - 与现有 `busy` / `abort` / 超时模型协调：长时间异步任务可取消。
   - 与 L1.16 `nextTick` 共存时：同步结束后先排空 nextTick 队列，再触发到期定时器。
   - **语义约定（L1.2）**：实例常驻到 `destroy`；`busy` 仅同步切片；挂起 timer 不阻止再 `eval`；`abort` 清定时器但保留实例；退出码只认 `process.exit` / `exitCode`（不用最后表达式）。

7. **薄 `events`（及可选极薄 `stream`）**
   - 先满足「依赖能加载、事件能订阅」的最小集，不为完整 Node streams 花过大成本。

8. **Virtual JS / 文档同步升级**
   - Virtual JS：除粘贴运行外，支持「运行当前文件 / 指定入口」。
   - 关于文案与路线说明与本文件对齐。

### Todo（L1）

**状态**：`doing` · 里程碑 M1 · Script Host

- [x] **L1.1 实例宿主选项**：创建实例时可挂载工作区根、`env`、`argv`、权限/配额；门面类型补齐。系统默认 env 在设置中配置，终端创建时装入；实例继承而非探测主机。
- [x] **L1.2 异步桥与定时器**：`setTimeout` / `setInterval` / `clear*` / `queueMicrotask`；宿主 Promise 续体回灌（`executePendingJobs` + `settleGuestPromise`）；切片 `busy`；`abort`/`destroy` 清调度器；L1.16 nextTick 钩子已预留未实现
- [x] **L1.3 `path`**：POSIX 路径工具，作为内建模块可加载（`import` / `require` / `node:path`；共享 Node 内建注册表）
- [x] **L1.4 `process` 子集**：`cwd` / `env` / `argv` / `exitCode`；stdout/stderr 接到宿主（与 console 同管道）；`exit` 映射为结束任务（不含 `nextTick`，见 L1.16）
- [x] **L1.5 `Buffer` + 编解码**：`Buffer` 表面（feross/buffer 经 `vendor:quickjs-guest` 清单预打包注入 guest）+ 宿主桥 `TextEncoder` / `TextDecoder`（UTF-8）；全局与 `buffer`/`node:buffer` 同对象。完整 charset、`string_decoder`、独立 Buffer 配额见文末「远期目标」。后续含 npm 依赖的 guest 内建走同一清单；普通第三方包仍等 L2 / `node_modules`，不走本管线
- [x] **L1.6 `fs` / `fs/promises` → VFS**：读、写、追加、mkdir、readdir、stat、rename、unlink、rm/rmdir、access/exists；`fs` 回调 + `fs.promises` + `*Sync`（实例改走 Asyncify WASM，`newAsyncifiedFunction`）；路径落在卷模型；大文件硬拒绝 `maxFileBytes`。不做：fd/流/watch/symlink/chmod（见远期）
- [x] **L1.7 同步 I/O 策略落地**：文档化 Asyncify 策略（统一长驻实例、禁嵌套挂起、沙箱可 sync）；明确不做预加载 / 内存工作区 / 通用双轨 / 嵌套挂起排队。**Sync 表面已由 L1.6 Asyncify 提供**，本项不再是「第一次实现 Sync」
- [x] **L1.8 模块加载器（ESM）**：VFS 相对/绝对路径；Node ESM **不**自动补扩展名（须 `.js`/`.mjs`/`.cjs`）；实例级缓存；未实现 `node:` 清晰报错；粘贴 eval 入口 `{cwd}/[eval-n].js`。内建钩子自 L1.3；本项扩到文件。CJS 文件 `require`+扩展名补全见 L1.9。Asyncify：Sync 路径内禁止再挂起（含可挂起 import）
- [x] **L1.9 薄 CJS `require`（可选但建议）**：文件级 CJS（扩展名 / index / `.json` 探测）；顶层相对 cwd、模块内相对调用方；宿主递归预载静态 `require('…')` 以避免嵌套 Asyncify；实例缓存与循环依赖；`require.resolve` / `require.cache`。不做：裸名（L2）、`.node`、完整 Module API（`package.json` 入口见 L1.10）
- [x] **L1.10 入口 `package.json` 子集**：CJS 目录 `require` 读 `exports["."]`（字符串或 require/node/default）/ `main` → 再回退 `index`；有 `exports` 不回退 `main`。不做：ESM folder mains、`"module"` 字段、子路径 `exports`、裸名（L2）
- [ ] **L1.11 薄 `events`**：最小 EventEmitter，保证常见依赖能加载
- [ ] **L1.12（可选）极薄 `stream`**：仅在卡依赖时再加
- [ ] **L1.13 Virtual JS**：支持运行工作区文件 / 指定入口（不只粘贴 `eval`）
- [ ] **L1.14 冒烟测试**：多文件 import、读写 VFS、全局保持、中断/销毁、定时器、`nextTick`（若 L1.16 已做）
- [ ] **L1.15 验收勾选**：对照上方「成功标准」全部通过后，将看板 L1 → `done`，焦点移到 L2
- [ ] **L1.16 `process.nextTick`**：宿主侧优先队列；同步 `eval` 返回前（及与 L1.2 同环时先于定时器）按 FIFO 排空；挂到 `process.nextTick`；递归深度/次数保护；不改 QuickJS 引擎内部；**drain 钩子已由 L1.2 预留**

### 本层明确不做

- 包安装、registry 网络、`node_modules` 解析全貌。
- `child_process`、多实例编排。
- DOM / `window` / 浏览器专有 API。
- 完整 Node 兼容性测试矩阵。

### 交付物

- QuickJS 公共门面上的「带宿主能力的实例」创建选项（例如挂载工作区根、env、权限）。
- 内建模块实现与模块加载器。
- 冒烟测试：多文件互相 import、读写 VFS、全局保持、销毁失效。
- Virtual JS 能演示「打开并运行工作区脚本」。

---

## L2 — 包与依赖图（自研安装器地基）

### 目标

在 L1 之上，让实例能解析并加载 **已安装到 VFS 的第三方纯 JS 包**，并具备「从 registry 安装依赖树」的最小闭环。  
这一层结束后，用户可以在 Instant OS 里对纯 JS 生态做有限的「装包 → 引用 → 运行」，为终端替换与工具链铺路。

### 成功标准（验收）

- 给定锁文件或 `package.json`，能把依赖安装进工作区 `node_modules`（或等价布局）。
- 业务代码可通过裸模块名解析到正确入口（含基础 `exports` 条件）。
- 遇到原生绑定 / 不支持的 `postinstall` 时失败信息可读，且不污染实例稳定性。
- 安装过程可取消；重复安装可利用缓存加快。

### 大致要做的事

1. **包入口解析增强**
   - 完善 `package.json`：`exports`、条件导出（`import` / `require` / `default` 等子集）、子路径。
   - 向上查找 `node_modules`（含简单的作用域包）；与 VS Code 侧已有解析经验可对照，但运行时解析必须落在 QuickJS 加载器内。

2. **受控网络**
   - 为实例提供受策略约束的 `fetch`（或更窄的「registry 客户端」）。
   - 超时、大小限制、域名白名单（例如 npm registry / 镜像）。
   - 响应可写入 VFS 缓存层。

3. **极简安装器**
   - 解析 semver 范围与依赖树（可先支持常见范围，复杂 peer 依赖可降级策略）。
   - 下载 tarball、解压到 VFS、写锁文件。
   - 默认跳过或沙箱化 lifecycle scripts；原生 addon 直接拒绝。

4. **缓存与内容寻址**
   - 包 tarball / 解压结果缓存，避免重复下载。
   - 尽量与现有 Files / GitHub 对象存储思路一致，减少双份内容。

5. **权限与配额**
   - 安装目录可写、源码目录默认可读；限制 `node_modules` 体积与文件数。
   - AI 用量无关；但网络与存储操作应打事件日志，便于调试。

6. **演示路径**
   - Virtual JS 或终端：演示 `install` 某个纯 JS 小包并 `import` 运行。

### Todo（L2）

**状态**：`blocked`（待 L1）· 里程碑 M2 · Packages

- [ ] **L2.1 裸模块名解析**：向上查找 `node_modules`（含作用域包）
- [ ] **L2.2 `exports` / 条件导出子集**：`import` / `require` / `default` 等；子路径导入
- [ ] **L2.3 受控 `fetch` / registry 客户端**：白名单、超时、体积上限
- [ ] **L2.4 极简安装器**：semver 范围、依赖树、下载 tarball、解压进 VFS、写锁文件
- [ ] **L2.5 lifecycle / 原生策略**：跳过或拒绝 `postinstall`；拒绝 `.node` / native addon，错误可读
- [ ] **L2.6 安装缓存**：tarball / 解压结果复用；尽量贴近现有内容存储思路
- [ ] **L2.7 权限与配额**：`node_modules` 可写范围、体积/文件数上限；网络与存储打事件日志
- [ ] **L2.8 取消安装**：与实例 `abort` / 任务取消对齐
- [ ] **L2.9 演示闭环**：Virtual JS 或终端安装一个纯 JS 小包并成功 `import` 运行
- [ ] **L2.10 解析与安装测试集** + 「允许/拒绝包类型」约定文档
- [ ] **L2.11 验收勾选**：对照成功标准通过后，看板 L2 → `done`，焦点移到 L3

### 本层明确不做

- 完整 npm/yarn/pnpm 兼容（workspaces、plugins、完整 peer 算法可延后）。
- 任意 `postinstall` 编译原生模块。
- 完整 `http.Server` / 任意出站代理。

### 交付物

- 安装器模块（系统服务或可被终端调用的门面）。
- 加载器对 `node_modules` 的解析测试集。
- 「允许 / 拒绝」包类型的文档约定（纯 JS 白名单生态）。

---

## L3 — 可运行构建工具（CLI 形态）

### 目标

具备「在 Instant OS 内启动构建类工具」的能力：不是只 `eval` 一段库代码，而是能以 **CLI 入口** 的方式跑打包/编译流程，并把产物写回 VFS。  
这一层追求的是 **等价构建能力**（产出可部署的前端包），而不是必须跑通桌面版 Vite 官方二进制。

### 成功标准（验收）

- 能对一个小型样例前端项目执行「安装依赖 → 构建 → 产出 dist」全流程（工具链为系统选定的纯 JS/WASM 后端）。
- 构建过程有日志、可取消、失败时有明确阶段错误。
- 伪多进程或 Worker 化后，主 UI 仍可交互。

### 大致要做的事

1. **伪 `child_process` / 任务编排**
   - 不真 fork：再开 QuickJS 实例或 Worker，共享（或快照）VFS 视图。
   - 模拟 `argv`、exit code、stdout/stderr 管道。
   - 防止失控的实例风暴（并发上限）。

2. **选定并内嵌构建后端**
   - 优先：纯 JS 或官方 WASM 版打包/压缩/CSS 工具，作为系统运行时资产，而不是指望 `npm install vite` 后调用原生绑定。
   - 定义 Instant 构建配置约定（入口、别名、静态资源、目标环境）。

3. **TypeScript 策略**
   - 短期：构建前剥离类型 / 使用可嵌入的 TS 转译路径。
   - 或对样例项目先限制为 JS/JSX，降低第一刀复杂度。

4. **长时间任务 UX**
   - 进度、日志面板（终端或 Virtual JS）。
   - 内存与超时分级：REPL 小、build 大。
   - 增量与缓存：模块图、转译结果、内容哈希。

5. **Worker 与性能**
   - 重计算离开 UI 线程。
   - 工作区可预加载为内存盘，避免同步桥接持久层。

### Todo（L3）

**状态**：`blocked`（待 L2）· 里程碑 M3 · Build Sample

- [ ] **L3.1 伪 `child_process` / 任务编排**：新实例或 Worker、共享 VFS 视图、`argv`/exit/stdio；并发上限
- [ ] **L3.2 选定构建后端**：纯 JS 或官方 WASM 打包/压缩/CSS；作为系统运行时资产接入
- [ ] **L3.3 Instant 构建配置约定**：入口、别名、静态资源、目标环境
- [ ] **L3.4 TypeScript 策略落地**：类型剥离 / 可嵌入转译，或样例先限 JS/JSX
- [ ] **L3.5 样例前端项目**：可安装依赖并产出 `dist`
- [ ] **L3.6 构建 UX**：日志、进度、可取消、分阶段错误；REPL vs build 的内存/超时分级
- [ ] **L3.7 构建缓存**：模块图 / 转译结果 / 内容哈希（最小可用即可）
- [ ] **L3.8 Worker 化 + 内存工作区**：重活离 UI；避免 Sync 打持久化
- [ ] **L3.9 一键路径**：终端或专用命令跑通样例「install → build」
- [ ] **L3.10 性能基线记录**（体积、耗时、内存）
- [ ] **L3.11 验收勾选**：对照成功标准通过后，看板 L3 → `done`，焦点移到 L4

### 本层明确不做

- 保证与本仓库桌面 `vite build` 字节级一致。
- 支持任意 Node CLI 生态（大量工具仍会因原生绑定失败）。

### 交付物

- 系统内「构建运行时」与样例项目。
- 终端或专用命令：对样例执行 build 的一键路径。
- 性能基线记录（体积、耗时、内存）。

---

## L4 — 自举：在系统内构建 Instant App 自身

### 目标

在 Instant OS 内，对 **本仓库（或裁剪后的自举剖面）** 执行构建，得到可预览/可导出的产物。  
这是愿景终点，但必须以 **工程裁剪 + 等价工具链** 为前提；不是把当前 `package.json` 脚本原样搬进 QuickJS。

### 成功标准（验收）

- 存在正式的「Instant 自举剖面」：依赖与脚本不依赖本机 bash、不依赖不可嵌入的原生 CLI。
- 在系统内完成：解析工作区 → 安装/使用允许的依赖 → 执行 Instant 构建管线 → 产物可在浏览器应用或预览器中打开。
- 文档写清与桌面构建的差异（功能开关、资源预置、已知限制）。

### 大致要做的事

1. **仓库侧 Instant Profile**
   - 将 `vendor:*.sh` 一类步骤改为「预置资产已在 VFS/镜像中」或纯 JS 生成。
   - 对 Rapier / tokenizer 等 WASM 依赖走已vendored 路径，构建期不编译原生。
   - 提供与桌面 `dev`/`build` 平行的 Instant 脚本语义（名称可不同，行为要对齐「能产出应用」）。

2. **工具链对齐**
   - TypeScript 项目引用、路径别名、Preact/Vite 插件语义的等价实现或子集。
   - CSS/资源管道使用可嵌入实现。
   - 对无法嵌入的步骤：构建时跳过并文档化，或改为预生成。

3. **规模化优化**
   - 超大依赖（Monaco、Three 等）的预打包 / 外置 runtime，避免每次自举从零打包全世界。
   - 分层缓存与「只重编变更面」。
   - 内存上限、分片构建、可恢复任务。

4. **质量与安全**
   - 自举过程的权限审计（网络、写路径）。
   - 回归：小样例 + 自举剖面的 CI（可在桌面 Node 测加载器，在浏览器测完整桥）。

### Todo（L4）

**状态**：`blocked`（待 L3）· 里程碑 M4 · Self Host

- [ ] **L4.1 定义 Instant 自举剖面**：哪些包/脚本进入剖面，哪些必须预置或外置
- [ ] **L4.2 去掉 bash vendor 假设**：`vendor:*.sh` 改为预置资产或纯 JS 流程
- [ ] **L4.3 WASM 大依赖路径**：Rapier / tokenizer / Three 等走 vendored，构建期不编原生
- [ ] **L4.4 平行构建语义**：与桌面 `dev`/`build` 对齐「能产出应用」（命令名可不同）
- [ ] **L4.5 工具链子集**：TS 项目引用、路径别名、Preact 插件语义的等价或裁剪实现
- [ ] **L4.6 CSS/资源管道**：可嵌入实现；不能嵌入的改为预生成并文档化
- [ ] **L4.7 超大依赖外置**：Monaco / Three 等预打包或 runtime 外置，避免每次从零打包
- [ ] **L4.8 规模化缓存**：分层缓存、只重编变更面；内存上限、分片、可恢复任务
- [ ] **L4.9 权限审计**：自举期网络与写路径
- [ ] **L4.10 回归**：样例 + 自举剖面；桌面测加载器、浏览器测桥
- [ ] **L4.11 差异清单 + 性能报告**（相对桌面构建）
- [ ] **L4.12 系统内一键/指引式自举**可跑通
- [ ] **L4.13 验收勾选**：对照成功标准通过后，看板 L4 → `done`

### 本层明确不做（除非战略变更）

- 宣称 100% 兼容桌面 Vite 8 + 原生 Rolldown/Lightning 路径。
- 在 QuickJS 内运行任意原生 Node addon。

### 交付物

- Instant 自举剖面与说明。
- 系统内一键/指引式自举流程。
- 与桌面构建的差异清单与性能报告。

---

## 跨层级工作（贯穿 L1–L4）

| 主题 | 说明 |
|------|------|
| 实例生命周期 | 始终与终端会话 / Virtual JS 窗口绑定；重建实例 = 清空 JS 全局，VFS 文件仍在。 |
| 权限模型 | 会话级能力票：fs 范围、网络、子任务、内存/时间配额。 |
| 可观测性 | 统一日志：模块解析失败、fs 拒绝、安装拒绝、构建阶段。 |
| 测试策略 | 每层必有冒烟；加载器与 fs 契约测试可在 Node 下跑部分逻辑，桥接测试在浏览器跑。 |
| Virtual JS 角色 | L1 起从「演示 eval」升级为「演示宿主能力」；不替代终端的特权文件操作叙事，但可共享同一实例服务。 |
| 终端关系 | 终端替换是并行叙事：终端负责会话 UX 与特权命令；QuickJS 实例负责该会话的 JS 世界。L1 完成后再谈深度整合。 |

### Todo（跨层）

随各层推进勾选；不必等某一层全部完成才开始，但不得与「禁止跳层交付」冲突。

- [ ] **X.1 会话能力票模型**：fs / 网络 / 子任务 / 配额的统一描述与默认拒绝
- [ ] **X.2 统一可观测日志通道**：解析失败、fs 拒绝、安装拒绝、构建阶段
- [ ] **X.3 测试分层约定**：哪些在 Node 冒烟、哪些必须浏览器桥接测
- [ ] **X.4 终端 ↔ QuickJS 实例绑定方案**（L1 验收后再做深度整合设计）
- [ ] **X.5 每层完成后更新本文件看板 + 变更记录**

---

## 建议落地顺序（执行节奏）

```text
L1 模块 + VFS/fs + path/process/Buffer + 异步桥
        ↓
L2 包解析 + 受控网络 + 极简 install + 缓存
        ↓
L3 伪进程 + 内嵌 WASM/纯 JS 构建后端 + 样例项目打通
        ↓
L4 本仓库 Instant 剖面 + 自举与大规模缓存
```

**原则**：每一层先做「最小可演示闭环」，再加兼容面。避免在 L1 未验收时并行铺开安装器与 Vite 替代实现导致接口反复横跳。

---

## 风险与硬墙（提前写清）

1. **原生绑定**：生态中大量工具不能「装上就能跑」；策略是拒绝 + 换可嵌入实现。
2. **同步 API 性能**：若过早暴露大量 `*Sync` 且直打持久化，L3 会不可用；L1 就要定策略。
3. **与桌面 Vite 的期望差**：对外沟通应是「系统内构建管线」，不是「原样 npm run build」。
4. **内存**：浏览器页内跑 tsc + 打包 + Monaco/Three 级依赖，必须外置 runtime 与缓存，否则自举会爆。
5. **安全**：一旦开放网络与 fs，实例就等于弱虚拟机；权限与配额必须和 API 同步上线。

---

## 里程碑命名（便于讨论）

| 里程碑 | 对应 | 一句话 |
|--------|------|--------|
| M1 · Script Host | L1 | 能跑工作区多文件脚本 |
| M2 · Packages | L2 | 能装并引用纯 JS 包 |
| M3 · Build Sample | L3 | 能构建官方样例前端 |
| M4 · Self Host | L4 | 能构建 Instant 自举剖面 |

---

## 文档维护

- 本文件是规划源；实现细节以代码与单层设计短文为准。
- **模型更新协议**：
  1. 只把实际已完成的 Todo 勾成 `[x]`，不要提前勾验收项。
  2. 开始某层时：看板该层 → `doing`，写上「当前焦点」。
  3. 某层 Todo 全勾且验收通过：该层 → `done`，下一层从 `blocked` → `todo`/`doing`。
  4. 每改 Todo/看板，同步改「上次更新」日期，并在变更记录加一行。
- 若战略从「自研等价构建」改为「嵌入某特定 WASM 工具链」，先更新 L3/L4 再改代码。

### 变更记录

| 日期 | 说明 |
|------|------|
| 2026-07-22 | 初版：基于现有 QuickJS 实例服务与 Virtual JS 演示，定义 L1–L4 目标与工作项。 |
| 2026-07-22 | 补充状态看板与 L0–L4 / 跨层可勾选 Todo，便于模型记录进度。 |
| 2026-07-23 | L1 → `doing`；完成 L1.1：系统默认 env（设置可配）+ 终端装入 + QuickJS 宿主创建选项 / `getHostConfig`。 |
| 2026-07-23 | `nextTick` 从 L1.4 拆出为独立 **L1.16**（宿主优先队列）；L1.4 仅保留 cwd/env/argv/exitCode/exit + stdout/stderr。 |
| 2026-07-23 | 完成 L1.4：注入 `process` 子集；`exit` 结束本轮 eval 并记码（不销毁实例）；stdout/stderr → console 通道。 |
| 2026-07-23 | 完成 L1.3：`path` POSIX 子集 + Node 内建注册表；`setModuleLoader`（import）与同表薄 `require`；L1.8/L1.9 文件级加载仍待扩展。 |
| 2026-07-23 | 完成 L1.2：宿主定时器 + `queueMicrotask` + `executePendingJobs` 桥；常驻实例 / 切片 `busy`；`abort` 清定时器；退出码不跟最后表达式；L1.16 钩子预留。 |
| 2026-07-23 | L1.5 范围澄清：本期 Buffer + UTF-8 编解码；完整 charset / `string_decoder` / 独立 Buffer 配额记入文末「远期目标」。 |
| 2026-07-23 | 完成 L1.5：feross/buffer 预打包注入 guest（全局 + `buffer`/`node:buffer`）+ 宿主 `TextEncoder`/`TextDecoder` 桥；stdout 可写 Buffer。 |
| 2026-07-23 | Guest 内建 vendor：`vendor:quickjs-guest` + 清单驱动；替换一次性 `vendor-quickjs-buffer`；普通 npm 仍等 L1.8/VFS。 |
| 2026-07-23 | 完成 L1.6：实例改走 Asyncify；`fs`/`fs/promises` 接 Files/VFS（回调 + promises + Sync）；权限根 + `maxFileBytes`；L1.7 收窄为 Sync 策略优化。 |
| 2026-07-23 | 完成 L1.7：文档化 Asyncify 策略（长驻统一 Asyncify、禁嵌套挂起、沙箱可 sync）；明确不做预加载/内存工作区/通用双轨/嵌套排队。 |
| 2026-07-23 | 完成 L1.8：ESM 文件 import（相对导入方 / eval→cwd、绝对路径+读权限、显式扩展名、实例缓存）；CJS 文件 require 与扩展名补全留 L1.9。 |
| 2026-07-23 | 完成 L1.9：文件级 CJS require（扩展名/index/.json、父路径、宿主预载避嵌套 Asyncify、缓存/循环、`resolve`/`cache`）；package.json 入口留 L1.10。 |
| 2026-07-23 | 完成 L1.10：CJS 目录入口 `exports["."]` / `main` → index；exports 覆盖 main；目录别名供嵌套 sync require；不做 ESM folder mains / `"module"` / 子路径。 |

---

## 远期目标（L1 之后按需）

> 不阻塞当前层验收；有明确依赖或产品需求时再开项。与「本层明确不做」不同：这里是**以后可以做**，不是永久排除。

### 编解码与二进制（承接 L1.5 缺口）

- [ ] **F.1 多编码 / 完整 charset**：在 UTF-8 之外支持常见 legacy 编码（按需表驱动或受控依赖）；`TextDecoder` 非 UTF-8 不再一律拒绝。
- [ ] **F.2 `string_decoder`**：流式解码（不完整多字节序列跨 chunk）；通常在薄 `stream` / 流式 `fs` 读真正落地后再做。
- [ ] **F.3 独立 Buffer 配额**：单次 `alloc` / `from` 软上限与更清晰的错误信息（与堆 `memoryLimitBytes`、文件 `maxFileBytes` 分层说明）；L1.5 仅靠堆限额。

### 文件系统更深对齐（承接 L1.6 缺口）

- [ ] **F.4 fd / `open` / 定位读写**：真实句柄表与位置指针（当前 VFS 为路径/blob）。
- [ ] **F.5 `fs.watch` / 流式读写**：对接 `filesWatch` 与薄 `stream`；语义对齐 Node 有限子集。
- [ ] **F.6 符号链接 / Unix mode**：`lstat`/`symlink`/`chmod`（当前卷模型无 symlink，仅有 writable）。
- [ ] **F.7 append/rename 原子性与跨卷 `EXDEV`**：减少读改写竞态；跨卷移动错误码更贴近 Node。