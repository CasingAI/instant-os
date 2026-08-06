import { defineTool, type AgentTool } from '../../ai/agent-tool.ts'
import { maybeSpillToolOutput } from '../vscode/vscode-ai-output-spill.ts'
import { runVscodeAiTerminalLine } from '../vscode/vscode-ai-run-command.ts'
import type { VscodeAiToolsHost } from '../vscode/vscode-ai-tools.ts'

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

const TOOL_DESCRIPTION =
  '在本对话绑定的可写终端执行一段 JavaScript（自动执行，无需确认）。同对话复用同一终端；若用户已关闭该终端会自动新开并在结果中标明 rebuilt。读/写/删/建文件用 fs；搜索文本用 globalThis.instant.grep(...)；能力缺口用 await instant.wish({ summary, category, blockedStep, attempted?, detail? })；打开应用/路径/URL 或操纵窗口用 globalThis.instant；打开/读取/操作真实网页用 globalThis.webview。大文本可写 os.tmpdir()；工具返回超过约 16000 字符（16K）时会自动 spill 到 tmp 并预览开头。必须传 description（短句说明本步意图，供界面展示）。'

/** ProDude 仅暴露可写的 run_in_terminal，不做只读限制。 */
export function createProdudeAiTools(host: VscodeAiToolsHost): AgentTool[] {
  return [
    defineTool({
      name: 'run_in_terminal',
      description: TOOL_DESCRIPTION,
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['command', 'description'],
        properties: {
          command: { type: 'string' },
          description: {
            type: 'string',
            description: '短句说明本步意图（约 40 字内，中文动宾），供界面展示，不参与执行',
          },
        },
      },
      execute: async (args) => {
        const fullText = await runVscodeAiTerminalLine(
          host.runCommandHost,
          asString(args.command),
        )
        const tmpDir = host.runCommandHost.getAgentTerminalHandle()?.getTmpDir()
        if (!tmpDir) return fullText
        return maybeSpillToolOutput(fullText, {
          tmpDir,
          runTerminalLine: (cmd) => runVscodeAiTerminalLine(host.runCommandHost, cmd),
          notifyTerminal: (message) => {
            host.runCommandHost.getAgentTerminalHandle()?.appendInfo(message)
          },
        })
      },
    }),
  ]
}
