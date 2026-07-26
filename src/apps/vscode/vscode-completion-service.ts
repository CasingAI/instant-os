import { isStreamAbortError } from '../../ai/stream-abort.ts'
import { streamChatCompletion } from '../../ai/stream-chat.ts'
import { hasOpenAiApiKey } from '../../ai/openai-config.ts'
import { openAiConfigForVscodeAiModelKey } from './vscode-ai-models.ts'

const MAX_BEFORE_CHARS = 4000
const MAX_AFTER_CHARS = 1200
const MAX_COMPLETION_TOKENS = 256
const MAX_COMPLETION_LINES = 10

const COMPLETION_SYSTEM_PROMPT = `你是代码补全引擎（fill-in-the-middle）：只输出应插入「光标位置」的后缀代码。

硬性规则：
- 只输出光标处尚未写出的内容；不要重复「光标前」已有的任何字符（含标识符、关键字、空格）
- 例如光标前是 "const startTime"，应输出 " = Date.now()"，而不是 "const startTime = Date.now()"
- 不输出解释、注释说明、markdown 代码块或其它包裹
- 根据光标前后代码推断意图，保持缩进与语言语法一致
- 若逻辑上应换行（如 Markdown 标题/段落结束、语句块结束），后缀以 \\n 开头；否则优先补全当前行
- 最多 ${MAX_COMPLETION_LINES} 行
- 如果不确定或不需要补全，返回空`

export type VscodeCompletionRequest = {
  beforeCursor: string
  afterCursor: string
  language: string
  filePath: string
  modelKey?: string | undefined
  signal?: AbortSignal
  onFirstToken?: () => void
}

export type VscodeCompletionResult = {
  text: string
}

function sliceTail(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return text.slice(text.length - maxChars)
}

function sliceHead(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars)
}

function stripCodeFences(text: string): string {
  // 保留行首换行与缩进；仅去掉尾部空白与 markdown 围栏
  let next = text.replace(/\s+$/, '')
  if (next.startsWith('```')) {
    next = next.replace(/^```[^\n]*\n?/, '')
    next = next.replace(/\n?```\s*$/, '')
    next = next.replace(/\s+$/, '')
  }
  return next
}

/** 保留「下一行继续」所需的 leading \\n；去掉模型多余空行或光标已在行首时的冗余换行 */
export function normalizeCompletionLeadingNewline(
  beforeCursor: string,
  completion: string,
): string {
  if (!completion) return completion

  let text = completion.replace(/^\n{2,}/, '\n')
  if (beforeCursor.endsWith('\n') && text.startsWith('\n')) {
    text = text.slice(1)
  }
  return text
}

/** 模型未输出换行但后缀明显是新块（如 Markdown 列表）时，补一个 leading \\n */
export function ensureBlockStartsOnNewLine(
  beforeCursor: string,
  completion: string,
): string {
  if (!completion || completion.startsWith('\n') || beforeCursor.endsWith('\n')) {
    return completion
  }
  if (/^(\s*[-*+] |\s*\d+\. |\s*> )/.test(completion)) {
    return `\n${completion}`
  }
  return completion
}

/**
 * 去掉 completion 与 beforeCursor 尾部的最长公共前缀重叠。
 * 模型常把当前行已有内容一并吐出，例如 before=`const startTime`、completion=`const startTime = 1`。
 */
export function stripCompletionPrefixOverlap(beforeCursor: string, completion: string): string {
  if (!completion || !beforeCursor) return completion

  const max = Math.min(beforeCursor.length, completion.length)
  for (let len = max; len > 0; len -= 1) {
    if (completion.startsWith(beforeCursor.slice(-len))) {
      return completion.slice(len)
    }
  }
  return completion
}

/** 去掉 completion 与 afterCursor 头部完全重合的无意义复读 */
export function stripCompletionAfterEcho(afterCursor: string, completion: string): string {
  if (!completion || !afterCursor) return completion
  if (afterCursor.startsWith(completion)) return ''
  // 若 completion 以 after 的前缀开头且更长，保留多出来的后缀（少见）
  const max = Math.min(afterCursor.length, completion.length)
  for (let len = max; len > 0; len -= 1) {
    if (completion.startsWith(afterCursor.slice(0, len)) && len === completion.length) {
      return ''
    }
  }
  return completion
}

function sanitizeCompletionText(
  raw: string,
  beforeCursor: string,
  afterCursor: string,
): string {
  let text = stripCodeFences(raw)
  text = stripCompletionPrefixOverlap(beforeCursor, text)
  text = stripCompletionAfterEcho(afterCursor, text)
  text = normalizeCompletionLeadingNewline(beforeCursor, text)
  text = ensureBlockStartsOnNewLine(beforeCursor, text)
  const lines = text.split('\n')
  if (lines.length > MAX_COMPLETION_LINES) {
    text = lines.slice(0, MAX_COMPLETION_LINES).join('\n')
  }
  return text
}

function buildUserPrompt(request: VscodeCompletionRequest): string {
  const before = sliceTail(request.beforeCursor, MAX_BEFORE_CHARS)
  const after = sliceHead(request.afterCursor, MAX_AFTER_CHARS)
  return [
    `语言：${request.language || 'plaintext'}`,
    `文件：${request.filePath || '(untitled)'}`,
    '',
    '请只输出插入「<<<CURSOR>>>」位置的后缀，不要重复 PREFIX。',
    '',
    '<<<PREFIX>>>',
    before,
    '<<<CURSOR>>>',
    '<<<SUFFIX>>>',
    after,
    '<<<END>>>',
  ].join('\n')
}

export async function completeVscodeCode(
  request: VscodeCompletionRequest,
): Promise<VscodeCompletionResult> {
  if (!hasOpenAiApiKey()) {
    return { text: '' }
  }
  if (request.signal?.aborted) {
    return { text: '' }
  }

  const before = request.beforeCursor
  if (!/\S/.test(before)) {
    return { text: '' }
  }

  let sawFirstToken = false
  const config = openAiConfigForVscodeAiModelKey(request.modelKey)

  try {
    const raw = await streamChatCompletion({
      system: COMPLETION_SYSTEM_PROMPT,
      user: buildUserPrompt(request),
      config,
      thinkingEnabled: false,
      maxCompletionTokens: MAX_COMPLETION_TOKENS,
      allowEmpty: true,
      allowTruncation: true,
      signal: request.signal,
      usageContext: {
        actor: 'vscode',
        behavior: 'completion',
        actorLabel: 'Virtual Studio Code',
        behaviorLabel: '代码补全',
      },
      onChunk: () => {
        if (!sawFirstToken) {
          sawFirstToken = true
          request.onFirstToken?.()
        }
      },
      onStreamActivity: () => {
        if (!sawFirstToken) {
          sawFirstToken = true
          request.onFirstToken?.()
        }
      },
    })

    return {
      text: sanitizeCompletionText(raw, request.beforeCursor, request.afterCursor),
    }
  } catch (error) {
    if (isStreamAbortError(error, request.signal)) {
      return { text: '' }
    }
    // 网络/模型错误静默失败，不打扰编辑
    return { text: '' }
  }
}
