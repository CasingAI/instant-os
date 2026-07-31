export type VscodeAiMode = 'ask' | 'plan' | 'agent'

export const VSCODE_AI_MODE_LABELS: Record<VscodeAiMode, string> = {
  ask: 'Ask',
  plan: 'Plan',
  agent: 'Agent',
}

export function isVscodeAiMode(value: unknown): value is VscodeAiMode {
  return value === 'ask' || value === 'plan' || value === 'agent'
}

export function normalizeVscodeAiMode(value: unknown): VscodeAiMode {
  if (value === 'edit') return 'ask'
  if (isVscodeAiMode(value)) return value
  return 'ask'
}
