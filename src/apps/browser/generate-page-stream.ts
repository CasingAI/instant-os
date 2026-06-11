import { extractHtmlFromAiText } from '../../ai/parse-json-response.ts'
import { buildThinkingRequestExtras, readStreamDelta } from '../../ai/ai-thinking.ts'
import { recordAiTokenUsage } from '../../ai/ai-token-usage.ts'
import { mergeOpenAiConfig } from '../../ai/openai-config.ts'
import { getOpenAiClient } from '../../ai/openai-client.ts'
import type { TokenUsageSnapshot } from './browser-token-usage.ts'
import {
  buildLiveTokenUsage,
  estimatePromptTokens,
  finalizeTokenUsage,
  type LiveTokenUsage,
} from './estimate-token-usage.ts'
import {
  extractPartialHtmlFromStream,
  extractTitleFromPartialHtml,
  stabilizePartialHtml,
} from './extract-partial-html.ts'
import { describeBrowserUrl } from './normalize-browser-url.ts'

function formatCurrentDateContext(): string {
  const now = new Date()
  const date = now.toLocaleDateString('zh-CN', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  const time = now.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })
  return `${date} ${time}`
}

const PAGE_BUILDER_PROMPT = `你是 Instant OS 网络浏览器的网页生成器。你的首要目标是**尽可能逼真地还原**目标 URL 在真实浏览器中打开后的页面——让用户一眼就能认出是哪个网站、哪类页面。

## 运行环境
Instant OS 内置网络浏览器。你生成的 HTML 渲染在 iframe 内（约 320~900px 宽）。
浏览器外壳（地址栏、前进后退）由系统提供——不要绘制浏览器 UI。

## 核心原则：高保真静态快照，不要伪装导航
- 生成**高保真静态 HTML**，布局、配色、字体气质应接近真实站点，而非通用模板
- 页面应像「这一 URL 在真实浏览器中加载完成后的最终静态结果」，不是 SPA 过渡态
- **禁止**加载动画、Spinner、「正在搜索…」、进度条、setTimeout 模拟跳转
- **禁止**用 JS 隐藏/显示页面来假装发生了导航——所有跳转由系统接管

## 导航与表单（重要）
Instant OS **从外部**拦截链接与表单，跳转到真实 URL 后由 AI 重新生成——**不要写任何 JS**。
- 搜索：\`<form action="https://域名/search" method="get">\`，input 的 name 必须是 \`q\`
- 所有跳转用 \`<a href="https://完整绝对URL">\`；**禁止** target="_blank"、onclick、window.open、button 跳转
- 按钮外观用 \`<a class="btn" href="https://...">\` 实现
- Google 首页必须有 action="https://www.google.com/search" method="get" 的搜索表单
- 禁止 \`<script>\` 标签（系统会注入导航桥，AI 不要写脚本）

## 样式与流式输出顺序（重要——让首屏尽快可见）
**禁止**在 <head> 里先写大段 <style> 再输出 body——那样流式渲染时长时间空白。
正确顺序：
1. \`<!DOCTYPE html><html><head>\` 只放 charset、viewport、title（不超过 5 行）
2. **立刻** \`<body>\` 并输出可见内容；首屏关键元素用 **inline style** 带上站点主色、字号、间距，保证流式阶段也接近最终观感
3. 在 \`</body>\` 前再放完整 \`<style>\` 块（详细 CSS 放 body 末尾，不要放 head）
4. **不要**写 <script>（Tab 切换等交互尽量用纯 CSS :target，或展示默认激活态）

## 输出格式
必须只返回 HTML 文档，回复第一行必须是 \`<!DOCTYPE html>\`。
- html、body 设 margin:0;padding:0;width:100%;min-height:100%;box-sizing:border-box

## 高保真还原（极其重要）
根据域名与路径，还原该站**真实页面**的典型结构与视觉语言：

### 布局与信息架构
- 还原真实站点的**页面骨架**：顶栏/侧栏/主内容/页脚、面包屑、Tab、卡片网格、列表行等
- 导航栏应包含该站常见的入口链接（如首页、分类、登录、购物车等），文案与真实站点一致
- 内容密度与留白接近真实页面，避免「演示稿」式的空旷或堆砌

### 品牌与视觉
- **精确使用**目标站点的品牌色（如 Google 蓝 #4285F4、红 #EA4335、GitHub 深色 #0d1117、Amazon 橙等）
- 字体栈贴近站点气质：科技站用系统无衬线、新闻站偏衬线标题、代码站等宽字体
- Logo 用 CSS 渐变、字标、inline SVG 或 Emoji 组合**复刻辨识度**，不要只用纯文字站名
- 按钮、输入框、卡片、标签的圆角、边框、阴影、hover 态（:hover）应匹配站点设计语言
- 不用外部图片/CDN/@import/fetch；图标用 inline SVG 或 Unicode 符号

### 知名站点速查（按 URL 匹配，尽量还原其经典界面）
- **Google**：居中 Logo + 圆角搜索框 + 双按钮；结果页左侧结果列表 + 绿色 URL + 摘要
- **GitHub**：深色/浅色顶栏、Octocat 区域、仓库列表、README 风格、绿色 Merge 按钮色
- **Amazon**：顶栏搜索 + 导航条、商品卡片、星级、价格红色、Prime 标签
- **Wikipedia**：左侧信息框、正文栏、目录、引用角标风格
- **Twitter/X、Reddit、YouTube、淘宝、京东、百度**等：还原其标志性的顶栏、信息流、卡片样式

### 内容与文案
- 文案具体、可信、符合页面语境，**禁止** Lorem ipsum 与明显 AI 腔
- 搜索结果 6~10 条，含标题、绿色/灰色 URL、两行摘要，排序与关键词相关
- 商品/新闻/帖子类内容应有真实感的标题、价格、时间、作者、缩略图占位（CSS 色块或 SVG）

## 页面类型与上下文
根据 URL 推断页面类型：搜索引擎首页/结果页、电商、社交、新闻、百科、代码托管、企业官网等。
若 URL 含 ?q= 或 /search，生成**搜索结果页**而非首页。
若用户从**同站点**上一页跳转而来，**严格延续**来源页的布局、配色、组件样式与 class 命名习惯。
若打开**新站点**的子页面，会提供该站点**根目录首页**的缓存 HTML——从中提取配色、字体、顶栏结构并应用到当前页。

## 当前日期（极其重要）
用户消息会给出**当前真实日期与时间**。页面内容必须与该日期一致：
- 新闻/资讯类：使用符合该日期的标题、时间戳与「今日」「最新」表述
- 页脚版权年份、活动截止日期、天气/季节描述须与当前日期匹配
- **禁止**使用过时年份或虚构日期；若需显示时间，以用户提供的当前日期为准`

export type PageGenerationContext = {
  url: string
  referrerUrl?: string
  referrerHtml?: string
  siteRootUrl?: string
  siteRootHtml?: string
}

export type PageGenerationUpdate = {
  html: string
  rawText: string
  reasoningText: string
  title: string | undefined
  textLength: number
  usage: LiveTokenUsage
}

export type PageGenerationResult = {
  html: string
  usage: TokenUsageSnapshot | undefined
}

const HTML_EMIT_INTERVAL_MS = 150
const RAW_EMIT_INTERVAL_MS = 48
const REFERRER_HTML_MAX_CHARS = 8000
const SITE_ROOT_HTML_MAX_CHARS = 8000

function truncateReferenceHtml(html: string, maxChars: number): string {
  if (html.length <= maxChars) {
    return html
  }
  return `${html.slice(0, maxChars)}\n<!-- 参考 HTML 已截断 -->`
}

function buildPageUserPrompt(context: PageGenerationContext): string {
  const url = context.url
  const described = describeBrowserUrl(url)

  if (!described) {
    return `【当前日期与时间】${formatCurrentDateContext()}\n请确保页面日期与当前日期一致。\n\n网址：${url}\n请高保真还原该 URL 在真实浏览器中打开后的页面 HTML，让用户能一眼认出目标网站。`
  }

  const lines = [
    `【当前日期与时间】${formatCurrentDateContext()}`,
    '请确保页面内所有日期、时间、版权年份、新闻时效与上述当前日期一致。',
    '',
    `完整网址：${described.url}`,
    `协议：${described.protocol}`,
    `域名：${described.hostname}`,
    `路径：${described.pathname || '/'}`,
  ]

  if (described.search) {
    lines.push(`查询参数：${described.search}`)
  }
  if (described.isSearchResults && described.searchQuery) {
    lines.push(
      `页面类型：搜索结果页`,
      `搜索关键词：「${described.searchQuery}」`,
      `请还原该搜索引擎真实的结果页布局（顶栏搜索框 + 结果列表），生成 6~10 条与关键词相关的逼真结果，含标题、URL、摘要。`,
    )
  }

  lines.push(
    '',
    `目标站点：${described.hostname}`,
    `请根据你对「${described.hostname}」的真实了解，还原其典型页面视觉与信息架构。`,
  )

  if (context.referrerUrl && context.referrerHtml) {
    lines.push(
      `同站点来源页 URL：${context.referrerUrl}`,
      '同站点来源页 HTML（必须严格延续其 CSS 变量、配色、顶栏结构、字体与组件样式；生成当前 URL 对应的新页面内容，不要整页复制）：',
      truncateReferenceHtml(context.referrerHtml, REFERRER_HTML_MAX_CHARS),
    )
  } else if (context.siteRootUrl && context.siteRootHtml) {
    lines.push(
      `站点根目录 URL：${context.siteRootUrl}`,
      '站点根目录首页 HTML（当前为新站点子页面，从中提取品牌色、Logo 样式、顶栏与页脚结构，应用到当前 URL 页面，不要整页复制）：',
      truncateReferenceHtml(context.siteRootHtml, SITE_ROOT_HTML_MAX_CHARS),
    )
  }

  lines.push(
    '',
    '请生成高保真、静态、可浏览的最终页面 HTML，力求让用户误以为打开了真实网站。先输出 body 可见内容（inline style 带主色），完整样式放 body 末尾。不要写任何 JS。',
  )

  return lines.join('\n')
}

function createSafariAiLogger(url: string) {
  const tag = `[网络浏览器 AI] ${url}`

  return {
    start(model: string, userPrompt: string) {
      console.log(tag, 'stream start', { model, userPrompt })
    },
    delta(piece: string) {
      console.log(tag, 'delta', piece)
    },
    finish(reason: string | undefined) {
      console.log(tag, 'finish', reason ?? '(none)')
    },
    complete(raw: string, html: string, usage: TokenUsageSnapshot | undefined) {
      console.log(tag, 'raw response', raw)
      console.log(tag, 'extracted html', html)
      console.log(tag, 'usage', usage)
    },
    error(error: unknown) {
      console.error(tag, 'error', error)
    },
  }
}

function snapshotFromUsage(usage: OpenAIUsage | undefined): TokenUsageSnapshot | undefined {
  if (!usage) {
    return undefined
  }

  return {
    promptTokens: usage.prompt_tokens ?? 0,
    completionTokens: usage.completion_tokens ?? 0,
    totalTokens: usage.total_tokens ?? 0,
  }
}

// OpenAI types via import - check if we need to use inline type
type OpenAIUsage = {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

export async function generatePageHtmlStreaming(
  context: PageGenerationContext,
  onUpdate: (update: PageGenerationUpdate) => void,
): Promise<PageGenerationResult> {
  const config = mergeOpenAiConfig()
  const client = getOpenAiClient(config)
  const model = config.defaultModel
  const userPrompt = buildPageUserPrompt(context)
  const log = createSafariAiLogger(context.url)
  const promptTokenEstimate = estimatePromptTokens(PAGE_BUILDER_PROMPT, userPrompt)

  let text = ''
  let reasoningText = ''
  let lastHtml = ''
  let lastHtmlEmitAt = 0
  let lastRawEmitAt = 0
  let lastUsageEmitAt = 0
  let usage: TokenUsageSnapshot | undefined
  let liveUsage = buildLiveTokenUsage(promptTokenEstimate, '')

  const emit = (force = false) => {
    const now = Date.now()
    const extracted = extractPartialHtmlFromStream(text)
    const stabilized = extracted ? stabilizePartialHtml(extracted) : ''

    const htmlDue =
      force ||
      (stabilized &&
        stabilized !== lastHtml &&
        now - lastHtmlEmitAt >= HTML_EMIT_INTERVAL_MS)
    const rawDue = force || now - lastRawEmitAt >= RAW_EMIT_INTERVAL_MS
    const usageDue = force || now - lastUsageEmitAt >= RAW_EMIT_INTERVAL_MS

    if (!htmlDue && !rawDue && !usageDue) {
      return
    }

    if (htmlDue && stabilized) {
      lastHtml = stabilized
      lastHtmlEmitAt = now
    }

    if (rawDue) {
      lastRawEmitAt = now
    }

    if (usageDue) {
      liveUsage = buildLiveTokenUsage(promptTokenEstimate, text, !usage)
      lastUsageEmitAt = now
    }

    onUpdate({
      html: lastHtml,
      rawText: text,
      reasoningText,
      title: lastHtml ? extractTitleFromPartialHtml(lastHtml) : undefined,
      textLength: text.length + reasoningText.length,
      usage: liveUsage,
    })
  }

  onUpdate({
    html: '',
    rawText: '',
    reasoningText: '',
    title: undefined,
    textLength: 0,
    usage: liveUsage,
  })

  try {
    log.start(model, userPrompt)

    const stream = await client.chat.completions.create({
      model,
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: 'system', content: PAGE_BUILDER_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      ...buildThinkingRequestExtras(config.providerId, config.thinkingEnabled),
    })

    for await (const chunk of stream) {
      const choice = chunk.choices[0]
      const { reasoning, content } = readStreamDelta(choice?.delta)

      if (chunk.usage) {
        usage = snapshotFromUsage(chunk.usage)
      }

      if (reasoning) {
        reasoningText += reasoning
        emit()
        continue
      }

      if (!content) {
        if (choice?.finish_reason) {
          log.finish(choice.finish_reason)
        }
        continue
      }

      log.delta(content)
      text += content
      emit()
    }

    if (!text.trim()) {
      throw new Error('AI 未返回任何网页内容')
    }

    emit(true)
    liveUsage = finalizeTokenUsage(liveUsage, usage)
    const html = stabilizePartialHtml(extractHtmlFromAiText(text))
    onUpdate({
      html,
      rawText: text,
      reasoningText,
      title: extractTitleFromPartialHtml(html) ?? undefined,
      textLength: text.length + reasoningText.length,
      usage: liveUsage,
    })
    const finalUsage = usage ?? {
      promptTokens: liveUsage.promptTokens,
      completionTokens: liveUsage.completionTokens,
      totalTokens: liveUsage.totalTokens,
    }
    recordAiTokenUsage(
      { actor: 'browser', behavior: 'generate-page', behaviorLabel: '生成网页' },
      usage,
    )
    log.complete(text, html, finalUsage)
    return { html, usage: finalUsage }
  } catch (error) {
    log.error(error)
    throw error
  }
}
