/**
 * @deprecated 随模拟终端弃用。此文件定义模拟终端的 live output 工具（clear_screen / upsert_output_block /
 * remove_output_block），由 LLM agent 调用以管理终端输出展示。并非原生 JS 运行时能力。
 * 真终端（terminal-app）使用终端 REPL 的 console 输出与 .clear 命令，不经过这套工具。
 * 保留仅为过渡，新功能不要加在这里。
 */
import { defineTool } from '../ai/agent-tool.ts'
import type { TerminalUpsertBlockOptions } from './terminal-types.ts'

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

export type TerminalLiveOutputToolOptions = {
  upsertBlock: (options: TerminalUpsertBlockOptions) => void
  removeBlock: (key: string) => void
  clearScreen: () => void
}

export function createTerminalLiveOutputTools(options: TerminalLiveOutputToolOptions) {
  const { upsertBlock, removeBlock, clearScreen } = options
  return [
    defineTool({
      name: 'clear_screen',
      description:
        '清空终端屏幕上的全部历史输出（等同 clear / cls）。用户要清屏、cls、clear 时必须调用本工具，不要只口头说明。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
      execute: async () => {
        clearScreen()
        return '已清屏'
      },
    }),
    defineTool({
      name: 'upsert_output_block',
      description:
        '写入或原地更新一块终端输出（按 key 去重）。适合进度条、任务状态、Markdown 表格等需要反复刷新的内容；同一 key 多次调用会替换旧内容，不会追加。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'markdown'],
        properties: {
          key: {
            type: 'string',
            description: '块标识。同一次任务内复用同一 key 即可原地刷新（如 progress、result-table）',
          },
          markdown: {
            type: 'string',
            description: 'GFM Markdown 正文（支持表格、粗体、代码块等）',
          },
        },
      },
      execute: async (args) => {
        const key = asString(args.key).trim()
        const markdown = asString(args.markdown)
        if (!key) {
          return '错误：key 不能为空'
        }
        upsertBlock({
          key,
          text: markdown,
          format: 'markdown',
          kind: 'output',
        })
        return `已更新输出块 ${key}`
      },
    }),
    defineTool({
      name: 'remove_output_block',
      description:
        '按 key 移除一块终端输出。进度条/临时状态在任务结束后必须调用本工具清掉，不要让 100% 的进度块继续留在屏幕上。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['key'],
        properties: {
          key: {
            type: 'string',
            description: '要移除的块标识（与 upsert_output_block 使用的 key 相同，如 progress）',
          },
        },
      },
      execute: async (args) => {
        const key = asString(args.key).trim()
        if (!key) {
          return '错误：key 不能为空'
        }
        removeBlock(key)
        return `已移除输出块 ${key}`
      },
    }),
  ]
}
