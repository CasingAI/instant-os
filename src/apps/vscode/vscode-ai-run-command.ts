import type { TerminalSession } from '../../terminal/terminal-session.ts'
import { runNpmScript, runNpx } from '../../packages/package-run.ts'
import type { QuickJsEvalResult } from '../../quickjs/quickjs-instance-types.ts'

export type VscodeAiRunConfirmRequest = {
  title: string
  message: string
}

export type VscodeAiRunCommandHost = {
  confirm: (request: VscodeAiRunConfirmRequest) => Promise<boolean>
  terminalSession: TerminalSession | undefined
  workspaceFolder: string | undefined
}

const OUTPUT_LINE_LIMIT = 120
const OUTPUT_CHAR_LIMIT = 12_000

function truncateOutput(text: string): string {
  const lines = text.split('\n')
  const sliced =
    lines.length > OUTPUT_LINE_LIMIT ? lines.slice(-OUTPUT_LINE_LIMIT).join('\n') : text
  if (sliced.length <= OUTPUT_CHAR_LIMIT) return sliced
  return `…（输出已截断）\n${sliced.slice(-OUTPUT_CHAR_LIMIT)}`
}

function formatQuickJsResult(result: QuickJsEvalResult): string {
  const consoleText = result.consoleLines.map((line) => line.text).join('\n')
  if (!result.ok) {
    return [result.error, consoleText].filter(Boolean).join('\n')
  }
  const status = result.exitCode === 0 ? '退出码 0' : `退出码 ${result.exitCode}`
  return [status, consoleText].filter(Boolean).join('\n')
}

export async function runVscodeAiTerminalLine(
  host: VscodeAiRunCommandHost,
  line: string,
): Promise<string> {
  const trimmed = line.trim()
  if (!trimmed) return '命令为空'
  const session = host.terminalSession
  if (!session) return '终端未就绪'

  const ok = await host.confirm({
    title: '运行终端命令',
    message: `AI 请求在终端执行：\n\n${trimmed}`,
  })
  if (!ok) return '用户取消执行'

  const before = session.getSnapshot().lines.length
  await session.submit(trimmed, { source: 'program' })

  let attempts = 0
  while (session.getSnapshot().busy && attempts < 600) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    attempts += 1
  }

  const afterLines = session.getSnapshot().lines.slice(before)
  const text = afterLines
    .map((entry) => entry.text)
    .filter((entry) => entry.trim().length > 0)
    .join('\n')
  return truncateOutput(text || '（无输出）')
}

export async function runVscodeAiNpmScript(
  host: VscodeAiRunCommandHost,
  scriptName: string,
  extraArgs: string[] | undefined,
): Promise<string> {
  const root = host.workspaceFolder?.trim()
  if (!root) return '未打开工作区文件夹，无法运行 npm script'

  const ok = await host.confirm({
    title: '运行 npm script',
    message: `AI 请求执行：npm run ${scriptName}${extraArgs?.length ? ` ${extraArgs.join(' ')}` : ''}\n\n工作区：${root}`,
  })
  if (!ok) return '用户取消执行'

  try {
    const result = await runNpmScript({
      projectRoot: root,
      scriptName,
      extraArgs,
      onConsole: () => undefined,
    })
    return truncateOutput(formatQuickJsResult(result) || '（无输出）')
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

export async function runVscodeAiNpx(
  host: VscodeAiRunCommandHost,
  packageSpec: string,
  extraArgs: string[] | undefined,
): Promise<string> {
  const root = host.workspaceFolder?.trim()
  if (!root) return '未打开工作区文件夹，无法运行 npx'

  const ok = await host.confirm({
    title: '运行 npx',
    message: `AI 请求执行：npx ${packageSpec}${extraArgs?.length ? ` ${extraArgs.join(' ')}` : ''}\n\n工作区：${root}`,
  })
  if (!ok) return '用户取消执行'

  try {
    const result = await runNpx({
      projectRoot: root,
      packageSpec,
      args: extraArgs,
      onConsole: () => undefined,
    })
    return truncateOutput(formatQuickJsResult(result) || '（无输出）')
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}
