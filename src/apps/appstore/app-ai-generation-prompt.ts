import { APP_CAPABILITY_TAG_AI, hasAppCapabilityTag } from './app-capability-tags.ts'
import { GENERATED_APP_AI_BASE_URL } from '../generated/generated-app-ai-types.ts'
import type { StoreListing, StoreListingDetail } from './types.ts'

export function resolveAppAiGenerationOptions(
  listing: StoreListing,
  _detail?: Partial<StoreListingDetail>,
  _existingHtml?: string,
): { isAi: boolean } {
  return { isAi: hasAppCapabilityTag(listing.tags, APP_CAPABILITY_TAG_AI) }
}

export const APP_STORE_AI_RUNTIME_SECTION = `【AI 运行时】
宿主为微应用注入 OpenAI 兼容 API（拦截 fetch + 全局 OpenAI 构造函数），由系统账户代发并计入 AI 用量。

调用方式：POST ${GENERATED_APP_AI_BASE_URL}/chat/completions，或 new OpenAI({ baseURL: '${GENERATED_APP_AI_BASE_URL}' }).chat.completions.create(...)

请求体规范（必须严格遵守）：
1. 只传 messages，以及可选的 stream、temperature、max_tokens、top_p、response_format
2. 禁止传 model、apiKey、thinking、stream_options——宿主强制使用系统全局配置
3. messages 为数组；每项仅含 role 与 content（字符串，非空）
4. role 只能是 system、user、assistant 三者之一：
   - 用户输入 → { role: "user", content: "..." }
   - 助手/AI 的历史回复 → { role: "assistant", content: "..." }（禁止 ai、bot、model 等自创 role）
   - 可选首条 { role: "system", content: "..." } 设定人设
5. 从聊天 UI 构造 messages 时：用户气泡映射 user，助手气泡映射 assistant

流式对话示例：
fetch('${GENERATED_APP_AI_BASE_URL}/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    messages: [
      { role: 'system', content: '你是简洁友好的中文助手' },
      { role: 'user', content: userText }
    ],
    stream: true
  })
})
// 解析 SSE：逐块读取 choices[0].delta.content 更新界面

非流式：省略 stream，读取 choices[0].message.content。

UI：须展示加载态与错误提示；流式输出逐字更新；除 AI 调用外禁止外网与 CDN。`

export function buildAppAiSystemPromptExtension(): string {
  return APP_STORE_AI_RUNTIME_SECTION
}

export function buildAppAiUserPromptSection(): string {
  return [
    '【AI 应用】',
    '应用需在运行时调用大模型（对话、生成、分析等）。',
    `- API：POST ${GENERATED_APP_AI_BASE_URL}/chat/completions 或注入的 OpenAI 客户端`,
    '- 请求体只含 messages（role 限 system / user / assistant）与可选 stream；禁止 model、thinking、stream_options',
    '- 聊天历史：用户气泡 → role "user"，助手气泡 → role "assistant"（禁止 role "ai"）',
    '- 提供输入区、结果区、加载与错误状态；推荐 stream: true 流式输出',
  ].join('\n')
}
