/** 子 Agent 权限：只读调研 vs 可读写执行 */
export type SubAgentAccess = 'readonly' | 'full'

export type BuiltinSubAgentId = 'explore' | 'general'

/** 默认模型策略：副基座首选，或继承主 Agent 当前模型 */
export type SubAgentDefaultModelPolicy = 'text-secondary' | 'inherit-parent'

/** 模型来源（与 VS Code VscodeModelSource 对齐） */
export type SubAgentModelSource = 'text-secondary' | 'text' | 'custom'

export type SubAgentDefinition = {
  id: string
  description: string
  systemPrompt: string
  access: SubAgentAccess
  defaultModelPolicy: SubAgentDefaultModelPolicy
  builtin: boolean
}

export type SubAgentBuiltinOverride = {
  enabled?: boolean
  modelSource?: SubAgentModelSource
  modelKey?: string
}

export type CustomSubAgentDefinition = {
  id: string
  description: string
  prompt: string
  access: SubAgentAccess
  enabled?: boolean
  modelSource?: SubAgentModelSource
  modelKey?: string
}

export type SubAgentHostConfig = {
  /** 应用是否启用 Sub Agent；且需至少一个可用 Agent */
  enabled: boolean
  maxConcurrent: number
  builtinOverrides: {
    explore?: SubAgentBuiltinOverride
    general?: SubAgentBuiltinOverride
  }
  customAgents: CustomSubAgentDefinition[]
  /** 主 Agent 当前解析出的 modelKey（general 默认 inherit） */
  parentModelKey: string | undefined
  /** 主 Agent 权限档；只读父强制子只读 */
  parentAccess: SubAgentAccess
  actor?: string
  actorLabel?: string
  /** 可选：关联主对话用量/日志 */
  parentRunId?: string
}

/** 合并 override / 权限封顶后的可用 Sub Agent */
export type EffectiveSubAgent = {
  id: string
  description: string
  systemPrompt: string
  access: SubAgentAccess
  modelKey: string | undefined
  builtin: boolean
}

export type SubAgentRunResult = {
  runId: string
  text: string
  toolCallCount: number
  incomplete?: boolean
}
