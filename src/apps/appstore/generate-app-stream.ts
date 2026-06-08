import { extractHtmlFromAiText } from '../../ai/parse-json-response.ts'
import { mergeOpenAiConfig } from '../../ai/openai-config.ts'
import { getOpenAiClient } from '../../ai/openai-client.ts'
import {
  buildAppGenerationPrompt,
  type AppGenerationContext,
} from './build-app-generation-prompt.ts'
import { ensureGeneratedAppTags } from '../generated/generated-app-tags.ts'
import { buildGeneratedAppTagPromptSection } from './generated-app-tag-prompt.ts'
import type { StoreListing } from './types.ts'

const GENERATED_APP_TAG_PROMPT = buildGeneratedAppTagPromptSection()

const APP_BUILDER_PROMPT = `你是 Instant OS 的微应用生成器。
根据应用名称、描述及可选的应用集市详情页信息，生成一个完整、可交互的单页 HTML 应用。

运行环境：应用内容渲染在 Instant OS 窗口的内容区内，窗口本身已有标题栏、圆角、边框和外阴影。
因此你生成的是「窗口内的原生应用界面」，不是桌面上的独立小组件卡片。

必须只返回 HTML 文档（可用 \`\`\`html 包裹），不要额外说明。
要求：
- 完整的 <!DOCTYPE html> 文档，所有 CSS 内联在 <style> 中
- 布局必须贴边铺满视口：html、body 设 margin:0;padding:0;width:100%;height:100%;box-sizing:border-box
- 主界面从内容区左上角铺满，不要在外层留空白、不要居中悬浮一块「应用卡片」
- 禁止为整个应用再套一层外层容器并加 margin/padding、border、box-shadow 或「浮在背景上的卡片」效果
- 拟物化风格只用于内部控件（按钮、工具栏、列表行、面板等），不要给应用外壳做二次窗口装饰
- 功能完整可用，包含真实交互（按钮、输入、计算、列表等）
- 若应用场景适合（如游戏、乐器、计时提醒、关键操作反馈等），可加入短音效增强体验；使用 Web Audio API 合成或内联 data URL，不要使用外部音频链接
- 不使用外部 CDN、图片 URL 或网络请求
- 不使用 alert/confirm/prompt
- 中文界面
- 需要持久化的用户数据（设置、列表、进度等）请使用 localStorage（键名自定，值必须是字符串，可用 JSON.stringify）
- 背景色或渐变应铺满整个视口，与 Instant OS 窗口内容区协调（如浅灰或与应用主题一致），不要留一圈未使用的画布边距

${GENERATED_APP_TAG_PROMPT}`

const APP_UPDATE_PROMPT = `你是 Instant OS 的微应用迭代工程师。
用户已安装某一版本的微应用，并提交了新的反馈。你需要在现有 HTML 源码基础上生成改进后的新版本。

运行环境：应用内容渲染在 Instant OS 窗口的内容区内，窗口本身已有标题栏、圆角、边框和外阴影。
因此你生成的是「窗口内的原生应用界面」，不是桌面上的独立小组件卡片。

必须只返回完整的新版 HTML 文档（可用 \`\`\`html 包裹），不要额外说明。
要求：
- 保留原应用的核心用途与视觉基调，在此基础上落实用户反馈
- 完整的 <!DOCTYPE html> 文档，所有 CSS 内联在 <style> 中
- 布局必须贴边铺满视口：html、body 设 margin:0;padding:0;width:100%;height:100%;box-sizing:border-box
- 主界面从内容区左上角铺满，不要在外层留空白、不要居中悬浮一块「应用卡片」
- 禁止为整个应用再套一层外层容器并加 margin/padding、border、box-shadow 或「浮在背景上的卡片」效果
- 功能完整可用，包含真实交互
- 若应用场景适合，可保留或补充短音效（Web Audio API 合成或内联 data URL，不要用外部音频链接）
- 不使用外部 CDN、图片 URL 或网络请求
- 不使用 alert/confirm/prompt
- 中文界面
- 需要持久化的用户数据请继续使用 localStorage（键名自定，值必须是字符串）
- 更新时保留或正确维护 <head> 中的 instant-app-tags；若改为 3D 界面须加 3d，若不再是 3D 须移除 3d

${GENERATED_APP_TAG_PROMPT}`

/** 约 18K 字符时进度接近 92%，使进度条移动更平缓 */
const EXPECTED_MAX_CHARS = 18 * 1000
const PROGRESS_START = 10
const PROGRESS_CAP = 92

export type AppGenerationPhase = 'waiting' | 'generating'

export type AppGenerationUpdate = {
  phase: AppGenerationPhase
  progress: number
  textLength: number
}

export function progressFromTextLength(textLength: number, generating: boolean): number {
  if (!generating) {
    return 0
  }

  if (textLength <= 0) {
    return PROGRESS_START
  }

  const ratio = Math.min(1, textLength / EXPECTED_MAX_CHARS)
  return PROGRESS_START + ratio * (PROGRESS_CAP - PROGRESS_START)
}

export async function generateAppHtmlStreaming(
  listing: StoreListing,
  onUpdate: (update: AppGenerationUpdate) => void,
  context: AppGenerationContext = {},
): Promise<string> {
  const config = mergeOpenAiConfig()
  const client = getOpenAiClient(config)
  const model = config.defaultModel
  const isUpdate = context.update !== undefined

  onUpdate({ phase: 'waiting', progress: 0, textLength: 0 })

  const stream = await client.chat.completions.create({
    model,
    stream: true,
    messages: [
      { role: 'system', content: isUpdate ? APP_UPDATE_PROMPT : APP_BUILDER_PROMPT },
      {
        role: 'user',
        content: buildAppGenerationPrompt(listing, context),
      },
    ],
  })

  let text = ''
  let generating = false
  let lastEmitAt = 0

  const emit = (force = false) => {
    const now = Date.now()
    if (!force && generating && now - lastEmitAt < 150) {
      return
    }
    lastEmitAt = now
    onUpdate({
      phase: generating ? 'generating' : 'waiting',
      progress: progressFromTextLength(text.length, generating),
      textLength: text.length,
    })
  }

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content ?? ''
    if (!delta) {
      continue
    }

    if (!generating) {
      generating = true
    }

    text += delta
    emit()
  }

  if (!text.trim()) {
    throw new Error('AI 未返回任何代码')
  }

  emit(true)
  return ensureGeneratedAppTags(extractHtmlFromAiText(text), {
    name: listing.name,
    description: listing.description,
    category: listing.category,
    tagline: context.detail?.tagline,
    longDescription: context.detail?.longDescription,
    tags: listing.tags,
  })
}
