# Instant OS · QuickJS 运行时演进路线图

> 目标：把当前「会话级 QuickJS 实例」（可多次 `eval`、保留全局、关闭即销毁）逐步补齐成可在 Instant OS 内执行脚本、安装纯 JS 依赖、最终驱动构建流水线的宿主环境。  
> 非目标：在浏览器沙箱里 1:1 复刻桌面 Node + 官方 Vite 原生二进制链路。

本文按 **L1 → L2 → L2.5 → L3.0–L3.4 → L4** 递进。每一层有明确「目标 / 交付物 / 大致工作 / Todo / 明确不做 / 验收标准」。上层依赖下层；未完成下层时，不要提前承诺上层能力。

---

## 状态看板（给模型 / 协作者）

**用法**：开工前先读本看板与当前层的 Todo；完成一项就把 `- [ ]` 改成 `- [x]`；一层全部勾完且验收通过后，把该层状态改为 `done`，并把「当前焦点」下移。不要跳层把上层 Todo 标成进行中。

| 层级 | 状态 | 说明 |
|------|------|------|
| L0 基线 | `done` | 实例服务 + Virtual JS REPL 已落地 |
| L1 迷你 Node 宿主 | `done` | 实例宿主 + Virtual JS 文件入口 |
| L2 包与 npm 兼容面 | `done` | PackageService + symlink + 终端 npm/npx + Packages App |
| L2.5 Node CLI 内建面 | `done` | assert/util/os + cowsay 全链路；`.bin` 真实路径 |
| L3.0 构建 CLI 内建面 | `done` | `perf_hooks` 宿主 Performance 桥 + `test:quickjs` 探针 |
| L3.1 伪进程 / 任务编排 | `todo` | **当前焦点** · 伪 child_process / 子任务 |
| L3.2 系统构建后端 | `blocked` | 依赖 L3.1 |
| L3.3 样例构建闭环 | `blocked` | 依赖 L3.2 |
| L3.4 构建硬化 | `blocked` | 依赖 L3.3 |
| L4 自举 | `blocked` | 依赖 L3.4 |

状态枚举：`todo`（未开始）/ `doing`（进行中）/ `done`（已验收）/ `blocked`（被下层挡住）/ `cancelled`。

**当前焦点**：L3.1  
**上次更新**：2026-07-24

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
5. **同步 I/O 走 Asyncify**：`*Sync` 在 guest 侧外观阻塞，宿主仍异步打 VFS（L1.6）。代价是 WASM ~2×、全体 JS 更慢、**不可嵌套挂起**（串行可）。CJS `require` 用回合制：宿主桥只 resolve+读源码，guest 解冻后再执行模块体（L1.9），避免 require 套 Sync。策略见 L1.7：长驻实例统一 Asyncify，不做内存工作区/通用双轨。勿在 UI 线程忙等 IndexedDB。
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
   - 与 L1.16 `nextTick` 共存时：同步结束后微任务 / nextTick / Promise jobs 同相排空，再触发到期定时器（不保证 nextTick 严格先于 then）。
   - **语义约定（L1.2）**：实例常驻到 `destroy`；`busy` 仅同步切片；挂起 timer 不阻止再 `eval`；`abort` 清定时器但保留实例；退出码只认 `process.exit` / `exitCode`（不用最后表达式）。

7. **薄 `events`（及可选极薄 `stream`）**
   - L1.11：最小 EventEmitter（能加载、能订阅/触发；`error` 无监听抛错）；不为完整 Node events / streams 花过大成本。
   - L1.12（可选）：极薄 `stream`，仅在卡依赖时再加。

8. **Virtual JS / 文档同步升级**
   - Virtual JS：除粘贴运行外，支持「运行当前文件 / 指定入口」（L1.13 已落地）。
   - 关于文案与路线说明与本文件对齐。

### Todo（L1）

**状态**：`doing` · 里程碑 M1 · Script Host

- [x] **L1.1 实例宿主选项**：创建实例时可挂载工作区根、`env`、`argv`、权限/配额；门面类型补齐。系统默认 env 在设置中配置，终端创建时装入；实例继承而非探测主机。
- [x] **L1.2 异步桥与定时器**：`setTimeout` / `setInterval` / `clear*` / `queueMicrotask`；宿主 Promise 续体回灌（`executePendingJobs` + `settleGuestPromise`）；切片 `busy`；`abort`/`destroy` 清调度器；L1.16 `nextTick` 已接入同相 drain
- [x] **L1.3 `path`**：POSIX 路径工具，作为内建模块可加载（`import` / `require` / `node:path`；共享 Node 内建注册表）
- [x] **L1.4 `process` 子集**：`cwd` / `env` / `argv` / `exitCode`；stdout/stderr 接到宿主（与 console 同管道）；`exit` 映射为结束任务（`nextTick` 见 L1.16）
- [x] **L1.5 `Buffer` + 编解码**：`Buffer` 表面（feross/buffer 经 `vendor:quickjs-guest` 清单预打包注入 guest）+ 宿主桥 `TextEncoder` / `TextDecoder`（UTF-8）；全局与 `buffer`/`node:buffer` 同对象。完整 charset、`string_decoder`、独立 Buffer 配额见文末「远期目标」。后续含 npm 依赖的 guest 内建走同一清单；普通第三方包仍等 L2 / `node_modules`，不走本管线
- [x] **L1.6 `fs` / `fs/promises` → VFS**：读、写、追加、mkdir、readdir、stat、rename、unlink、rm/rmdir、access/exists；`fs` 回调 + `fs.promises` + `*Sync`（实例改走 Asyncify WASM，`newAsyncifiedFunction`）；路径落在卷模型；大文件硬拒绝 `maxFileBytes`。不做：fd/流/watch/chmod（见远期）；**symlink 升为 L2.0 前置**
- [x] **L1.7 同步 I/O 策略落地**：文档化 Asyncify 策略（统一长驻实例、禁嵌套挂起、沙箱可 sync）；明确不做预加载 / 内存工作区 / 通用双轨 / 嵌套挂起排队。**Sync 表面已由 L1.6 Asyncify 提供**；CJS 与 Sync 共存靠 L1.9 回合制（非预载）
- [x] **L1.8 模块加载器（ESM）**：VFS 相对/绝对路径；Node ESM **不**自动补扩展名（须 `.js`/`.mjs`/`.cjs`）；实例级缓存；未实现 `node:` 清晰报错；粘贴 eval 入口 `{cwd}/[eval-n].js`。内建钩子自 L1.3；本项扩到文件。CJS 文件 `require`+扩展名补全见 L1.9。Asyncify：Sync 路径内禁止再挂起（含可挂起 import）
- [x] **L1.9 薄 CJS `require`（可选但建议）**：文件级 CJS（扩展名 / index / `.json` 探测）；顶层相对 cwd、模块内相对调用方；**回合制**（宿主 asyncified 只 resolve+读源码；guest 解冻后包装执行 / cache / 循环依赖）——不再在挂起内 `callFunction` 或静态预载；`require.resolve` / `require.cache`。不做：`.node`、完整 Module API（`package.json` 入口见 L1.10；裸名见 L2）
- [x] **L1.10 入口 `package.json` 子集**：CJS 目录 `require` 读 `exports["."]`（字符串或 require/node/default）/ `main` → 再回退 `index`；有 `exports` 不回退 `main`。不做：ESM folder mains、`"module"` 字段、子路径 `exports`、裸名（L2）
- [x] **L1.11 薄 `events`**：手写最小 EventEmitter（`on`/`once`/`off`/`emit`/`removeAllListeners`/`listenerCount`；`error` 无监听抛错）；`events`/`node:events` 同一构造函数；CJS 导出即构造函数。不做：vendor 整包、挂全局、`prepend*`、`captureRejections`、`stream`（L1.12）、`nextTick` 异步辅助
- [ ] **L1.12（可选）极薄 `stream`**：仅在卡依赖时再加（不阻塞 L1 验收；**升格见 L2.5.6**）
- [x] **L1.13 Virtual JS**：打开工作区 `.js`/`.mjs`/`.cjs` 作入口（`eval` + `filename`）；保存/重新加载；「演示入口」写入 `/user/virtual-js-demo` 多文件相对 import；内置用例仍为粘贴 eval
- [x] **L1.14 冒烟测试**：多文件 import、读写 VFS、全局保持、中断/销毁、定时器、`nextTick`（`test:quickjs`）
- [x] **L1.15 验收勾选**：对照上方「成功标准」全部通过后，将看板 L1 → `done`，焦点移到 L2
- [x] **L1.16 `process.nextTick`**：宿主 FIFO 队列；与 `queueMicrotask` / Promise jobs **同相**排空（先于定时器；**不**保证 Node「严格先于 then」）；挂 `process.nextTick`；单次 drain / 队列上限；`abort`/`destroy` 清队列；不改引擎

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

## L2 — 包与 npm 兼容面（PackageService + 终端 + 管理 App）

### 目标

在 L1 之上交付 **Instant 包管理体系**：宿主级 PackageService（CAS store + symlink 布局）、QuickJS 裸名解析、终端本地 `npm`/`npx`（核心命令 + 纯 JS scripts）、独立 Packages 管理 App。  
实现形态是宿主 TypeScript 系统服务，**不是**嵌入真实 Node/`npm` 二进制；终端与 App 只是入口。

### 成功标准（验收）

- VFS / QuickJS `fs` 支持 symlink 语义子集（读跟随、`lstat`/`readlink`/`symlink`）。
- 给定 `package.json` 或锁文件，能把依赖装进工作区 `node_modules`（symlink 指入全局 CAS store）。
- 业务代码可通过裸模块名解析到正确入口（含基础 `exports` 条件）；解析跟随 symlink。
- 终端可跑：`npm install|uninstall|update|ls|outdated|run|bin` 与 `npx`；日志可见、可取消。
- Packages App 能显示任务/日志/store 占用并取消任务（与终端共用同一服务）。
- 遇到原生绑定失败信息可读；同版本包在 store 中不重复存实体。

### 大致要做的事

1. **L2.0 VFS 符号链接（前置，原 F.6）**
   - `FilesNodeKind` 增加 `symlink`；存链接目标字符串；同卷优先；循环深度上限。
   - QuickJS：`fs.symlink` / `readlink` / `lstat` / `Stats.isSymbolicLink`。
   - 第一期：仅用户可写卷可创建 symlink；挂载卷可不支持创建。

2. **PackageService（系统服务）**
   - Registry 客户端（白名单、超时、体积上限）。
   - semver 求解（常见范围；peer 降级警告）。
   - CAS store + 项目 `node_modules` symlink 布局；自研锁文件。
   - 任务模型：进度事件、可取消、配额、结构化日志。
   - 原生 / `.node` 拒绝；lifecycle 尽量用 QuickJS 跑纯 JS，否则跳过并记录。

3. **加载器**
   - 裸名向上查 `node_modules`（含作用域包）；`exports` 条件与子路径子集；跟随 symlink。

4. **终端 `npm` / `npx`**
   - 本地快路径（非 AI）；stdio / live block；会话绑定 QuickJS 跑 `run`/`npx`。
   - 能力票：网络/安装确认（或信任工作区）。

5. **Packages 管理 App**
   - 任务、日志、store 清理、取消；不复制装包逻辑。

6. **Scripts / npx 语义**
   - `node` shebang → Instant QuickJS；`PATH` 含 `.bin`；`npm_lifecycle_event` 等常用 env 子集。

### Todo（L2）

**状态**：`doing` · 里程碑 M2 · Packages

- [x] **L2.0 VFS + QuickJS symlink 子集**：kind、创建/读链、跟随与 `lstat`、循环上限；用户可写卷
- [x] **L2.1 裸模块名解析**：向上查找 `node_modules`（含作用域包）；跟随 symlink
- [x] **L2.2 `exports` / 条件导出子集**：`import` / `require` / `default` 等；子路径导入
- [x] **L2.3 Registry 客户端**：白名单、超时、体积上限；metadata + tarball
- [x] **L2.4 PackageService 安装器**：semver、依赖树、CAS 解压、symlink 布局、写锁文件
- [x] **L2.5 lifecycle / 原生策略**：纯 JS scripts 走 QuickJS；拒绝 `.node` / native；不可跑则跳过并记录
- [x] **L2.6 CAS 去重与配额**：同版本实体一份；store / 项目体积与文件数上限；事件日志
- [x] **L2.7 取消安装**：任务 abort 与终端/App 对齐
- [x] **L2.8 终端 `npm` / `npx`**：install/uninstall/update/ls/outdated/run/bin + npx；tab/help；能力票
- [x] **L2.9 Packages 管理 App**：任务/日志/store/取消；桌面与程序坞可见（与终端并列）
- [x] **L2.10 Scripts / npx 语义**：`.bin`、env 子集、shebang→QuickJS
- [x] **L2.11 演示闭环**：终端装纯 JS 小包 → 裸 import → `npm run` / `npx`（本地 symlink + bare require 冒烟；registry 装包需联网）
- [x] **L2.12 测试集 + 差异文档**：「允许/拒绝」包类型；与桌面 npm 差异清单（`docs/instant-npm-differences.md`）
- [x] **L2.13 验收勾选**：对照成功标准通过后，看板 L2 → `done`，焦点移到 L2.5

### 本层明确不做

- 完整 npm CLI 大表（publish / login / workspaces / audit 插件生态等可延后）。
- 任意 `postinstall` 编译原生模块；真实 Node 子进程 / 官方 npm 二进制。
- 完整 `http.Server` / 任意出站代理。
- 挂载卷上创建 symlink（第一期）。
- **完整 Node 内建矩阵**（L2 只保证装包与加载器；`npx` 能否跑通常见 CLI 属 L2.5）。

### 交付物

- PackageService 模块（系统门面；终端与 App 共用）。
- VFS symlink + 加载器 `node_modules` 测试集。
- 终端 `npm`/`npx` 本地命令；Packages 管理 App。
- 「允许 / 拒绝」包类型与桌面 npm 差异文档。

---

## L2.5 — Node CLI 内建面（能装之后能跑）

### 目标

L2 解决了 **能装包、能解析裸名、能启动 bin**；本层补齐 QuickJS 侧 **常用 Node 内建模块**，让一类「纯 JS CLI」在 `npx` / `npm run` 下真正跑完，而不是一 `require('assert')` 就停。

**已观测缺口（2026-07-23）**：`npx cowsay "Hello World"` 已装上并进入 `cowsay` → `yargs`，随后因未实现 `assert` 失败。  
**验收进展（2026-07-23）**：已实现内建：`path`、`buffer`、`events`、`assert`、`util`、`os`、`fs`、`fs/promises`；`process` CLI 假值含 `execPath` / `stdin.isTTY`。`npm run test:quickjs-cowsay` 全链路通过（install → npx → ASCII 牛）；`.bin` 经 lstat 解析真实入口。`url` / `stream` / `tty` 等 cowsay 路径未撞墙，仍留滚动清单。

### 成功标准（验收）

- `npx cowsay "Hello World"`（或等价纯 JS CLI 冒烟）能把 stdout 打到终端，不以「builtin not implemented」退出。
- 未实现的 `node:` / 内建名仍给出「已知未实现 + 已实现列表」错误；实现后可从同一注册表加载。
- 差异文档写明：Instant Node 内建是 **子集滚动补齐**，不是桌面 Node 全表。
- 不引入真实 Node 进程、不开放原生 addon。

### 大致要做的事

1. **按真实 CLI 依赖滚动补内建**（优先撞墙的，而不是一次写完 `builtinModules`）
   - 第一刀：`assert` 子集（`ok` / `equal` / `strictEqual` / `deepEqual` 等常用；`strict` 命名空间可后置）。
   - 随后按 cowsay / yargs / 其它小 CLI 再撞：`util`、`os`、`url`、`querystring`、`string_decoder`、薄 `stream`（承接 L1.12）、`tty` 假实现等。
   - `process` 在 L1 已有 cwd/env/argv/exit；本层只补 CLI 真正用到的缺口（如 `versions`、`platform`、`stdout.isTTY` 假值等），不重做一整套。

2. **实现策略**
   - 与现有 Node 内建注册表同一路径：`import` / `require` / `node:` 同源。
   - 优先手写薄实现或受控 vendor（对齐 L1.5 buffer 清单模式）；禁止把桌面 Node 原生绑定塞进 guest。
   - 每补一个模块：冒烟 + 更新「已实现列表」与差异文档。

3. **验收样例集（最小）**
   - 锚定：`npx cowsay …`。
   - 可选加 1～2 个无原生、依赖面窄的纯 JS CLI，避免只过单一包。

### Todo（L2.5）

**状态**：`done` · 里程碑 M2.5 · CLI Builtins · 焦点已移至 L3

- [x] **L2.5.0 缺口清单**：根据 `npx cowsay` 与已知 CLI，列出「下一刀内建」优先级；同步 `docs/instant-npm-differences.md`（能装 ≠ 能跑）
- [x] **L2.5.1 `assert` 子集**：覆盖 yargs/cowsay 路径；`assert` / `node:assert` 同源
- [x] **L2.5.2 冒烟 `npx cowsay`**：装 → 跑 → stdout 可见；记录仍缺的下一模块（若有）（`npm run test:quickjs-cowsay`）
- [x] **L2.5.3 `util` 子集**：按实际撞墙补（`inspect` / `inherits` / `types` / `promisify` 等按需）— 第一刀已落地（yargs 15 加载期 `require('util')`）
- [x] **L2.5.4 `os` 子集**：`platform` / `arch` / `EOL` / `tmpdir` 等假值或 VFS 约定；供 CLI 探测环境
- [ ] **L2.5.5 `url` / `querystring` 常用面**：模块解析与 CLI 参数链需要时落地（全局 `URL` 已有则对齐模块导出）— cowsay 未撞；**滚动至 L3.0**
- [ ] **L2.5.6 薄 `stream`（升格 L1.12）**：仅卡依赖时实现可读/可写最小面；不追求完整 Node streams — 未撞；**滚动至 L3.0**
- [ ] **L2.5.7 `string_decoder` / `tty` 假实现**：流式解码与 `isTTY` 等按需；避免 CLI 在探测终端时硬崩 — 未撞（`process.stdin.isTTY` 已假实现）；**滚动至 L3.0**
- [x] **L2.5.8 `process` CLI 缺口**：`versions`、`platform`、stdio 伪 TTY 等；仍不实现真退出杀 OS（已注入 `version`/`versions.node`/`platform`/`arch`/`execPath`/`isTTY:false`/`stdin.isTTY:true`；兼容标签 Node 20.18.0）
- [x] **L2.5.9 滚动补齐协议**：新报错「not implemented yet」→ 记入本层 Todo 或远期；禁止静默当裸包 404（差异文档三栏已立）
- [x] **L2.5.10 差异文档 + 已实现表**：维护「已实现 / 明确不做 / 滚动中」三栏
- [x] **L2.5.11 验收勾选**：对照成功标准通过后，看板 L2.5 → `done`，焦点移到 L3

### 本层明确不做

- 一次实现完整 Node `builtinModules` 列表。
- `child_process` / 真多进程（L3 伪进程另开）。
- `http`/`https`/`net`/`tls` 服务端与任意出站（网络白名单另议；不为本层默认目标）。
- `fs` 的 fd / watch / 完整 stream 读写（仍见远期 F.4/F.5）。
- 保证任意 npm CLI「装上就能跑」。

### 交付物

- 内建注册表扩展（至少 `assert`，并按撞墙滚动）。
- `npx cowsay`（及可选第二样例）冒烟通过记录。
- 更新后的差异文档：能装 / 能跑边界与已实现内建表。

---

## L3 总览 — 从「能跑小 CLI」到「能产出 dist」

L2.5 证明：**能装 ≠ 能跑小 CLI**。L3 再拆一层认识：**能跑 cowsay ≠ 能跑构建工具链**。

原先单块「L3 样例构建」把兼容面、编排、产品选型、样例与硬化捆在一起，验收只能卡在最后一环。现拆为四层，每层一句验收、禁止跳层交付：

| 子层 | 一句话 | 验收锚点（示意） |
|------|--------|------------------|
| **L3.0** | 构建向 Node 内建继续撞墙补 | `perf_hooks`（及后续点名模块）可 `require`；选定薄探针不因「not implemented」退出 |
| **L3.1** | 伪进程 / 多实例编排 | 父实例能拉起子实例，带 argv / exit / stdio；有并发上限 |
| **L3.2** | 系统内嵌构建后端 | 纯 JS/WASM 打包器作**系统资产**；单文件或小图写出产物到 VFS（**不**指望官方 Vite npm 包） |
| **L3.3** | 官方样例闭环 | 小前端：install → Instant build → `dist`；TS 策略在本层定死 |
| **L3.4** | 硬化 | Worker / 内存盘 / 缓存 / 进度可取消 / 性能基线；主 UI 可交互 |

**总目标（L3.4 完成后才算「L3 大阶段」完成）**：在 Instant OS 内以 CLI/专用命令形态跑通等价构建，产出可部署前端包；不是桌面 Vite 字节级复刻。

**明确不做（贯穿 L3.*）**：

- 保证与本仓库桌面 `vite build` 字节级一致。
- 支持任意 Node CLI 生态；`npm install vite` 后原样跑官方二进制链路。
- 一次实现完整 `builtinModules`（仍撞墙滚动）。

---

## L3.0 — 构建 CLI 内建面

### 目标

在 L2.5（cowsay 级）之上，补齐**构建类工具**常见会撞的 Node 内建子集。观测点：终端/`npm run` 路径已出现 `perf_hooks`「known but not implemented」。

**前置**：L2.5 `done`。

### 已观测缺口与优先表（L3.0.0）

| 优先级 | 模块 / 面 | 说明 |
|--------|-----------|------|
| **P0** | `perf_hooks` | 必写。W3C 计时面（`now` / `timeOrigin` / User Timing / `getEntries*`）**桥接宿主真实** `globalThis.performance`；`perf_hooks` / `node:perf_hooks` 同源 |
| **P1** | `url` / `querystring`、薄 `stream`、`string_decoder`、`tty` | L2.5 滚下；仅探针点名再补 |
| **不做真接** | `PerformanceObserver`；`eventLoopUtilization` / `monitorEventLoopDelay` / `nodeTiming` 真值；`timerify` / histogram / GC·http 条目 | 无 libuv / 本层范围外 |

**薄探针**：`test:quickjs` guest 冒烟（CJS + ESM）；不以 Vite/`tsc` 全链路为验收。

### 成功标准（验收）

- `require('perf_hooks')` / `node:perf_hooks` 同源可用；`now` 与 mark/measure 走宿主真实 API。
- 薄探针不以「builtin not implemented」退出；若再撞墙，记入本层 Todo 并补最小面。
- 差异文档三栏更新；未实现名仍报「已知未实现 + 已实现列表」。

### 大致要做的事

1. `perf_hooks` 宿主桥（非 guest `Date.now` 假时钟）；P1 仅点名落地。
2. 同一内建注册表路径；禁止桌面 Node 原生绑定。
3. 每补一模块：冒烟 + 差异文档。

### Todo（L3.0）

**状态**：`done` · 里程碑 M3.0 · Build Builtins · 焦点已移至 L3.1

- [x] **L3.0.0 缺口清单**：根据 `perf_hooks` 与候选薄探针，列出优先补齐表；同步差异文档「滚动中」
- [x] **L3.0.1 `perf_hooks` 子集**：宿主桥 `now` / `timeOrigin` / User Timing / `getEntries*`；`node:perf_hooks` 同源
- [x] **L3.0.2 薄探针冒烟**：`test:quickjs` CJS/ESM；本轮未再撞其它内建
- [x] **L3.0.3 滚动补齐**：本轮探针未点名 `url` / `stream` / …，无新增实现
- [x] **L3.0.4 验收勾选**：对照成功标准；看板 L3.0 → `done`，焦点 → L3.1

### 本层明确不做

- 完整 Performance Timeline / Observer；Node 专有 ELU / `nodeTiming` 真值。
- 为通过本层而嵌入完整打包器（属 L3.2）。

### 交付物

- 扩展后的内建注册表与冒烟。
- 更新后的 `docs/instant-npm-differences.md` 三栏。

---

## L3.1 — 伪进程 / 任务编排

### 目标

让 guest 能以「子任务」方式再开执行上下文（不真 fork OS 进程）：共享或快照 VFS 视图，传递 argv，回收 exit code 与 stdio。

**前置**：L3.0（构建探针不再卡在内建上；编排层可独立测，但看板仍串行）。

### 成功标准（验收）

- 存在伪 `child_process`（或 Instant 等价 API）：父上下文可启动子 QuickJS 实例（或约定 Worker 包装），传入 argv / env 子集。
- 子任务 stdout/stderr 可汇入父侧日志；exit code 可读；结束后可销毁。
- 并发上限生效；超额拒绝并有明确错误。

### 大致要做的事

1. 宿主编排：实例池 / 一对一子实例；权限票含「子任务」。
2. stdio 管道或回调聚合；`process.exit` 在子任务内只结束子上下文。
3. 冒烟：父脚本拉起子脚本写文件或打印，父侧可见结果。

### Todo（L3.1）

**状态**：`todo`（待开工）· 里程碑 M3.1 · Process Orchestra · **当前焦点**

- [ ] **L3.1.1 子任务模型**：生命周期、并发上限、与会话能力票对齐
- [ ] **L3.1.2 伪 `child_process` 子集**（或 Instant 命名 API）：spawn/fork 语义之一；argv/env/cwd
- [ ] **L3.1.3 stdio + exit**：管道或事件；exit code 回传
- [ ] **L3.1.4 冒烟**：父→子→父可见输出/文件副作用
- [ ] **L3.1.5 验收勾选**：看板 L3.1 → `done`，焦点 → L3.2

### 本层明确不做

- 真 OS 多进程、任意原生 `spawn` 桌面二进制。
- 完整 Node `child_process` 矩阵（`execFile`/`fork` IPC 全套可后置）。

### 交付物

- 子任务 API + 冒烟记录。

---

## L3.2 — 系统构建后端

### 目标

选定并**内嵌**纯 JS 或官方 WASM 打包/压缩（及必要的 CSS）工具，作为 **Instant 系统运行时资产**，而不是用户项目 `node_modules` 里的官方 Vite。

**前置**：L3.1（若后端仅宿主调用可不强依赖伪进程，但产品路径上构建 CLI 常需子任务；看板仍串行）。

### 成功标准（验收）

- 系统可对「单入口 JS/JSX（或已定 TS 剥离结果）」执行打包/转换，产物写入 VFS 指定路径。
- 有 Instant 构建配置约定初稿：入口、别名、目标环境、输出目录。
- 文档写明：这是 Instant 构建管线，不是 `vite` npm 包兼容层。

### 大致要做的事

1. 选型（如 esbuild-wasm 或同类）并 vendor 进仓库/镜像。
2. 宿主或 guest 薄封装：读 VFS → 调用后端 → 写回 VFS。
3. 配置约定与最小 CLI/API（名称可与桌面不同）。

### Todo（L3.2）

**状态**：`blocked`（待 L3.1）· 里程碑 M3.2 · Embed Bundler

- [ ] **L3.2.1 选型决议**：记录候选与否决（为何不嵌官方 Vite）
- [ ] **L3.2.2 接入系统资产**：加载 WASM/纯 JS 后端；版本钉扎
- [ ] **L3.2.3 最小 API**：一文件或一小图 → 输出文件落 VFS
- [ ] **L3.2.4 配置约定 v0**：入口 / 别名 / outfile / platform
- [ ] **L3.2.5 验收勾选**：看板 L3.2 → `done`，焦点 → L3.3

### 本层明确不做

- 完整 Vite 插件生态、HMR、Rolldown 原生路径。
- TypeScript 项目引用全集（策略在 L3.3 定；本层可只吃已是 JS 的输入）。

### 交付物

- 内嵌构建后端 + 配置约定短文 + 单文件冒烟。

---

## L3.3 — 样例构建闭环

### 目标

官方小型前端样例在 Instant 内走通：**安装依赖 → Instant build → 产出 `dist`**。TypeScript 策略在本层拍板（剥离 / 可嵌入转译 / 或样例先限 JS/JSX）。

**前置**：L3.2。

### 成功标准（验收）

- 样例项目可 `npm install`（Instant）且一键/专用命令 build 成功，`dist` 内有可预览静态资源。
- 失败时有阶段错误（install / transform / bundle / write）。
- 与桌面构建的差异写入清单（功能开关、已知限制）。

### 大致要做的事

1. 样例仓库或 `/user` 演示项目（依赖面可控、无原生强制）。
2. TS 策略落地并文档化。
3. 终端或专用命令绑定 L3.2 管线。

### Todo（L3.3）

**状态**：`blocked`（待 L3.2）· 里程碑 M3.3 · Build Sample

- [ ] **L3.3.1 样例项目**：结构、依赖白名单、README
- [ ] **L3.3.2 TypeScript 策略**：剥离 / 嵌入转译 / 先 JS；写进差异文档
- [ ] **L3.3.3 一键路径**：终端或 App 命令「install → build」
- [ ] **L3.3.4 阶段错误**：日志可区分失败阶段
- [ ] **L3.3.5 验收勾选**：看板 L3.3 → `done`，焦点 → L3.4

### 本层明确不做

- Instant App 本仓库自举（L4）。
- 任意第三方模板「装上就能 build」。

### 交付物

- 样例项目 + 一键 build 路径 + 差异说明。

---

## L3.4 — 构建硬化（Worker / 缓存 / UX）

### 目标

长时间构建不冻死 UI：Worker 化、内存工作区、最小缓存、进度与取消、性能基线。

**前置**：L3.3（先有正确闭环，再硬化）。

### 成功标准（验收）

- 构建可取消；进行中主 UI 可交互（Worker 或等价让出）。
- 存在最小缓存（内容哈希或模块图之一即可）并有命中日志。
- 记录一版性能基线（体积、耗时、内存量级）。

### 大致要做的事

1. 重计算离 UI 线程；VFS 快照或内存盘策略。
2. REPL vs build 的内存/超时分级。
3. 进度面板（终端或专用 UI）。

### Todo（L3.4）

**状态**：`blocked`（待 L3.3）· 里程碑 M3.4 · Build Harden

- [ ] **L3.4.1 Worker（或等价）**：构建离主线程；会话仍可操作
- [ ] **L3.4.2 内存工作区策略**：避免 Sync 直打持久化成为热路径
- [ ] **L3.4.3 最小缓存**：哈希或模块图；可关闭
- [ ] **L3.4.4 UX**：进度、日志、取消；超时分级
- [ ] **L3.4.5 性能基线**：表格或短文落库
- [ ] **L3.4.6 验收勾选**：看板 L3.4 → `done`，焦点 → L4（L3 大阶段完成）

### 本层明确不做

- 完美增量编译与桌面 Vite 缓存字节兼容。
- L4 级超大依赖外置（Monaco/Three 自举优化）。

### 交付物

- 可取消的构建 UX + 基线记录；L3 大阶段收口声明。

---

## L4 — 自举：在系统内构建 Instant App 自身

### 目标

在 Instant OS 内，对 **本仓库（或裁剪后的自举剖面）** 执行构建，得到可预览/可导出的产物。  
这是愿景终点，但必须以 **工程裁剪 + 等价工具链** 为前提；不是把当前 `package.json` 脚本原样搬进 QuickJS。  
**前置**：L3.4（样例闭环 + 硬化已具备）。

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

**状态**：`blocked`（待 L3.4）· 里程碑 M4 · Self Host

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
| 终端关系 | 终端负责会话 UX 与特权命令；QuickJS 负责该会话的 JS 世界。L2：终端本地 `npm`/`npx` 调 PackageService；`run`/`npx` 绑定会话 QuickJS。安装器是系统服务，不是 guest 自举的 npm。 |
| Packages App | L2 管理面：任务/日志/store；与终端共用 PackageService，零分叉。 |
| Node 内建面 | L1 交付 path/buffer/events/fs；L2.5 补 cowsay 向 assert/util/os；**L3.0** 补构建向（`perf_hooks` 等）撞墙滚动；未实现保持清晰报错。 |

### Todo（跨层）

随各层推进勾选；不必等某一层全部完成才开始，但不得与「禁止跳层交付」冲突。

- [ ] **X.1 会话能力票模型**：fs / 网络 / 子任务 / 配额的统一描述与默认拒绝（含安装/registry）
- [ ] **X.2 统一可观测日志通道**：解析失败、fs 拒绝、安装拒绝、构建阶段
- [ ] **X.3 测试分层约定**：哪些在 Node 冒烟、哪些必须浏览器桥接测
- [ ] **X.4 终端 ↔ QuickJS 实例绑定方案**（L2 `npm run`/`npx` 已用任务级实例；会话长驻 / 子任务绑定在 L3.1 加深）
- [ ] **X.5 每层完成后更新本文件看板 + 变更记录**

---

## 建议落地顺序（执行节奏）

```text
L1 模块 + VFS/fs + path/process/Buffer + 异步桥
        ↓
L2.0 VFS symlink
        ↓
L2 PackageService + CAS + 链接安装 + 裸名加载器
        ↓
L2 终端 npm/npx + Packages App + run/npx 语义
        ↓
L2.5 Node CLI 内建（assert/util/os；npx cowsay 冒烟）
        ↓
L3.0 构建 CLI 内建（perf_hooks…；薄探针冒烟）
        ↓
L3.1 伪进程 / 子任务编排
        ↓
L3.2 系统内嵌 WASM/纯 JS 构建后端
        ↓
L3.3 样例 install → Instant build → dist
        ↓
L3.4 Worker / 缓存 / UX / 基线（L3 大阶段收口）
        ↓
L4 本仓库 Instant 剖面 + 自举与大规模缓存
```

**原则**：每一层先做「最小可演示闭环」，再加兼容面。安装器内核只实现一次；终端与 App 零分叉。  
**能装（L2）≠ 能跑小 CLI（L2.5）≠ 能跑构建工具链（L3.*）**。避免在 L3.0 未过关时并行铺开 Vite 替代实现；避免在 L3.2 未选型时承诺样例 dist。

---

## 风险与硬墙（提前写清）

1. **原生绑定**：生态中大量工具不能「装上就能跑」；策略是拒绝 + 换可嵌入实现。
2. **同步 API 性能**：若过早暴露大量 `*Sync` 且直打持久化，L3.4 会不可用；L1 就要定策略。
3. **与桌面 Vite / npm 的期望差**：对外沟通应是「Instant npm 兼容面 / 系统内构建管线」，附差异清单，不是「原样 npm / vite」。
4. **能装 ≠ 能跑**：L2 装上纯 JS CLI 后，仍可能卡在未实现 Node 内建（已观测：`npx cowsay` → `yargs` → `assert`）。须走 L2.5 / L3.0 滚动补齐，不要误判为安装器 bug。
5. **能跑小 CLI ≠ 能构建**：`perf_hooks` 等属 L3.0；官方 Vite 属明确不做，改走 L3.2 系统后端。
6. **内存**：浏览器页内跑 tsc + 打包 + Monaco/Three 级依赖，必须外置 runtime 与缓存，否则自举会爆。
7. **安全**：一旦开放网络与 fs，实例就等于弱虚拟机；权限与配额必须和 API 同步上线。
8. **symlink 与卷模型**：挂载卷/IndexedDB 语义不一致时，第一期限用户可写卷创建链接。
9. **store 体积**：配额 + Packages App 清理与安装同步上线。

---

## 里程碑命名（便于讨论）

| 里程碑 | 对应 | 一句话 |
|--------|------|--------|
| M1 · Script Host | L1 | 能跑工作区多文件脚本 |
| M2 · Packages | L2 | PackageService + symlink store + 终端 npm/npx + Packages App |
| M2.5 · CLI Builtins | L2.5 | assert 等常用内建 + `npx cowsay` 级纯 JS CLI 可跑 |
| M3.0 · Build Builtins | L3.0 | 构建向内建（含 `perf_hooks`）+ 薄探针可跑 |
| M3.1 · Process Orchestra | L3.1 | 伪进程 / 子任务：argv·exit·stdio |
| M3.2 · Embed Bundler | L3.2 | 系统内嵌纯 JS/WASM 打包后端 |
| M3.3 · Build Sample | L3.3 | 官方样例 install → build → dist |
| M3.4 · Build Harden | L3.4 | Worker / 缓存 / UX / 基线；L3 大阶段收口 |
| M4 · Self Host | L4 | 能构建 Instant 自举剖面 |

---

## 文档维护

- 本文件是规划源；实现细节以代码与单层设计短文为准。
- **模型更新协议**：
  1. 只把实际已完成的 Todo 勾成 `[x]`，不要提前勾验收项。
  2. 开始某层时：看板该层 → `doing`，写上「当前焦点」。
  3. 某层 Todo 全勾且验收通过：该层 → `done`，下一层从 `blocked` → `todo`/`doing`。
  4. 每改 Todo/看板，同步改「上次更新」日期，并在变更记录加一行。
- 若战略从「自研等价构建」改为「嵌入某特定 WASM 工具链」，先更新 **L3.2**（及受影响的 L3.3/L4）再改代码。

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
| 2026-07-23 | **CJS require 回合制**：废弃「宿主预载 + 挂起内 callFunction」；asyncified 桥只取源码，guest 薄 require 解冻后执行；消除 require 套 `fs.*Sync` 的 `Already suspended`（L2.5 cowsay 阻塞项）。 |
| 2026-07-23 | 完成 L1.10：CJS 目录入口 `exports["."]` / `main` → index；exports 覆盖 main；不做 ESM folder mains / `"module"` / 子路径。 |
| 2026-07-23 | 完成 L1.11：手写薄 EventEmitter（guest 源注入）；`events`/`node:events` 同构造函数；不做 vendor / 全局 / prepend / stream。 |
| 2026-07-23 | 完成 L1.16：`process.nextTick` 宿主 FIFO；与 microtask/Promise **同相**（先于定时器，不保证先于 then）；drain/队列上限；abort 清队列。 |
| 2026-07-23 | 完成 L1.13：Virtual JS 打开/保存工作区入口 + `filename` 相对 import；演示项目 `/user/virtual-js-demo`。 |
| 2026-07-23 | **L2 重定稿**：F.6 symlink → L2.0 前置；PackageService（CAS + symlink 布局）；终端 `npm`/`npx` 核心命令+scripts；Packages 管理 App；明确不做官方 npm 二进制 / publish/login/workspaces。 |
| 2026-07-23 | L1.14/L1.15 验收：`test:quickjs` 冒烟通过；看板 L1 → `done`，焦点 → L2。 |
| 2026-07-23 | L2 落地：VFS symlink；PackageService（CAS+链接布局）；裸名解析；终端 npm/npx；Packages App；`docs/instant-npm-differences.md`；看板 L2 → `done`，焦点 → L3。 |
| 2026-07-23 | **增补 L2.5 Node CLI 内建面**：观测 `npx cowsay` 卡在未实现 `assert`；明确能装≠能跑；Todo：assert→util/os/url/stream/tty/process 缺口滚动补齐；看板焦点 → L2.5，L3 改 `blocked`（待 L2.5）。 |
| 2026-07-23 | L2.5 第一刀：手写薄 `assert` + `util`（inspect/inherits/promisify/types）；接入内建注册表；`test:quickjs` 冒烟；差异文档三栏；看板 L2.5 → `doing`；全链路 `npx cowsay` 待终端验收。 |
| 2026-07-23 | L2.5.8：`process.versions`/`version`/`platform`/`arch`/`isTTY` 假值；兼容锚点文档化为 Node 20.18.0 子集（非完整实现承诺）；修复 yargs `versions.electron` 探测崩。 |
| 2026-07-23 | **L2.5 收口**：薄 `os`；`process.execPath` + `stdin.isTTY`；修 `npm run` `.bin` lstat→真实入口；`test:quickjs-cowsay` 全链路通过；看板 L2.5 → `done`，焦点 → L3。 |
| 2026-07-23 | **L3 拆分**：原单块 L3 扩为 L3.0（构建内建/`perf_hooks`）→ L3.1（伪进程）→ L3.2（系统打包后端）→ L3.3（样例 dist）→ L3.4（硬化）；看板焦点 → L3.0；L4 改待 L3.4。 |
| 2026-07-24 | **L3.0 收口**：薄 `perf_hooks` 桥接宿主真实 Performance（`now`/`timeOrigin`/User Timing/`getEntries*`）；明确不做 Observer/ELU/`nodeTiming`；`test:quickjs` 探针通过；看板 L3.0 → `done`，焦点 → L3.1。 |

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
- [ ] **F.6 Unix mode / `chmod`**：`chmod` 等（symlink 已升入 L2.0；当前卷模型仅有 writable）。
- [ ] **F.7 append/rename 原子性与跨卷 `EXDEV`**：减少读改写竞态；跨卷移动错误码更贴近 Node。