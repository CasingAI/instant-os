export type VscodeAiMode = 'ask' | 'edit' | 'agent'

export const VSCODE_AI_MODE_LABELS: Record<VscodeAiMode, string> = {
  ask: 'Ask',
  edit: 'Edit',
  agent: 'Agent',
}

export function isVscodeAiMode(value: unknown): value is VscodeAiMode {
  return value === 'ask' || value === 'edit' || value === 'agent'
}

export function normalizeVscodeAiMode(value: unknown): VscodeAiMode {
  if (isVscodeAiMode(value)) return value
  return 'ask'
}
