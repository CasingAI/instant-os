/**
 * 生产环境模型网关（Cloudflare Worker + R2）。
 * 线协议与免费 AI 网关相同：POST /pow/challenge → 求解 → GET 带 X-Pow-*。
 * 绑定对象是路径本身（UTF-8 字节），不是 JSON 请求体。
 */
export const MODEL_GATEWAY_ORIGIN = 'https://models.downloads.casing-ai.com'
