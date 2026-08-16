/**
 * Instant 免费额度网关（Instant-demo-api Worker）客户端常量。
 * baseURL 走网关的 /-----{absolute} 转发协议：OpenAI SDK 拼接 /chat/completions
 * 后正好命中 `{网关}/-----https://opencode.ai/zen/v1/chat/completions`。
 * 免费模型（big-pickle / deepseek-v4-flash-free 等）位于 zen/v1 端点；
 * 付费模型（grok/glm/kimi 等）在 zen/go/v1，走 opencode-go 供应商。
 * 部署后把占位地址替换为真实 Worker URL。
 */
export const INSTANT_FREE_GATEWAY_ORIGIN = 'https://instant-demo-api.r6sg.workers.dev'

export const INSTANT_FREE_UPSTREAM_BASE_URL = 'https://opencode.ai/zen/v1'

export const INSTANT_FREE_PROVIDER_BASE_URL = `${INSTANT_FREE_GATEWAY_ORIGIN}/-----${INSTANT_FREE_UPSTREAM_BASE_URL}`
