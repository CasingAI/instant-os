import type { SubAgentHostConfig } from '../../ai/subagent/index.ts'
import { listAvailableSubAgents } from '../../ai/subagent/index.ts'
import type { VscodeAiMode } from './vscode-ai-mode.ts'
import { vscodeAiModelKeyHasVision } from './vscode-ai-models.ts'
import type { VscodePrefs } from './vscode-prefs.ts'

/** Ask/Plan → 只读父；Agent → 可读写父（子 Agent 权限不得高于父） */
export function parentAccessForVscodeAiMode(
  mode: VscodeAiMode,
): SubAgentHostConfig['parentAccess'] {
  return mode === 'ask' || mode === 'plan' ? 'readonly' : 'full'
}

/**
 * 从 VS Code prefs 构建传给系统 Sub Agent 运行时的 host config。
 * 内置 override 仅含 enabled + 模型，不改系统 prompt。
 */
export function buildVscodeSubAgentHostConfig(
  prefs: Pick<
    VscodePrefs,
    | 'subAgentsEnabled'
    | 'subAgentsMaxConcurrent'
    | 'subAgentBuiltinOverrides'
    | 'customSubAgents'
  >,
  mode: VscodeAiMode,
  parentModelKey: string | undefined,
  extras?: {
    parentRunId?: string
  },
): SubAgentHostConfig {
  const base: SubAgentHostConfig = {
    enabled: prefs.subAgentsEnabled,
    maxConcurrent: prefs.subAgentsMaxConcurrent,
    builtinOverrides: {
      explore: prefs.subAgentBuiltinOverrides.explore,
      general: prefs.subAgentBuiltinOverrides.general,
      vision: prefs.subAgentBuiltinOverrides.vision,
    },
    customAgents: prefs.customSubAgents.map((agent) => ({
      id: agent.id,
      description: agent.description,
      prompt: agent.prompt,
      access: agent.access,
      enabled: agent.enabled,
      modelSource: agent.modelSource,
      modelKey: agent.modelKey,
    })),
    parentModelKey,
    parentAccess: parentAccessForVscodeAiMode(mode),
    parentHasVision: vscodeAiModelKeyHasVision(parentModelKey),
    actor: 'vscode',
    actorLabel: 'Virtual Studio Code',
    parentRunId: extras?.parentRunId,
  }

  // 应用开启但无任何可用 Agent 时，对运行时视为关闭（不注册委派工具）
  if (!base.enabled || listAvailableSubAgents({ ...base, enabled: true }).length === 0) {
    return { ...base, enabled: false }
  }
  return base
}
