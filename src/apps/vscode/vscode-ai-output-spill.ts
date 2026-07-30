/**
 * AI 工具结果超长时 spill 到 session tmp，并向 LLM 注入合成「读取前缀」消息。
 * 终端面板仍展示完整输出；本模块只包装发给模型的 tool result。
 */
import type OpenAI from 'openai'
import type { AgentToolStructuredResult } from '../../ai/agent-tool.ts'
import { osNowMs } from '../../os/os-clock.ts'
import { filesCreateText } from '../files/files-api.ts'
import { joinFilesAbsolutePath } from '../files/files-path.ts'
import { ensureTmpFolder } from '../files/files-tmp.ts'

export const TERMINAL_OUTPUT_SPILL_THRESHOLD = 1000
export const TERMINAL_OUTPUT_SPILL_PREVIEW_CHARS = 1000

let spillSeq = 0

function nextSpillId(): string {
  spillSeq += 1
  return `${osNowMs()}-${spillSeq}`
}

export function formatSpillPreview(fullText: string, path: string): string {
  const total = fullText.length
  const preview = fullText.slice(0, TERMINAL_OUTPUT_SPILL_PREVIEW_CHARS)
  return `（以下仅为文件开头 ${TERMINAL_OUTPUT_SPILL_PREVIEW_CHARS} 字符，共 ${total} 字符；完整内容见 ${path}）\n${preview}`
}

export async function writeSpillFile(params: {
  fullText: string
  tmpDir: string
  subdir?: string
}): Promise<string> {
  const tmpDir = params.tmpDir.trim().replace(/\/+$/, '')
  if (!tmpDir.startsWith('/tmp/')) {
    throw new Error(`spill 需要 session tmpdir，收到：${params.tmpDir}`)
  }
  const subdir = (params.subdir ?? 'stdout').trim() || 'stdout'
  const dir = joinFilesAbsolutePath(tmpDir, subdir)
  await ensureTmpFolder(dir)
  const path = joinFilesAbsolutePath(dir, `run-${nextSpillId()}.txt`)
  await filesCreateText(path, params.fullText)
  return path
}

function buildSyntheticReadMessages(
  path: string,
  preview: string,
  toolCallId: string,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const command = `fs.readFileSync(${JSON.stringify(path)}, 'utf8').slice(0, ${TERMINAL_OUTPUT_SPILL_PREVIEW_CHARS})`
  const description = '读取溢出输出（自动）'
  return [
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: toolCallId,
          type: 'function',
          function: {
            name: 'run_in_terminal',
            arguments: JSON.stringify({ command, description }),
          },
        },
      ],
    },
    {
      role: 'tool',
      tool_call_id: toolCallId,
      content: preview,
    },
  ]
}

/**
 * 工具结果不超过阈值则原样返回；否则写 tmp 并返回 structured result
 *（短提示 + appendMessages 合成读 + syntheticActivities）。
 */
export async function maybeSpillToolOutput(
  fullText: string,
  options: { tmpDir: string },
): Promise<string | AgentToolStructuredResult> {
  if (fullText.length <= TERMINAL_OUTPUT_SPILL_THRESHOLD) {
    return fullText
  }

  const path = await writeSpillFile({
    fullText,
    tmpDir: options.tmpDir,
  })
  const total = fullText.length
  const preview = formatSpillPreview(fullText, path)
  const toolCallId = `spill-read-${nextSpillId()}`
  const command = `fs.readFileSync(${JSON.stringify(path)}, 'utf8').slice(0, ${TERMINAL_OUTPUT_SPILL_PREVIEW_CHARS})`
  const description = '读取溢出输出（自动）'

  return {
    content: `输出过长（${total} 字符），已保存至 ${path}`,
    appendMessages: buildSyntheticReadMessages(path, preview, toolCallId),
    syntheticActivities: [
      {
        toolName: 'run_in_terminal',
        arguments: { command, description },
        result: preview,
      },
    ],
  }
}
