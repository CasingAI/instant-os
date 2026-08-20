import type { BuiltinSubAgentId, SubAgentDefinition } from './subagent-types.ts'

export const BUILTIN_SUBAGENT_IDS: readonly BuiltinSubAgentId[] = [
  'explore',
  'general',
  'vision',
]

export function isBuiltinSubAgentId(id: string): id is BuiltinSubAgentId {
  return id === 'explore' || id === 'general' || id === 'vision'
}

/** 追加到完整主 Agent system 之后的角色说明（非独立 system）。 */
const EXPLORE_SYSTEM_PROMPT = `【Sub Agent 角色：explore】
你是本次委派的只读调研子任务执行者。能力与约束以上方主 Agent（Ask）说明为准。

额外要求：
- 任务说明由父 Agent 提供，其中包含你需要的全部上下文；不要假设你见过父对话。
- 工作完成后给出简洁、可行动的摘要：相关文件路径、关键符号/行号、结论与不确定点。
- 不要向用户直接对话；你的整段输出会作为工具结果回传给父 Agent。`

const GENERAL_SYSTEM_PROMPT = `【Sub Agent 角色：general】
你是本次委派的通用执行子任务执行者。能力与约束以上方主 Agent（Agent）说明为准。

额外要求：
- 任务说明由父 Agent 提供，其中包含你需要的全部上下文；不要假设你见过父对话。
- 完成后说明：做了什么、改了哪些路径、如何验证、剩余风险。
- 不要向用户直接对话；你的整段输出会作为工具结果回传给父 Agent。`

const VISION_SYSTEM_PROMPT = `【Sub Agent 角色：vision】
你是本次委派的专职识图子任务执行者。你没有工具：本轮用户消息里已由宿主注入要看的图片像素。

额外要求：
- 任务说明与图片均由父 Agent / 宿主提供；直接基于已注入的图片回答。
- 交付可操作的中文文字描述：画面内容、文字/UI 元素、布局、错误信息、与任务相关的结论与不确定点。
- 不要向用户直接对话；你的整段输出会作为工具结果回传给父 Agent。
- 不要编造图中看不见的内容；不要尝试调用工具或读取文件。`

export const BUILTIN_SUBAGENTS: Record<BuiltinSubAgentId, SubAgentDefinition> = {
  explore: {
    id: 'explore',
    description:
      '只读代码库探索与调研。适合搜索文件、梳理结构、汇总相关路径；不修改代码。大量中间搜索结果会隔离在子上下文中。',
    systemPrompt: EXPLORE_SYSTEM_PROMPT,
    access: 'readonly',
    defaultModelPolicy: 'text-secondary',
    builtin: true,
  },
  general: {
    id: 'general',
    description:
      '可读写的通用执行 Agent。适合实现功能、修复问题、跑命令等需要改动的多步任务。默认使用与主 Agent 相同的模型。',
    systemPrompt: GENERAL_SYSTEM_PROMPT,
    access: 'full',
    defaultModelPolicy: 'inherit-parent',
    builtin: true,
  },
  vision: {
    id: 'vision',
    description:
      '专职图片识别。委派时必须传 image_paths；宿主将图片直接注入子上下文（无工具）。追问可只文字或再传新图路径。',
    systemPrompt: VISION_SYSTEM_PROMPT,
    access: 'readonly',
    defaultModelPolicy: 'vision',
    builtin: true,
  },
}
