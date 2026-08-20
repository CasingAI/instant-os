/**
 * AI 工具结果超长时 spill 到 session tmp，并在终端真实执行预览读；
 * 再向 LLM / timeline 注入合成「读取前缀」消息。
 *
 * 全量文本只保留在 tmp；终端面板受 console/display 行数与单行字符上限约束，
 * 不再假设可常驻完整原始输出。spill 后可通过 notifyTerminal 提示落盘路径。
 */
import type OpenAI from 'openai'
import type { AgentToolStructuredResult } from '../../ai/agent-tool.ts'
import { osNowMs } from '../../os/os-clock.ts'
import { filesCreateText } from '../files/files-api.ts'
import { joinFilesAbsolutePath } from '../files/files-path.ts'
import { ensureTmpFolder } from '../files/files-tmp.ts'

export const TERMINAL_OUTPUT_SPILL_THRESHOLD = 16_000
export const TERMINAL_OUTPUT_SPILL_PREVIEW_CHARS = 16_000
/** timeline 展示留 header + console 余量 */
export const TERMINAL_OUTPUT_SPILL_UI_RESULT_LIMIT =
  TERMINAL_OUTPUT_SPILL_PREVIEW_CHARS + 2_048

let spillSeq = 0

function nextSpillId(): string {
  spillSeq += 1
  return `${osNowMs()}-${spillSeq}`
}

export function buildSpillPreviewTerminalCommand(path: string): string {
  return [
    `const fs = require('fs');`,
    `console.log(fs.readFileSync(${JSON.stringify(path)}, 'utf8').slice(0, ${TERMINAL_OUTPUT_SPILL_PREVIEW_CHARS}));`,
  ].join('\n')
}

/** 仅放在主 tool 短 content 里，不混入终端输出。 */
export function formatSpillFollowUpHint(path: string): string {
  const pathLit = JSON.stringify(path)
  const end = TERMINAL_OUTPUT_SPILL_PREVIEW_CHARS * 2
  return [
    `后续可用 await instant.grep('error', { path: ${pathLit} }) 检索；`,
    `或在终端执行：`,
    `const fs = require('fs');`,
    `console.log(fs.readFileSync(${pathLit}, 'utf8').slice(${TERMINAL_OUTPUT_SPILL_PREVIEW_CHARS}, ${end}));`,
  ].join('\n')
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
  command: string,
  previewTerminalOutput: string,
  toolCallId: string,
): OpenAI.Chat.ChatCompletionMessageParam[] {
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
      content: previewTerminalOutput,
    },
  ]
}

/**
 * 工具结果不超过阈值则原样返回；否则写 tmp、在终端真跑预览读，
 * 返回 structured result（短提示 + appendMessages + syntheticActivities）。
 */
export async function maybeSpillToolOutput(
  fullText: string,
  options: {
    tmpDir: string
    runTerminalLine: (command: string) => Promise<string>
    /** 可选：向终端面板追加一行 spill 提示（不依赖全量输出常驻） */
    notifyTerminal?: (message: string) => void
  },
): Promise<string | AgentToolStructuredResult> {
  if (fullText.length <= TERMINAL_OUTPUT_SPILL_THRESHOLD) {
    return fullText
  }

  const path = await writeSpillFile({
    fullText,
    tmpDir: options.tmpDir,
  })
  const total = fullText.length
  const command = buildSpillPreviewTerminalCommand(path)
  const description = '读取溢出输出（自动）'
  const previewTerminalOutput = await options.runTerminalLine(command)
  const toolCallId = `spill-read-${nextSpillId()}`

  options.notifyTerminal?.(
    `── 输出过长（${total} 字符），已写入 ${path}；面板仅保留近期行，完整内容请读该文件 ──`,
  )

  return {
    content: `输出过长（${total} 字符），已保存至 ${path}\n\n${formatSpillFollowUpHint(path)}`,
    appendMessages: buildSyntheticReadMessages(
      command,
      previewTerminalOutput,
      toolCallId,
    ),
    syntheticActivities: [
      {
        toolName: 'run_in_terminal',
        arguments: { command, description },
        result: previewTerminalOutput,
      },
    ],
  }
}
