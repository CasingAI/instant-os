/**
 * iCode 编辑代理化（第三期引擎 / 第十二期外壳分工）：
 *
 * - 第三期已把编辑引擎接到 vscode 的 agent 循环上：模型经受控 InstantREPL 终端按路径
 *   读改当前应用的草稿树；写入硬限草稿根（fsWriteRoots），读取放开；用量经 usageContext 接线。
 * - 第十二期起 iCode 不再自带简化聊天外壳与逐轮驱动器（runIcodeAgent 已删），
 *   「对话」页直接挂 vscode 的 VscodeAiPanel（见 icode-ai-chat-panel.tsx）；
 *   本模块只保留喂给该面板的 iCode 个性：系统提示附录、上下文构造、
 *   request_capability 能力工具、plan 工具的草稿树落盘变体。
 */
import type { GeneratedAppId } from '../../os/types.ts'
import type { AppCapabilityTag } from '../appstore/app-capability-tags.ts'
import { defineTool, type AgentTool } from '../../ai/agent-tool.ts'
import { buildInstantShellSystemPromptSection } from '../../terminal/instant-shell/instant-shell-prompt.ts'
import type { VscodeAiContextInput } from '../vscode/vscode-ai-context.ts'
import type { VscodeAiMode } from '../vscode/vscode-ai-mode.ts'
import {
  validatePlanMarkdown,
  VSCODE_AI_PLAN_FORMAT_HINT,
  VSCODE_AI_PLAN_MARKDOWN_SKELETON,
} from '../vscode/vscode-ai-plan.ts'
import type { ProdudeTerminalHostApi } from '../produde/produde-terminal-host.tsx'
import { filesCreateText, filesMkdir, filesStat, filesWriteText } from '../files/files-api.ts'
import type { MonacoProblem } from '../../monaco/monaco-markers.ts'

export type IcodeCapabilityTag = '3d' | 'ai' | 'files' | 'terminal'

export const ICODE_CAPABILITY_TAG_VALUES: readonly IcodeCapabilityTag[] = [
  '3d',
  'ai',
  'files',
  'terminal',
]

export const ICODE_CAPABILITY_TAG_LABELS: Record<IcodeCapabilityTag, string> = {
  '3d': '3D 能力',
  ai: '运行时 AI 能力',
  files: '文件访问能力',
  terminal: '终端能力',
}

/** plan 产物目录（第十二期）：写进草稿树的「Plans」子目录，不用 vscode 的 tmp 容器 */
export function icodePlansDirPath(draftRoot: string): string {
  return `${draftRoot.replace(/\/+$/, '')}/Plans`
}

function slugifyIcodePlanName(name: string): string {
  const raw = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return raw || 'plan'
}

async function ensureDirsForPath(absolutePath: string): Promise<void> {
  const parts = absolutePath.split('/').filter(Boolean)
  let current = ''
  for (let index = 0; index < parts.length - 1; index += 1) {
    current += `/${parts[index]}`
    const existing = await filesStat(current)
    if (existing) continue
    await filesMkdir(current)
  }
}

function assertIcodePlanPath(path: string, draftRoot: string): string {
  const trimmed = path.trim()
  const plansDir = `${icodePlansDirPath(draftRoot)}/`
  if (!trimmed.startsWith(plansDir) || !trimmed.endsWith('.md') || trimmed.includes('..')) {
    throw new Error(`计划路径必须在 ${plansDir} 下的 .md 文件`)
  }
  return trimmed
}

export function buildIcodeAgentSystemPrompt(input: {
  appName: string
  draftRoot: string
  /** 文本源码文件路径清单 + 二进制资源路径（只列路径，不塞内容） */
  fileManifest: readonly string[]
  grantedCapabilities: readonly IcodeCapabilityTag[]
  mode?: VscodeAiMode
}): string {
  const mode = input.mode ?? 'agent'
  const granted =
    input.grantedCapabilities.length > 0
      ? input.grantedCapabilities.map((tag) => ICODE_CAPABILITY_TAG_LABELS[tag]).join('、')
      : '（暂无）'
  const manifest =
    input.fileManifest.length > 0
      ? input.fileManifest.map((path) => `- ${path}`).join('\n')
      : '- （空）'
  const modeSection =
    mode === 'plan'
      ? `当前是 Plan 模式：不要改动草稿里的应用代码（终端只读）。产出物只有一份完整实施计划，用 write_plan 写入${icodePlansDirPath(input.draftRoot)}/ 子目录。`
      : mode === 'ask'
        ? '当前是 Ask 模式：只回答问题、只读不改——不执行任何会产生文件改写的操作。'
        : `当前是 Agent 模式：直接动手改草稿。涉及既有计划的实施时，每完成一项 Todo 调用 update_plan 把对应 \`- [ ]\` 改为 \`- [x]\`。`
  return `你是 iCode——Instant OS 里生成应用的开发面代理，帮助用户开发当前应用「${input.appName}」。

工作区就是该应用的草稿文件夹树：${input.draftRoot}
- 只能在这一棵树里写文件（写入被硬限制在草稿根；正式版只读，越界写会 EACCES）
- 读取放开：可读 VFS 其它路径作参考，包括该应用的运行时数据目录（单用户本地系统），但别翻无关目录浪费步骤
- 版本模型：草稿（Draft）之外是只读正式版；桌面只跑当前最大正式号；发布是用户动作，你不要触碰
- 不要往草稿树里写聊天或运行时数据文件

当前草稿文件清单（含二进制资源的路径占位）：
${manifest}

已授予的能力：${granted}
- 需要未授予的能力时调用 request_capability 发起请求，走面板内嵌横幅等用户拍板（同意后宿主会更新清单再通知你）；被拒绝就给出不依赖该能力的替代说明
- 未授权状态下你仍可正常产出代码；门禁在运行时能力桥，不在提示词

模式约束：
${modeSection}

编辑约定：
- 用 run_in_terminal 的 fs.readFileSync / fs.writeFileSync 按路径读改文件；搜索用 instant.grep
${
  input.fileManifest.includes('main.tsx')
    ? '- 这是 TSX 工程：入口 main.tsx；用系统提供的 preact（import { render } from "preact"；hooks 从 "preact/hooks"），裸名只支持 preact / preact/hooks / preact/jsx-runtime；样式用普通 CSS 邻居文件（也可写 .less，与 CSS 混用）'
    : '- 入口是 index.html；样式、脚本、图片放邻居文件，页内相对引用即可解析'
}
- 清单里出现的非源码路径（图片等二进制资源）可直接读取内容、也可用代码生成或引用；不要臆测其内容
- 改完即预览：宿主监听草稿树文件变更刷新预览；转译/类型诊断的报错你能读到，可自行修正
- 每轮可用 get_terminal_changes 查看改动；「撤销上一轮」「编辑上一条重发」由用户触发时宿主负责回滚，无需你重复处理
- 不要编造未执行的工具结果；回复用简洁中文说明改了什么

${buildInstantShellSystemPromptSection()}`
}

export function buildIcodeAgentContext(
  draftRoot: string,
  terminalApi: ProdudeTerminalHostApi | null,
  chatSessionId: string,
  problems: readonly MonacoProblem[] = [],
): VscodeAiContextInput {
  return {
    workspaceFolder: draftRoot,
    tabs: [],
    activeTabId: undefined,
    editor: {
      activePath: undefined,
      cursorLine: 1,
      cursorColumn: 1,
      selectionText: undefined,
    },
    // 五期：旁路类型诊断进入 agent 上下文，模型能读到并改草稿自修
    problems,
    aiTerminalKind: 'agent',
    aiTerminal: terminalApi?.getAiTerminalSnapshot('agent', chatSessionId) ?? { status: 'none' },
  }
}

/**
 * 能力请求工具（2.3 语义不变）：未授予能力 → 宿主确认；拒绝则模型收到明确反馈继续干活或收尾。
 * 第十二期起确认入口由调用方注入：iCode 包一层 toolsHost.requestChange（面板内嵌横幅拍板）。
 */
export function createRequestCapabilityTool(input: {
  grantedTags: readonly IcodeCapabilityTag[]
  requestCapability: (tag: IcodeCapabilityTag, reason: string) => Promise<boolean>
}): AgentTool {
  return defineTool({
    name: 'request_capability',
    description:
      '应用需要尚未授予的系统能力（3D / 运行时 AI / 文件访问 / 终端）时调用，向用户发起授予请求。授予后可继续产出依赖该能力的代码；拒绝则改用不依赖该能力的方案或说明。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['tag', 'reason'],
      properties: {
        tag: {
          type: 'string',
          enum: [...ICODE_CAPABILITY_TAG_VALUES],
          description: '能力标识：3d | ai | files | terminal',
        },
        reason: {
          type: 'string',
          description: '为什么需要这个能力（一句话，展示给用户）',
        },
      },
    },
    execute: async (args) => {
      const tag = ICODE_CAPABILITY_TAG_VALUES.find((item) => item === args.tag)
      const reason = typeof args.reason === 'string' ? args.reason.trim() : ''
      if (!tag) return '无效的能力标识；可用：3d / ai / files / terminal'
      if (input.grantedTags.includes(tag)) {
        return `${ICODE_CAPABILITY_TAG_LABELS[tag]}已授予，无需重复请求。`
      }
      const granted = await input.requestCapability(tag, reason)
      return granted
        ? `用户已授予${ICODE_CAPABILITY_TAG_LABELS[tag]}。可以继续产出使用该能力的代码。`
        : `用户拒绝了${ICODE_CAPABILITY_TAG_LABELS[tag]}。请给出不依赖该能力的替代实现或说明。`
    },
  })
}

/**
 * plan 工具的 iCode 变体（第十二期）：产物落草稿树 Plans/ 子目录（随包保存、可导出），
 * 不用 vscode 的 /tmp 工作区容器。返回 write_plan 与 update_plan 两件；
 * 调用方按模式取用（plan→write_plan，agent→update_plan）。
 */
export function createIcodePlanTools(input: { draftRoot: string }): {
  writePlan: AgentTool
  updatePlan: AgentTool
} {
  const { draftRoot } = input
  const writePlan = defineTool({
    name: 'write_plan',
    description:
      `将完整计划 Markdown 写入工作区（草稿树）的 ${icodePlansDirPath(draftRoot)}/ 子目录。这是 Plan 模式唯一允许的写出口；不要用终端写计划。` +
      VSCODE_AI_PLAN_FORMAT_HINT +
      '选定一种方案写死。骨架示例：\n' +
      VSCODE_AI_PLAN_MARKDOWN_SKELETON,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'markdown'],
      properties: {
        name: {
          type: 'string',
          description: '短名称（用于文件名 slug，英文或中文均可）',
        },
        markdown: {
          type: 'string',
          description:
            '完整 Markdown 计划正文。' +
            VSCODE_AI_PLAN_FORMAT_HINT +
            '示例：\n' +
            VSCODE_AI_PLAN_MARKDOWN_SKELETON,
        },
      },
    },
    execute: async (args) => {
      const name = typeof args.name === 'string' ? args.name : ''
      const markdown = typeof args.markdown === 'string' ? args.markdown : ''
      validatePlanMarkdown(markdown)
      const shortId = Math.random().toString(36).slice(2, 8)
      const path = `${icodePlansDirPath(draftRoot)}/${slugifyIcodePlanName(name)}-${shortId}.md`
      await ensureDirsForPath(path)
      const existing = await filesStat(path)
      if (existing) {
        await filesWriteText(path, markdown)
      } else {
        await filesCreateText(path, markdown)
      }
      // 第十二期拍板：iCode 宿主不打开计划文件当编辑器
      return `已写入计划：${path}`
    },
  })
  const updatePlan = defineTool({
    name: 'update_plan',
    description:
      `覆盖更新已有计划 Markdown（${icodePlansDirPath(draftRoot)}/plans 下的 .md）。` +
      '实施计划时每完成一项 Todo，传入完整文件内容将对应 `- [ ]` 改为 `- [x]`；保持其余正文稳定。' +
      VSCODE_AI_PLAN_FORMAT_HINT +
      '不要用终端写计划文件。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['path', 'markdown'],
      properties: {
        path: {
          type: 'string',
          description: `计划绝对路径（须为 ${icodePlansDirPath(draftRoot)} 下的 .md）`,
        },
        markdown: {
          type: 'string',
          description: '完整 Markdown 计划正文（含已勾选进度）。' + VSCODE_AI_PLAN_FORMAT_HINT,
        },
      },
    },
    execute: async (args) => {
      const rawPath = typeof args.path === 'string' ? args.path : ''
      const markdown = typeof args.markdown === 'string' ? args.markdown : ''
      validatePlanMarkdown(markdown)
      const path = assertIcodePlanPath(rawPath, draftRoot)
      const existing = await filesStat(path)
      if (!existing || existing.kind !== 'file') {
        throw new Error(`计划文件不存在：${path}。请先用 Plan 模式 write_plan 生成计划。`)
      }
      await filesWriteText(path, markdown)
      return `已更新计划：${path}`
    },
  })
  return { writePlan, updatePlan }
}

export function icodeChatSessionId(appId: GeneratedAppId): string {
  return `icode-${appId}`
}

export function icodeChatTitle(appName: string): string {
  return appName.slice(0, 24) || 'iCode'
}

/** 能力标签桥接：AppCapabilityTag ↔ icode 可授予能力 */
export function toIcodeCapabilityTags(tags: readonly AppCapabilityTag[]): IcodeCapabilityTag[] {
  return ICODE_CAPABILITY_TAG_VALUES.filter((tag) => tags.includes(tag as AppCapabilityTag))
}
