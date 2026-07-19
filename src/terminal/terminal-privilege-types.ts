export type TerminalPrivilegeKind =
  | 'mount'
  | 'unmount'
  | 'fs.remove'
  | 'storage.removeKey'
  | 'storage.setKey'

export type TerminalPrivilegeSource = 'user' | 'help' | 'program'

export type TerminalPrivilegeArgs = {
  mountId?: string
  mountLabel?: string
  mountPath?: string
  /** 虚拟文件系统路径（如 /user/a.txt） */
  fsPath?: string
  /** 删除目标类型，用于文案 */
  fsKind?: 'file' | 'folder'
  storageKey?: string
  storageValue?: string
}

export type TerminalPrivilegeRequest = {
  id: string
  kind: TerminalPrivilegeKind
  source: TerminalPrivilegeSource
  /**
   * 可选补充说明（显示在确认框「说明」里）。
   * 主文案由系统写成：「{actor}」想要{操作}。
   */
  summary: string
  /**
   * 发起方显示名。未提供时按 source 推断：
   * user→终端，help→帮助，program→应用程序
   */
  actorLabel?: string
  args?: TerminalPrivilegeArgs
}

export type TerminalPrivilegeResult = {
  ok: boolean
  cancelled?: boolean
  message: string
}

export type TerminalPrivilegeCopy = {
  /** 对话框标题（操作名） */
  title: string
  /** 例如「终端」 */
  actorLabel: string
  /** 例如：「终端」想要挂载本机文件夹。 */
  intentLine: string
  /** 底部警告：可能后果（一句） */
  warning: string
  /** 可选补充说明（帮助等宿主给出的原因） */
  note?: string
  confirmLabel: string
  danger: boolean
}

export function createTerminalPrivilegeId(): string {
  return `priv-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function resolveTerminalPrivilegeActorLabel(
  request: Pick<TerminalPrivilegeRequest, 'source' | 'actorLabel'>,
): string {
  const explicit = request.actorLabel?.trim()
  if (explicit) return explicit
  switch (request.source) {
    case 'user':
      return '终端'
    case 'help':
      return '帮助'
    case 'program':
      return '应用程序'
  }
}
