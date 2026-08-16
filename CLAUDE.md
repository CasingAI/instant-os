# AI 用量统计

全局 AI 用量**不是**在 OpenAI SDK 层统一劫持的，而是各调用点显式接入。新增或修改 AI 请求时，先确认该路径是否已计入统计；漏接则不会出现在「AI 用量」里，且通常不会报错。

具体接入方式、调用点清单、存储位置等，动手前自行在代码库里调查。

# pnpm

本项目使用pnpm进行包管理

# Debug 模式

以 Dev 形式启动时，URL 加 `?debug=1` 可进入 Debug 模式（可选 `&cmd=<URL编码的JS>` 指定启动命令）。

- 仅 dev 构建生效（`import.meta.env.DEV` 硬开关），生产构建（`pnpm build` / `pnpm preview`）不生效。
- 绕过初始化直接进桌面；每次启动都弹全局警告框，确认后才进桌面并执行 `cmd`，取消则清理 URL 参数回退正常流程。
- 进桌面后通过 `openApp('terminal', { bootCommand })` 在系统终端执行 `cmd`。
- env 预置配置（`.env` / `.env.example`）：`VITE_DEBUG_OPENAI_API_KEY/BASE_URL/MODEL/PROXY`。钥匙串未配置时这些值会作为默认值播种写入钥匙串（`src/os/debug-env-seed.ts`）；钥匙串已配置时以钥匙串为准，忽略 env。普通 `VITE_OPENAI_*` 仅在两者皆无时兜底。
- 默认 provider `opencode-go`（`https://opencode.ai/zen/go/v1`，模型 `grok-4.5`），强制走代理。
- 代理：`VITE_DEBUG_OPENAI_PROXY` 可取 `shared` / `off` / 自定义 Worker URL；未设置时沿用系统代理设置，若系统也未开启则兜底 Instant 共享代理。