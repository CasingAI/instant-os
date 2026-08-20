import { defineTool, type AgentTool } from '../agent-tool.ts'

export const COMPACT_CONTEXT_TOOL_NAME = 'compact_context'

export const SELF_COMPACT_RUBRIC = `
【上下文压缩】
你可以使用工具 compact_context 请求系统压缩更早的轨迹以节省上下文。
调用时机：子任务已收敛、调试告一段落、或准备切换目标时。
禁止：搜索/阅读尚未形成结论时；连续工具链推导中途；刚读完大文件尚未提炼时。
调用时可传 focus，说明压缩后必须保留的焦点（路径、错误、方案名等）。
`.trim()

export type CompactContextHandler = (args: {
  focus?: string
  reason?: string
}) => Promise<unknown>

export function createCompactContextTool(
  handler: CompactContextHandler,
): AgentTool<{ focus?: string; reason?: string }> {
  return defineTool<{ focus?: string; reason?: string }>({
    name: COMPACT_CONTEXT_TOOL_NAME,
    description:
      '当一大段探索/调试已结束、或上下文明显冗余时，调用此工具请求系统压缩更早的轨迹。禁止在推导中途、未得出阶段结论时调用。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        focus: {
          type: 'string',
          description:
            '压缩时必须保留的焦点（如「auth 中间件方案」「当前失败的测试名」）',
        },
        reason: {
          type: 'string',
          description: '为何此时压缩（可选）',
        },
      },
    },
    async execute(args) {
      return handler({
        focus: typeof args.focus === 'string' ? args.focus : undefined,
        reason: typeof args.reason === 'string' ? args.reason : undefined,
      })
    },
  })
}

export function appendSelfCompactRubric(systemPrompt: string): string {
  if (systemPrompt.includes('compact_context')) return systemPrompt
  return `${systemPrompt.trim()}\n\n${SELF_COMPACT_RUBRIC}`
}
