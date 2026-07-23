# Instant npm 与桌面 npm 差异清单

Instant OS 的 `npm` / `npx` 是 **宿主 PackageService 的兼容面**，不是官方 npm CLI，也不嵌入真实 Node 子进程。

## 支持（第一刀）

- `npm install` / `uninstall` / `update` / `ls` / `outdated` / `run` / `bin`
- `npx <pkg>`（已装优先；否则先 install 再跑 bin）
- 锁文件：`instant-lock.json`（非 package-lock.json 字节兼容）
- 布局：全局 CAS store（`/user/.instant-pkg-store`）+ 项目 `node_modules` **符号链接**
- 纯 JS lifecycle / scripts：经 QuickJS 执行（`node` shebang 映射为 Instant 宿主）
- 拒绝：`.node` / gypfile / node-gyp 类原生包

## 明确不做

- publish / login / logout / whoami
- workspaces / monorepo 协议
- 完整 peer 依赖算法、overrides、npm hooks 插件
- 任意 shell 脚本、`child_process`、真实 OS 进程
- 官方 npm 配置文件全兼容（`.npmrc` 仅预留 registry 配置入口）
- 挂载卷上创建 symlink

## 能装 ≠ 能跑

安装成功只保证 tarball 进 store、裸名可解析、bin 能启动。Guest 实际执行仍依赖 Instant Node **内建子集**。

- **已实现（L1）**：`path`、`buffer`、`events`、`fs`、`fs/promises`
- **滚动补齐（路线图 L2.5）**：按 CLI 撞墙补 `assert`、`util`、`os`、`url` / `querystring`、薄 `stream`、`string_decoder`、`tty` 假实现、`process` CLI 缺口等
- **已观测**：`npx cowsay` 可装并进入 `yargs`，因未实现 `assert` 失败——属内建缺口，不是安装器失败
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
