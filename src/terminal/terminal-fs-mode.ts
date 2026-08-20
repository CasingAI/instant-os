/** 终端 / QuickJS 文件系统工作模式（创建实例时冻结，切换需重建）。 */
export type TerminalFsMode = 'normal' | 'readonly' | 'controlled'

export const TERMINAL_FS_MODE_LABEL: Record<TerminalFsMode, string> = {
  normal: '普通',
  readonly: '只读',
  controlled: '受控',
}

export function isTerminalFsMode(value: unknown): value is TerminalFsMode {
  return value === 'normal' || value === 'readonly' || value === 'controlled'
}
