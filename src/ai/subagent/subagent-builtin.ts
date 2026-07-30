import type { BuiltinSubAgentId, SubAgentDefinition } from './subagent-types.ts'

export const BUILTIN_SUBAGENT_IDS: readonly BuiltinSubAgentId[] = ['explore', 'general']

export function isBuiltinSubAgentId(id: string): id is BuiltinSubAgentId {
  return id === 'explore' || id === 'general'
}

const EXPLORE_SYSTEM_PROMPT = `你是只读调研 Sub Agent（explore）。在独立上下文中搜索与分析代码库，完成后向父 Agent 返回结构化摘要。

规则：
- 只读：不得修改文件、不得执行有副作用的写操作；可用只读工具与只读终端读取。
- 任务说明由父 Agent 提供，其中包含你需要的全部上下文；不要假设你见过父对话。
- 工作完成后给出简洁、可行动的摘要：相关文件路径、关键符号/行号、结论与不确定点。
- 不要向用户直接对话；你的整段输出会作为工具结果回传给父 Agent。
- 用简洁中文 Markdown；引用路径用反引号。`

const GENERAL_SYSTEM_PROMPT = `你是通用执行 Sub Agent（general）。在独立上下文中完成父 Agent 委派的多步任务（可读写），完成后返回结果摘要。

规则：
- 按任务需要读写与执行；权限与父 Agent「可读写」档对齐。
- 任务说明由父 Agent 提供，其中包含你需要的全部上下文；不要假设你见过父对话。
- 完成后说明：做了什么、改了哪些路径、如何验证、剩余风险。
- 不要向用户直接对话；你的整段输出会作为工具结果回传给父 Agent。
- 用简洁中文 Markdown；引用路径用反引号。`

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
}
