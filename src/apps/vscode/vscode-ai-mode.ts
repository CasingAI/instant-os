export type VscodeAiMode = 'ask' | 'plan' | 'agent'

export const VSCODE_AI_MODE_LABELS: Record<VscodeAiMode, string> = {
  ask: 'Ask',
  plan: 'Plan',
  agent: 'Agent',
}

/** switch_mode 可切到的目标（不含 Ask） */
export type VscodeAiSwitchModeTarget = 'plan' | 'agent'

/** 各模式下允许的 switch_mode 目标 */
export const VSCODE_AI_SWITCH_MODE_TARGETS: Record<
  VscodeAiMode,
  readonly VscodeAiSwitchModeTarget[]
> = {
  ask: ['plan'],
  plan: ['agent'],
  agent: ['plan'],
}

export function isVscodeAiMode(value: unknown): value is VscodeAiMode {
  return value === 'ask' || value === 'plan' || value === 'agent'
}

export function isVscodeAiSwitchModeTarget(
  value: unknown,
): value is VscodeAiSwitchModeTarget {
  return value === 'plan' || value === 'agent'
}

export function normalizeVscodeAiMode(value: unknown): VscodeAiMode {
  if (value === 'edit') return 'ask'
  if (isVscodeAiMode(value)) return value
  return 'ask'
}

export type ResolveSwitchModeTargetResult =
  | { ok: true; target: VscodeAiSwitchModeTarget }
  | { ok: false; error: string }

/**
 * 校验 switch_mode 的 target_mode_id：须为合法目标，且相对当前模式允许切换。
 */
export function resolveSwitchModeTarget(
  current: VscodeAiMode,
  raw: unknown,
): ResolveSwitchModeTargetResult {
  if (!isVscodeAiSwitchModeTarget(raw)) {
    const allowed = VSCODE_AI_SWITCH_MODE_TARGETS[current]
    return {
      ok: false,
      error: `无效的 target_mode_id（收到：${String(raw)}）。当前模式 ${VSCODE_AI_MODE_LABELS[current]} 可切到：${allowed.join(', ')}。`,
    }
  }
  if (raw === current) {
    return {
      ok: false,
      error: `已在 ${VSCODE_AI_MODE_LABELS[current]} 模式，无需切换。`,
    }
  }
  const allowed = VSCODE_AI_SWITCH_MODE_TARGETS[current]
  if (!allowed.includes(raw)) {
    return {
      ok: false,
      error: `当前模式 ${VSCODE_AI_MODE_LABELS[current]} 不能切换到 ${VSCODE_AI_MODE_LABELS[raw]}。可切到：${allowed.join(', ')}。`,
    }
  }
  return { ok: true, target: raw }
}
