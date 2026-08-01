# Instant npm 与桌面 npm 差异清单

Instant OS 的 `npm` / `npx` 是 **宿主 PackageService 的兼容面**，不是官方 npm CLI，也不嵌入真实 Node 子进程。

## 支持（第一刀）

- `npm install` / `uninstall` / `update` / `ls` / `outdated` / `run` / `bin`
- `npx <pkg>`（已装优先；否则先 install 再跑 bin）
- 锁文件：`instant-lock.json`（非 package-lock.json 字节兼容）
- **锁优先安装**：`npm install`（无新包名）时，若锁内精确版本仍满足 `package.json` 范围，则跳过 registry 解析；锁未命中时再尝试本地 CAS store；store 命中则不下 tarball；锁有 `resolved` 时可直接下包。安装中途失败也会写入**已链接部分**的锁，避免下次整树重新打 registry。
- `npm update` / `npm install <pkg>`：重新向 registry 按范围解析
- 布局：全局 CAS store（`/dev/npm`）+ 项目 `node_modules` **符号链接**（接近 pnpm，故意保留）；版本目录内有 `.instant-ok` 才算完整缓存命中（半成品会清掉重解）
- **Guest 文件权限**：`npm run` / `npx` / lifecycle 脚本在 QuickJS 中可读全局 store（经 `node_modules` 链接解析后的真实路径），可写项目内源码；**不可**改 `node_modules` 与 store 包内容。仅 PackageService（安装/卸载）可写 store 与链接树；提交后的版本目录在 VFS 层标为只读。
- **可配置 registry**：设置 → NPM（官方 / npmmirror / 自定义 npm 兼容源）；持久化并接到 PackageService
- **install lifecycle（可选）**：默认 **忽略** scripts（`ignoreScripts: true`）。设置 → NPM 打开「运行 install 脚本」，或单次 `npm install --scripts` / `--ignore-scripts` 覆盖。启用后顺序对齐 npm：根 `preinstall` → 装链依赖 → 依赖拓扑序 `preinstall`/`install`/`postinstall` → 根 `install`/`postinstall`/`prepare`。纯 JS 经 QuickJS；不支持的命令形态 warn 并跳过；可跑但失败则整次 install 失败。
- 拒绝：`.node` / gypfile / node-gyp 类原生包

## 源站选择

- 主路径使用 **npm 兼容 registry 协议**（packument + tarball），默认 `registry.npmjs.org`。
- 加速应换 **同协议镜像**（如 npmmirror）或自定义 Verdaccio，而不是 jsDelivr。
- **不做**：以 jsDelivr Data/CDN API 作为安装源（缺完整 packument、无整包 tarball 安装管线）。

## 明确不做

- publish / login / logout / whoami
- workspaces / monorepo 协议
- 完整 peer 依赖算法、overrides、npm hooks 插件
- 任意 shell 脚本、`child_process`、真实 OS 进程（**例外**：`npm run` 支持用 `&&` 串联多条「node / .js / .bin」子命令，按顺序执行；前一段非零 `exitCode` 时中止后续；`.bin` 若为 npm/pnpm 的 shell shim，会解析其中的 `exec node <file>` 再跑 QuickJS；`tsc` 命令优先解析 `typescript` 包 bin，避开 npm 同名占位包；不支持 `cd`、管道、`||`、变量展开等）
- 官方 `.npmrc` / `package-lock.json` 字节全兼容；scoped 多 registry 表；多源自动故障转移
- 挂载卷上创建 symlink
- jsDelivr 作 `node_modules` 安装源

## 能装 ≠ 能跑

安装成功只保证 tarball 进 store、裸名可解析、bin 能启动。Guest 实际执行仍依赖 Instant Node **内建子集**。

### 已实现 / 明确不做 / 滚动中

| 栏 | 内容 |
|----|------|
| **已实现** | `path`、`buffer`、`events`、`assert`、`util`（薄：`inspect` / `inherits` / `promisify` / `types` / `format` / `deprecate` / `debuglog`）、`os`（薄：platform/arch/EOL/tmpdir/homedir/`version`/`userInfo` 等假值）、`perf_hooks`（薄：**宿主真实** `performance` 桥——`now` / `timeOrigin` / User Timing `mark`·`measure`·`clear*` / `getEntries*`；薄 `PerformanceObserver`；条目为 plain 对象；**无** ELU / `nodeTiming` / `timerify`）、`fs`、`fs/promises`（含 `realpath`/`realpathSync.native`、`copyFile`、`mkdtemp`、`truncate`、`readdir`+`withFileTypes`、`constants`、假 `chmod`/`chown`、`watch`/`watchFile`/`unwatchFile`；**无** fd/`open`/流式读写）；`module`（薄：`createRequire` 接 guest CJS；`enableCompileCache` 等 no-op；`isBuiltin`/`builtinModules` 反映已实现表；`Module` 未接）；`querystring`（`parse`/`stringify`/`encode`/`decode`）；`tty`（假：`isatty(0)=true`，`isatty(1/2)=false`，与 process stdio 策略对齐）；`console`（re-export 全局）；`timers`（转发全局 + 薄 `promises`）；`constants`（聚合 fs+os 常量）；`url`（`parse`/`format`/`fileURLToPath`/`pathToFileURL`；有引擎 `URL` 则 re-export）；`crypto`（薄：**宿主** `getRandomValues` 桥 `randomBytes`；`randomUUID` 优先宿主 `crypto.randomUUID`）；`stream`（极薄：`Readable`/`Writable`/`Duplex`/`Transform`/`PassThrough`、最小 `finished`/`pipeline`；**无**背压/fd 流）；`string_decoder`（薄：仅 UTF-8 `StringDecoder`）；`readline`（占位：`createInterface` 薄接口、`question` 异步空串；`readline/promises` 薄 `createInterface`+`question` Promise）；`process` CLI 探测假值：`version` / `versions`（`node`/`v8`/`uv`/`openssl`/`modules` 静态假矩阵，**不**伪造 `electron`）/ `platform` / `arch` / `execPath` / stdout·stderr `isTTY: false` / `stdin.isTTY: true` |
| **明确不做（本层）** | 完整 `builtinModules`（仅已实现子集）；`child_process`；`http`/`https`/`net`/`tls` 服务端；原生 addon；完整 Node `process.versions` 真值；`perf_hooks` 的 libuv 专有指标；完整 `crypto`（哈希/签名/cipher 等） |
| **滚动中（撞墙再补）** | 流式 `fs` 读、完整 Node streams 背压矩阵、非 UTF-8 `string_decoder`、交互式真 `readline` |

### 兼容锚点（设计约定）

- **设计目标**：内建 API 形状对齐 **Node 20 LTS 文档子集**（当前标签 `process.versions.node = "20.18.0"`）。
- **不是承诺**：标签只服务 `engines` / 常见嗅探（如 yargs 读 `versions.electron`）；真实能力以「已实现」表为准，缺的仍报 `not implemented yet`。
- **为何不报更高版本**：版本号越高，包越可能按版本打开我们尚未实现的代码路径；20.x 足够过多数 `engines`，又比盲目宣称 latest 更稳。
- **验收锚点（L2.5）**：`npm run test:quickjs-cowsay`（install cowsay → `npx cowsay "Hello World"` → stdout 含 ASCII 牛）；`.bin` 经 lstat 解析真实入口；宿主 pnpm/npm 的 shell shim 会再抽 `exec node` 目标
- **验收锚点（L3.0）**：`npm run test:quickjs` 中 `perf_hooks` / 薄 `module` CJS/ESM 探针；不以「装上 Vite 就能跑完整 build」为验收
- **系统诊断日志**：「事件日志 → 系统」与设置 → 开发者选项中的开关；内存环 + `localStorage` 快照（跨标签可读），用于推断 `npm run` / QuickJS 卡死前在做什么。整页冻住时请**新开标签页**查看「上次会话残留」；与 AI 事件日志（IndexedDB）无关
- **VFS 路径缓存**：`listDirectory` / `resolveNode` 命中内存缓存，避免 tsc 读 `typescript/lib/*.d.ts` 时对同目录反复打 IndexedDB；变更时失效
- **fs 宿主让出**：QuickJS 宿主 fs 每若干次调用插入一次宏任务让出，减轻 Asyncify 微任务链把主线程打满导致的整页冻死

- 未实现内建会报「known but not implemented」并列出已实现列表；不假装成裸包 404

## 允许 / 拒绝的包类型

| 类型 | 策略 |
|------|------|
| 纯 JS / 可解析 ESM·CJS | 允许安装；能否跑通取决于内建覆盖（见上） |
| 仅含可选 native、默认走 JS 路径 | 尽力；装上后若入口要 `.node` 则运行失败 |
| 强制 node-gyp / prebuild / binding.gyp | 安装期拒绝 |
| `postinstall` 编译原生 | 拒绝原生包；若仍落到可跑 JS 脚本且启用 scripts，失败则中止 install |
| 需联网的 postinstall | Guest 无网络权限时会失败（默认仍 ignoreScripts，多数情况碰不到） |
| 含 shell / 系统二进制的 lifecycle | 跳过并 warn（无真实 shell） |

## 终端与 App

- **PackageService**（`package-public`）是系统级包管理服务：install / uninstall / update / ls / outdated / run / npx、任务与事件均以此为唯一真相源。
- **包管理** App 为 GUI 主入口：分段页「项目 / 全局缓存」——选择项目后安装与管理依赖，浏览全局 CAS store 已缓存版本；安装/更新/检查进度走窗口内安装会话。
- 模拟终端的 `npm` / `npx` 为薄 CLI 适配器（`package-cli-adapter`），与包管理 App 共用 PackageService，逻辑零分叉；真终端尚未接 CLI。
- 安装进度与日志可在 App 安装会话与终端两端观察；取消走同一任务 abort。
- 终端默认安装输出对齐 **pnpm reporter 版式**（`Packages: +N`、`Progress: resolved/reused/downloaded/added`、直接依赖 diff、`Done in`）；内部管线 info 仍写入任务日志，不默认刷进终端。
- registry 与 **是否运行 install 脚本** 在 **设置 → NPM** 配置；与终端 / App 共用同一 `PackageServiceConfig`。
- 重复 `npm install` 在启用 scripts 时可能再次跑依赖 lifecycle（未做「仅新增包才跑」的增量优化）。
