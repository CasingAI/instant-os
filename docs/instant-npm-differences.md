# Instant npm 与桌面 npm 差异清单

Instant OS 的 `npm` / `npx` 是 **宿主 PackageService 的兼容面**，不是官方 npm CLI，也不嵌入真实 Node 子进程。

## 支持（第一刀）

- `npm install` / `uninstall` / `update` / `ls` / `outdated` / `run` / `bin`
- `npx <pkg>`（已装优先；否则先 install 再跑 bin）
- 锁文件：`instant-lock.json`（非 package-lock.json 字节兼容）
- **锁优先安装**：`npm install`（无新包名）时，若锁内精确版本仍满足 `package.json` 范围，则跳过 registry 解析；store 命中则不下 tarball；锁有 `resolved` 时可直接下包
- `npm update` / `npm install <pkg>`：重新向 registry 按范围解析
- 布局：全局 CAS store（`/user/.instant-pkg-store`）+ 项目 `node_modules` **符号链接**（接近 pnpm，故意保留）
- **可配置 registry**：设置 → NPM（官方 / npmmirror / 自定义 npm 兼容源）；持久化并接到 PackageService
- 纯 JS lifecycle / scripts：经 QuickJS 执行（`node` shebang 映射为 Instant 宿主）
- 拒绝：`.node` / gypfile / node-gyp 类原生包

## 源站选择

- 主路径使用 **npm 兼容 registry 协议**（packument + tarball），默认 `registry.npmjs.org`。
- 加速应换 **同协议镜像**（如 npmmirror）或自定义 Verdaccio，而不是 jsDelivr。
- **不做**：以 jsDelivr Data/CDN API 作为安装源（缺完整 packument、无整包 tarball 安装管线）。

## 明确不做

- publish / login / logout / whoami
- workspaces / monorepo 协议
- 完整 peer 依赖算法、overrides、npm hooks 插件
- 任意 shell 脚本、`child_process`、真实 OS 进程
- 官方 `.npmrc` / `package-lock.json` 字节全兼容；scoped 多 registry 表；多源自动故障转移
- 挂载卷上创建 symlink
- jsDelivr 作 `node_modules` 安装源

## 能装 ≠ 能跑

安装成功只保证 tarball 进 store、裸名可解析、bin 能启动。Guest 实际执行仍依赖 Instant Node **内建子集**。

### 已实现 / 明确不做 / 滚动中

| 栏 | 内容 |
|----|------|
| **已实现** | `path`、`buffer`、`events`、`assert`、`util`（薄：`inspect` / `inherits` / `promisify` / `types` 子集）、`fs`、`fs/promises`；`process` CLI 探测假值：`version` / `versions.node` / `platform` / `arch` / stdio `isTTY: false` |
| **明确不做（本层）** | 完整 `builtinModules`；`child_process`；`http`/`https`/`net`/`tls` 服务端；原生 addon；完整 Node `process.versions` 矩阵（v8/openssl/…） |
| **滚动中（撞墙再补）** | `os`、`url` / `querystring`、薄 `stream`、`string_decoder`、`tty` 模块假实现 |

### 兼容锚点（设计约定）

- **设计目标**：内建 API 形状对齐 **Node 20 LTS 文档子集**（当前标签 `process.versions.node = "20.18.0"`）。
- **不是承诺**：标签只服务 `engines` / 常见嗅探（如 yargs 读 `versions.electron`）；真实能力以「已实现」表为准，缺的仍报 `not implemented yet`。
- **为何不报更高版本**：版本号越高，包越可能按版本打开我们尚未实现的代码路径；20.x 足够过多数 `engines`，又比盲目宣称 latest 更稳。
- **下一刀**：终端再跑 `npx cowsay`；若仍失败，按报错补「滚动中」项
- 未实现内建会报「known but not implemented」并列出已实现列表；不假装成裸包 404

## 允许 / 拒绝的包类型

| 类型 | 策略 |
|------|------|
| 纯 JS / 可解析 ESM·CJS | 允许安装；能否跑通取决于内建覆盖（见上） |
| 仅含可选 native、默认走 JS 路径 | 尽力；装上后若入口要 `.node` 则运行失败 |
| 强制 node-gyp / prebuild / binding.gyp | 安装期拒绝 |
| `postinstall` 编译原生 | 拒绝 / 跳过并记录 |

## 终端与 App

- 终端本地命令 `npm` / `npx` 与 **包管理** App 共用 PackageService，逻辑零分叉。
- 安装进度与日志可在两端观察；取消走同一任务 abort。
- registry 在 **设置 → NPM** 配置；与终端共用同一 `PackageServiceConfig`。
