/**
 * Instant 免费额度网关（Instant-demo-api Worker）客户端常量。
 * baseURL 指向网关的 OpenAI 兼容聊天补全端点：OpenAI SDK 拼接 /chat/completions
 * 后正好命中 `{网关}/v1/chat/completions`。URL 由网关按配置构造，客户端只传对外模型名。
 * 部署后把占位地址替换为真实 Worker URL。
 */
export const INSTANT_FREE_GATEWAY_ORIGIN = 'https://demo.api.casing-ai.com'

export const INSTANT_FREE_PROVIDER_BASE_URL = `${INSTANT_FREE_GATEWAY_ORIGIN}/v1`
