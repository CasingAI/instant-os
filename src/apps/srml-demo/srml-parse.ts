/**
 * SRML 标签 DSL 解析器：模型输出 → 块序列（流式，边生成边解析）。
 *
 * 标签集合：
 *   <|begin_of_prompt_N|> / <|end_of_prompt_N|>                 用户请求块
 *   <|begin_of_thought_effort_N|> / <|end_of_thought_effort_N|>  思考强度（嵌套在 prompt 内）
 *   <|begin_of_task_N|> / <|end_of_task_N|>                     模型任务块
 *   <begin_of_thought> / <end_of_thought>                       推理段
 *   <begin_of_response_N> / <end_of_response_N>                 回复段
 *   <|begin_of_tool_call|> / <|end_of_tool_call|>               工具调用段（模型输出）
 *
 * 容错（对应已知失败模式）：
 * - 标签不区分大小写，容忍 `<| / < / </`、标签内多余空格
 * - 缺 <|begin_of_task|> 包裹但直接出现 thought/response → 自动开启任务
 * - 段标签未闭合就切换/闭合 → 自动补闭合，记 warning
 * - 闭合标签（end_of_*）一律忽略编号，按栈语义闭合；begin_of_response 编号可选（省略=当前任务）
 * - tool_call 内容解析不出 名称/参数 → 整块保留原文展示，记 warning，引擎不执行
 * - 标签外文本 → 记 warning，不中断解析
 * - 解析到底仍有未闭合块 → partial（流式中间态），最终解析时容错收尾
 */
import {
  SrmlParseError,
  serializeBlocks,
  type SrmlBlock,
  type SrmlDocumentParseResult,
  type SrmlParseWarning,
  type SrmlPromptBlock,
  type SrmlSegment,
  type SrmlStreamParseResult,
  type SrmlTaskBlock,
} from './srml-dsl.ts'

// 顺序：长的标签名在前（thought_effort 先于 thought），避免前缀误吞
const TAG_PATTERN =
  /<\|?\/?\s*(begin_of_prompt|end_of_prompt|begin_of_task|end_of_task|begin_of_thought_effort|end_of_thought_effort|begin_of_thought|end_of_thought|begin_of_response|end_of_response|begin_of_tool_call|end_of_tool_call|begin_of_expect|end_of_expect)(?:_(\d+))?\s*\|?>/gi

/**
 * 从 tool_call 段原始文本解析 名称 / 参数（整块 JSON，OpenAI function calling 风格）。
 * arguments 支持两种形态：嵌套对象（模型友好）或字符串（OpenAI 兼容），统一存为 JSON 文本。
 * 解析不出返回 null（整块作废保留原文）。
 */
function parseToolCallText(text: string): { name: string; arguments: string } | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (parsed === null || typeof parsed !== 'object') return null
    const name = (parsed as { name?: unknown }).name
    if (typeof name !== 'string' || !name.trim()) return null
    const argsRaw = (parsed as { arguments?: unknown }).arguments
    const argsText =
      typeof argsRaw === 'string'
        ? argsRaw
        : argsRaw === undefined
          ? '{}'
          : JSON.stringify(argsRaw)
    return { name: name.trim(), arguments: argsText }
  } catch {
    return null
  }
}

/** 解析 expect 标签内容：合法 JSON 返回解析值（数字/对象等），否则原样返回字符串 */
function parseExpectValue(raw: string): unknown {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return trimmed
  }
}

type OpenPrompt = {
  id: number
  content: string
  effort?: string
  inEffort: boolean
}

type OpenSegment = SrmlSegment & {
  content: string
  /** expect 子段内容累积中（undefined = 不在 expect 子段内，仅 tool-call 段使用） */
  expectContent?: string
}

type OpenTask = {
  id: number
  segments: SrmlSegment[]
  current: OpenSegment | null
  loose: string
}

export function parseSrmlStreamChunk(rawText: string): SrmlStreamParseResult {
  const warnings: SrmlParseWarning[] = []
  const blocks: SrmlBlock[] = []
  let prompt: OpenPrompt | null = null
  let task: OpenTask | null = null
  let loose = ''
  let maxId = 0

  const warn = (code: SrmlParseWarning['code'], message: string): void => {
    warnings.push({ code, message })
  }

  const nextId = (): number => {
    maxId += 1
    return maxId
  }

  const noteId = (id: number): void => {
    if (id > maxId) maxId = id
  }

  const parseId = (tagName: string, idRaw: string | undefined, auto: boolean): number => {
    if (idRaw === undefined || !/^\d+$/.test(idRaw)) {
      warn('missing-id', `${tagName} 标签缺少编号，已自动分配`)
      return auto ? nextId() : NaN
    }
    const id = Number(idRaw)
    if (auto) noteId(id)
    return id
  }

  const pushSegment = (): void => {
    if (!task?.current) return
    const current = task.current
    if (current.kind === 'thought') {
      task.segments.push({ kind: 'thought', content: current.content.trim() })
    } else if (current.kind === 'response') {
      task.segments.push({ kind: 'response', id: current.id, content: current.content.trim() })
    } else {
      const parsed = parseToolCallText(current.content)
      if (!parsed) {
        warn(
          'tool-call-unparseable',
          `任务 ${task.id} 的 <|begin_of_tool_call|> 解析不出名称/参数，整块作为文本保留，不执行`,
        )
        task.segments.push({ kind: 'tool-call', name: '', arguments: current.content.trim() })
      } else {
        // expected 来自 expect 子标签：已闭合取 current.expected；未闭合（容错收尾）取累积文本
        const expected =
          current.expected !== undefined
            ? current.expected
            : current.expectContent !== undefined
              ? parseExpectValue(current.expectContent)
              : undefined
        task.segments.push({
          kind: 'tool-call',
          name: parsed.name,
          arguments: parsed.arguments,
          ...(expected !== undefined ? { expected } : {}),
        })
      }
    }
    task.current = null
  }

  const closeTask = (): void => {
    if (!task) return
    if (task.current) {
      warn('unclosed-segment', `任务 ${task.id} 结束时 <begin_of_thought>/<begin_of_response> 未闭合，已自动补闭合`)
      pushSegment()
    }
    blocks.push({ kind: 'task', id: task.id, segments: task.segments })
    noteId(task.id)
    task = null
  }

  const closePrompt = (): void => {
    if (!prompt) return
    if (prompt.inEffort) {
      prompt.inEffort = false
      prompt.effort = prompt.effort?.trim()
    }
    const block: SrmlPromptBlock = {
      kind: 'prompt',
      id: prompt.id,
      content: prompt.content.trim(),
    }
    if (prompt.effort) block.thoughtEffort = prompt.effort
    blocks.push(block)
    noteId(prompt.id)
    prompt = null
  }

  const emit = (text: string): void => {
    if (task?.current) {
      // tool-call 段内：expect 子段累积到 expectContent，其余进 content
      if (task.current.kind === 'tool-call' && task.current.expectContent !== undefined) {
        task.current.expectContent += text
      } else {
        task.current.content += text
      }
    } else if (task) {
      task.loose += text
    } else if (prompt && prompt.inEffort) {
      prompt.effort = (prompt.effort ?? '') + text
    } else if (prompt) {
      prompt.content += text
    } else {
      loose += text
    }
  }

  let cursor = 0
  TAG_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = TAG_PATTERN.exec(rawText)) !== null) {
    const [full, nameRaw, idRaw] = match
    emit(rawText.slice(cursor, match.index))
    cursor = match.index + full.length
    const name = nameRaw.toLowerCase()

    switch (name) {
      case 'begin_of_prompt': {
        if (task) closeTask()
        if (prompt) {
          warn('nested-open', '前一个 <|begin_of_prompt|> 未闭合，已自动闭合')
          closePrompt()
        }
        const id = parseId('<|begin_of_prompt|>', idRaw, true)
        prompt = { id, content: '', inEffort: false }
        break
      }
      case 'end_of_prompt': {
        if (!prompt) {
          warn('unexpected-close', '多余的 <|end_of_prompt|>，已忽略')
          break
        }
        // 闭合标签忽略编号，按栈语义直接闭合
        closePrompt()
        break
      }
      case 'begin_of_thought_effort': {
        if (!prompt) {
          warn('orphan-tag', '思考强度标签出现在 prompt 之外，已忽略')
          break
        }
        if (prompt.inEffort) {
          warn('nested-open', '思考强度标签重复开启，已忽略')
          break
        }
        prompt.inEffort = true
        break
      }
      case 'end_of_thought_effort': {
        if (!prompt?.inEffort) {
          warn('unexpected-close', '多余的 <|end_of_thought_effort|>，已忽略')
          break
        }
        prompt.inEffort = false
        prompt.effort = prompt.effort?.trim()
        break
      }
      case 'begin_of_task': {
        if (task) {
          warn('nested-open', '前一个 <|begin_of_task|> 未闭合，已自动闭合')
          closeTask()
        }
        if (prompt) closePrompt()
        const id = parseId('<|begin_of_task|>', idRaw, true)
        task = { id, segments: [], current: null, loose: '' }
        break
      }
      case 'end_of_task': {
        if (!task) {
          warn('unexpected-close', '多余的 <|end_of_task|>，已忽略')
          break
        }
        // 闭合标签忽略编号，按栈语义直接闭合
        closeTask()
        break
      }
      case 'begin_of_thought': {
        if (!task) {
          warn('auto-open-task', '出现 <begin_of_thought> 但没有任务包裹，已自动开启任务')
          task = { id: nextId(), segments: [], current: null, loose: '' }
        }
        if (task.current) {
          warn('unclosed-segment', '上一个段标签未闭合，已自动闭合')
          pushSegment()
        }
        task.current = { kind: 'thought', content: '' }
        break
      }
      case 'end_of_thought': {
        if (!task?.current || task.current.kind !== 'thought') {
          warn('unexpected-close', '多余的 <end_of_thought>，已忽略')
          break
        }
        pushSegment()
        break
      }
      case 'begin_of_response': {
        if (!task) {
          warn('auto-open-task', '出现 <begin_of_response> 但没有任务包裹，已自动开启任务')
          task = { id: nextId(), segments: [], current: null, loose: '' }
        }
        if (task.current) {
          warn('unclosed-segment', '上一个段标签未闭合，已自动闭合')
          pushSegment()
        }
        // 编号可选：省略时默认当前任务编号（不再校验与 task 的一致性）
        const id = idRaw !== undefined && /^\d+$/.test(idRaw) ? Number(idRaw) : task.id
        task.current = { kind: 'response', id, content: '' }
        break
      }
      case 'end_of_response': {
        if (!task?.current || task.current.kind !== 'response') {
          warn('unexpected-close', '多余的 <end_of_response>，已忽略')
          break
        }
        // 闭合标签忽略编号，按栈语义直接闭合
        pushSegment()
        break
      }
      case 'begin_of_tool_call': {
        if (!task) {
          warn('auto-open-task', '出现 <|begin_of_tool_call|> 但没有任务包裹，已自动开启任务')
          task = { id: nextId(), segments: [], current: null, loose: '' }
        }
        if (task.current) {
          warn('unclosed-segment', '上一个段标签未闭合，已自动闭合')
          pushSegment()
        }
        task.current = { kind: 'tool-call', name: '', arguments: '', content: '' }
        break
      }
      case 'end_of_tool_call': {
        if (!task?.current || task.current.kind !== 'tool-call') {
          warn('unexpected-close', '多余的 <|end_of_tool_call|>，已忽略')
          break
        }
        // expect 子段未闭合直接收尾 → 容错：解析累积文本 + 记 warning
        if (task.current.expectContent !== undefined) {
          warn('unclosed-segment', '<|begin_of_expect|> 未闭合，已自动补闭合')
          task.current.expected = parseExpectValue(task.current.expectContent)
          task.current.expectContent = undefined
        }
        pushSegment()
        break
      }
      case 'begin_of_expect': {
        if (!task?.current || task.current.kind !== 'tool-call') {
          warn('orphan-tag', '<|begin_of_expect|> 必须出现在 <|begin_of_tool_call|> 段内，已忽略')
          break
        }
        if (task.current.expectContent !== undefined) {
          warn('nested-open', '<|begin_of_expect|> 重复开启，已忽略')
          break
        }
        task.current.expectContent = ''
        break
      }
      case 'end_of_expect': {
        if (!task?.current || task.current.kind !== 'tool-call' || task.current.expectContent === undefined) {
          warn('unexpected-close', '多余的 <|end_of_expect|>，已忽略')
          break
        }
        task.current.expected = parseExpectValue(task.current.expectContent)
        task.current.expectContent = undefined
        break
      }
    }
  }

  emit(rawText.slice(cursor))

  if (loose.trim()) {
    warn('loose-text', `标签外的文本：${loose.trim().slice(0, 60)}`)
  }

  let partial: SrmlStreamParseResult['partial'] = null
  if (task) {
    partial = {
      open: 'task',
      id: task.id,
      segments: [...task.segments],
      segment: task.current ? { ...task.current, content: task.current.content.trimStart() } : null,
      loose: task.loose.trim() ? task.loose : '',
    }
  } else if (prompt) {
    partial = {
      open: 'prompt',
      id: prompt.id,
      content: prompt.content.trimStart(),
      ...(prompt.effort ? { thoughtEffort: prompt.effort } : {}),
    }
  }

  return { blocks, partial, warnings }
}

/**
 * 从模型原始输出中切出某个 task 的原始子串（含 <|begin_of_task_N|> 标签，到下一个 task 标签或文末）。
 * 供引擎在第一轮（一次输出多个 task）时按分支切分模型输出。
 */
export function sliceTaskRaw(rawText: string, taskId: number): string {
  const beginPattern = new RegExp(`<\\|?\\s*begin_of_task_${taskId}\\s*\\|?>`, 'i')
  const beginMatch = beginPattern.exec(rawText)
  if (!beginMatch) return ''
  const start = beginMatch.index
  const nextPattern = /<\|?\s*begin_of_task_\d+\s*\|?>/gi
  nextPattern.lastIndex = start + beginMatch[0].length
  const nextMatch = nextPattern.exec(rawText)
  const end = nextMatch ? nextMatch.index : rawText.length
  return rawText.slice(start, end).trim()
}

/**
 * 完整解析（模型结束输出后调用）。
 * 未闭合的块（partial）容错收尾并计入结果；完全没有解析出块才抛错。
 */
export function parseSrmlDocument(rawText: string): SrmlDocumentParseResult {
  const { blocks, partial, warnings } = parseSrmlStreamChunk(rawText)

  const finalized: SrmlBlock[] = [...blocks]
  if (partial) {
    if (partial.open === 'task') {
      const segments: SrmlSegment[] = [...partial.segments]
      if (partial.segment) segments.push(partial.segment)
      const task: SrmlTaskBlock = { kind: 'task', id: partial.id, segments }
      finalized.push(task)
    } else {
      const prompt: SrmlPromptBlock = { kind: 'prompt', id: partial.id, content: partial.content }
      if (partial.thoughtEffort) prompt.thoughtEffort = partial.thoughtEffort
      finalized.push(prompt)
    }
  }

  if (finalized.length === 0) {
    throw new SrmlParseError(
      '没有解析出任何任务或 prompt 块（可能缺少 <|begin_of_task_N|> 标签）',
      warnings,
    )
  }

  return {
    blocks: finalized,
    partial,
    warnings,
    normalized: serializeBlocks(finalized),
  }
}
