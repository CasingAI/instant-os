# Instant OS 外链应用模板

TypeScript + Preact 模板，用于在 Instant OS 之外独立开发外链微应用。构建后自动生成安装所需的 manifest、图标与启动图；应用启动时会先展示启动图，完成后向宿主发送 `instant-os-ext-app-enter` 消息。

## 快速开始

```bash
cd extAppTemplate
pnpm install
pnpm dev
```

```bash
pnpm build
pnpm preview
```

构建产物位于 `dist/`，其中包含：

| 文件 | 说明 |
|------|------|
| `index.html` | 应用入口 |
| `instant-os.manifest.json` | 安装清单（ID、名称、描述、版本、入口、图标、启动图） |
| `icon.svg` | 应用图标 |
| `splash-light.svg` | 浅色启动图（白底居中图标） |
| `splash-dark.svg` | 深色启动图（黑底居中图标） |

## 开发工具（DevTools）

独立运行 `pnpm dev` 时，右下角会出现可拖动的 **OS 悬浮球**：

- **拖动**：改变悬浮球位置（自动保存）
- **点击**：打开 DevTools 面板

面板分三块：

| 分页 | 功能 |
|------|------|
| **日志** | 桥接发出/收到、生命周期、AI 调用记录 |
| **配置** | 填写 API Base、API Key、模型（保存到本机，立即生效） |
| **信息** | 应用 ID、版本、运行模式、当前 AI 模式等 |

未配置 API 时 AI 使用 Mock；在面板里填好并点「保存配置」即可切到真实 API，**不必改 `.env` 文件**。

`.env` 仍可作为初始默认值；`pnpm preview` 时设 `VITE_INSTANT_OS_DEV_TOOLS=true` 可启用悬浮球。

## 在 Instant OS 内真机调试

1. 在本目录执行 `pnpm dev`（默认 `http://localhost:6175/`）
2. 打开 Instant OS → **系统设置 → 开发者选项 → 外链应用调试**
3. 填入开发服务器地址，点击「添加到桌面」
4. 从桌面打开该应用：在 iframe 内运行，AI 请求走 Instant OS 宿主的真实 AI，而非模板内的 Mock

> 通过此方式添加的应用仅保存在**当前浏览器会话**中，刷新或重启 Instant OS 后会自动消失。

## 配置

编辑 `app.config.json`：

- `id`：应用唯一 ID（建议 `ext:your-app`）
- `name` / `description`：名称与描述
- `themeColor`：主题色
- `iconSource`：图标源文件（SVG）
- `tags`：能力标签（如 `ai` 会启用 AI 桥接）

版本号读取 `package.json` 的 `version` 字段。

## 与 Instant OS 通信

启动流程：

1. 展示启动图（跟随系统深浅色，加载 `splash-light.svg` / `splash-dark.svg`）
2. 启动图结束后调用 `notifyHostEnterProgram()`
3. 向 `window.parent` 发送：

```json
{
  "type": "instant-os-ext-app-enter",
  "manifest": { "...": "instant-os.manifest.json 同结构，entry 为当前页面绝对 URL" }
}
```

桥接代码位于 `src/bridge/`：

- `instant-os-host.ts`：enter 消息与 manifest 构建
- `instant-os-ai-bridge.ts`：可选 AI 运行时（`tags` 含 `ai` 时自动安装）
- `instant-os-protocol.ts`：消息类型与 manifest 结构

## 部署

将 `dist/` 目录部署到任意 HTTPS 静态托管，把 `instant-os.manifest.json` 的托管地址提供给 Instant OS 安装器即可。

---

**实验性 · 未完成**：外链应用平台（Bridge）仍是未完成的实验特性；协议、授权与安装路径可能继续变动，请勿当作稳定对外 API。
