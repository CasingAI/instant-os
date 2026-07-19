# Instant OS 外链应用 — AI 开发约定

> **实验性 · 未完成**：外链应用平台（Bridge）仍是未完成的实验特性；协议与宿主约定可能继续变动。

## 项目结构

- `app.config.json`：应用元数据（改名称、描述、ID、图标路径）
- `package.json`：`version` 会写入 manifest
- `assets/icon-source.svg`：图标源，构建时复制并用于生成启动图
- `src/bridge/`：与 Instant OS 宿主通信，不要删除
- `src/components/SplashScreen.tsx`：启动图 UI，结束后触发 enter
- `src/app.tsx`：业务入口，在 `phase === 'ready'` 后编写主界面

## 必须遵守

1. 启动完成后必须调用 `notifyHostEnterProgram()`（已在 `SplashScreen` 流程中接入，勿移除）
2. 不要依赖外部 CDN；资源放在仓库内或构建产物中
3. 需要 AI 能力时，在 `app.config.json` 的 `tags` 中加入 `"ai"`，使用 `https://instant-os.local/v1/chat/completions`
4. 需要文件能力时，在 `tags` 中加入 `"files"`，通过 `InstantOS.files` 以全局路径（`/user`、`/models`、`/system`、`/mount/…`）读写
5. 构建命令：`pnpm build`（会生成 manifest、图标、启动图）

## 开发工具

- `pnpm dev` 自动显示可拖动 **OS 悬浮球**（点击打开面板，拖动可改位置）
- 面板含 **日志 / 配置 / 信息** 三个分页
- API Key、Base URL、模型在面板「配置」里填写并保存，存 localStorage，无需改文件
- enter / AI 相关 postMessage 在「日志」里可核对是否发出、是否被模拟宿主收到

## manifest 格式

`format` 固定为 `instant-os-ext-app-manifest`，`schemaVersion` 为 `1`。

## enter 消息

`type`: `instant-os-ext-app-enter`

宿主收到后应隐藏外层启动壳并展示 iframe 内应用主体。
