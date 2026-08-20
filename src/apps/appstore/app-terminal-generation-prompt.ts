import { APP_CAPABILITY_TAG_TERMINAL, hasAppCapabilityTag } from './app-capability-tags.ts'
import type { StoreListing, StoreListingDetail } from './types.ts'

export function resolveAppTerminalGenerationOptions(
  listing: StoreListing,
  _detail?: Partial<StoreListingDetail>,
  _existingHtml?: string,
): { isTerminal: boolean } {
  return { isTerminal: hasAppCapabilityTag(listing.tags, APP_CAPABILITY_TAG_TERMINAL) }
}

export const APP_STORE_TERMINAL_RUNTIME_SECTION = `【终端运行时】
宿主为微应用注入 InstantOS.terminal，由系统终端会话执行。不是真实 Unix shell：类 Unix 指令或自然语言会被 AI 翻译为虚拟文件系统操作。

API（全部返回 Promise，除 subscribe）：
- InstantOS.terminal.createSession({ initialCwd?, thinkingEnabled? }) → sessionId
- InstantOS.terminal.destroySession(sessionId)
- InstantOS.terminal.exec(sessionId, line) → 向会话执行一行（程序下发，串行排队）
- InstantOS.terminal.write(sessionId, text) → 仅追加输出，不执行
- InstantOS.terminal.abort(sessionId) / clear(sessionId)
- InstantOS.terminal.getCwd(sessionId) → cwd
- InstantOS.terminal.cd(sessionId, path) → cwd
- InstantOS.terminal.subscribe(sessionId, listener) → 取消订阅函数；listener 收到 { type:'snapshot', snapshot:{ cwd, busy, lines } }

本地命令（不经 AI）：help、clear、pwd、cd。

注意：禁止真实进程/管道；须走 InstantOS.terminal。客侧自行绘制终端 UI，或只做无界面命令下发。`

export function buildAppTerminalSystemPromptExtension(): string {
  return APP_STORE_TERMINAL_RUNTIME_SECTION
}

export function buildAppTerminalUserPromptSection(): string {
  return [
    '应用需在运行时通过 InstantOS.terminal 使用系统终端会话。',
    '- createSession / exec / subscribe 见 InstantOS.terminal.*',
    '- 输入 help 可查看终端内置说明',
    APP_STORE_TERMINAL_RUNTIME_SECTION,
  ].join('\n')
}
