export type VscodeAiMode = 'ask' | 'plan' | 'edit' | 'agent'

export const VSCODE_AI_MODE_LABELS: Record<VscodeAiMode, string> = {
  ask: 'Ask',
  plan: 'Plan',
  edit: 'Edit',
  agent: 'Agent',
}

export function isVscodeAiMode(value: unknown): value is VscodeAiMode {
  return value === 'ask' || value === 'plan' || value === 'edit' || value === 'agent'
}

export function normalizeVscodeAiMode(value: unknown): VscodeAiMode {
  if (isVscodeAiMode(value)) return value
  return 'ask'
}
