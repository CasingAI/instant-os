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
宿主会为所有微应用注入 OpenAI 兼容 API（fetch 与全局 OpenAI 构造函数），由系统账户代发请求并计入 AI 用量。
- 虚拟根地址：${GENERATED_APP_AI_BASE_URL}
- 支持一次性与流式：chat.completions.create({ stream: true }) 或 fetch POST /chat/completions
- apiKey 可填任意占位字符串；model 可省略，将使用系统默认模型
- 除 AI 调用外，仍禁止其他外网请求与 CDN
- 须在界面展示加载态与错误提示；流式输出请逐字更新 UI`

export function buildAppAiSystemPromptExtension(): string {
  return APP_STORE_AI_RUNTIME_SECTION
}

export function buildAppAiUserPromptSection(): string {
  return [
    '【AI 应用】',
    '应用需要在运行时调用大模型（对话、生成、分析等）。',
    `- 使用 OpenAI 兼容 API：new OpenAI({ baseURL: '${GENERATED_APP_AI_BASE_URL}' }) 或 fetch('${GENERATED_APP_AI_BASE_URL}/chat/completions', ...)`,
    '- 支持 stream: true 流式返回与一次性 JSON 返回',
    '- 为用户提供清晰输入区、结果区与错误/加载状态',
  ].join('\n')
}
