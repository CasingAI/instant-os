/**
 * SRML 标签 DSL —— 自定义标签语言，取代 Provider 原生 tool call / 结构化输出。
 *
 * 用户侧（请求）：一个请求可同时包含多个 <|begin_of_prompt_N|> 块（Fork 语义），
 * 每个 prompt 内可嵌套 <|begin_of_thought_effort_N|> 指定思考强度。
 * 模型侧（回复）：为每个 prompt 输出一个 <|begin_of_task_N|> 块，任务内是
 * <begin_of_thought>（推理）与 <begin_of_response_N>（最终回复）的交替序列——
 * thinking 直接打包在 DSL 里，随流式输出一起可见。
 */

export type SrmlThoughtEffort = 'low' | 'medium' | 'high' | 'max'

export type SrmlPromptBlock = {
  kind: 'prompt'
  /** 请求编号（<|begin_of_prompt_N|> 的 N） */
  id: number
  /** prompt 正文（不含标签与思考强度标签） */
  content: string
  /** 思考强度（来自 <|begin_of_thought_effort_N|>，raw 值） */
  thoughtEffort?: string
}

export type SrmlSegment =
  | { kind: 'thought'; content: string }
  | { kind: 'response'; id: number; content: string }

export type SrmlTaskBlock = {
  kind: 'task'
  /** 任务编号（<|begin_of_task_N|> 的 N，应与对应 prompt 一致） */
  id: number
  segments: SrmlSegment[]
}

export type SrmlBlock = SrmlPromptBlock | SrmlTaskBlock

export type SrmlParseWarningCode =
  | 'unexpected-close'
  | 'id-mismatch'
  | 'missing-id'
  | 'auto-open-task'
  | 'unclosed-segment'
  | 'nested-open'
  | 'loose-text'
  | 'orphan-tag'

export type SrmlParseWarning = {
  code: SrmlParseWarningCode
  message: string
}

export class SrmlParseError extends Error {
  readonly warnings: SrmlParseWarning[]

  constructor(message: string, warnings: SrmlParseWarning[] = []) {
    super(message)
    this.name = 'SrmlParseError'
    this.warnings = warnings
  }
}

/** 流式解析的中间态：一个未闭合的块及其内部进度 */
export type SrmlPartialState =
  | {
      open: 'prompt'
      id: number
      content: string
      thoughtEffort?: string
    }
  | {
      open: 'task'
      id: number
      /** 已闭合的段 */
      segments: SrmlSegment[]
      /** 当前打开的段（内容仍在累积） */
      segment: SrmlSegment | null
      /** 任务标签内、第一个段标签之前的文本（通常是空白/杂质） */
      loose: string
    }

export type SrmlStreamParseResult = {
  /** 已完整闭合的块（prompt / task，按出现顺序） */
  blocks: SrmlBlock[]
  partial: SrmlPartialState | null
  warnings: SrmlParseWarning[]
}

export type SrmlDocumentParseResult = {
  blocks: SrmlBlock[]
  /** 收尾时未闭合的块（引擎容错接受） */
  partial: SrmlPartialState | null
  warnings: SrmlParseWarning[]
  /** 归一化重渲染的 DSL 文本（修复标签后），供 UI 对比 */
  normalized: string
}

function serializeThoughtEffort(id: number, effort: string): string {
  const value = effort.trim()
  if (!value) return ''
  return `\n<|begin_of_thought_effort_${id}|>\n${value}\n<|end_of_thought_effort_${id}|>`
}

export function serializePromptBlock(block: SrmlPromptBlock): string {
  const effort = block.thoughtEffort
    ? serializeThoughtEffort(block.id, block.thoughtEffort)
    : ''
  return [
    `<|begin_of_prompt_${block.id}|>`,
    effort.trimStart(),
    block.content.trim(),
    `<|end_of_prompt_${block.id}|>`,
  ]
    .filter((line) => line !== '')
    .join('\n')
}

export function serializeTaskBlock(block: SrmlTaskBlock): string {
  const segments = block.segments.map((segment) => {
    if (segment.kind === 'thought') {
      return `<begin_of_thought>\n${segment.content.trim()}\n<end_of_thought>`
    }
    return `<begin_of_response_${segment.id}>\n${segment.content.trim()}\n<end_of_response_${segment.id}>`
  })
  return [
    `<|begin_of_task_${block.id}|>`,
    ...segments,
    `<|end_of_task_${block.id}|>`,
  ].join('\n')
}

export function serializeBlocks(blocks: SrmlBlock[]): string {
  return blocks
    .map((block) => (block.kind === 'prompt' ? serializePromptBlock(block) : serializeTaskBlock(block)))
    .join('\n\n')
}
