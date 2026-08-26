/**
 * 重名冲突决策（替换 / 保留两者 / 跳过）：外部拖入导入与内部复制/剪切粘贴共用。
 * 批级包装器负责记住「应用到全部」的选择；未勾选时每个冲突单独询问。
 */

export type FilesConflictChoice = 'replace' | 'rename' | 'skip'

export type FilesConflictInfo = {
  /** 冲突的文件/文件夹名（已净化） */
  name: string
  /** 拟写入项的类型（与 existingKind 全等时才可「替换」） */
  kind: string
  /** 已存在同名目标的类型；缺失或与 kind 不同则不可「替换」 */
  existingKind?: string
  /** 已存在目标是否可写（只读文件不可「替换」） */
  existingWritable?: boolean
}

/** 弹出单个冲突询问；undefined = 用户关闭对话框（视为取消整个操作） */
export type AskFilesConflict = (
  conflict: FilesConflictInfo,
) => Promise<{ choice: FilesConflictChoice; applyToAll?: boolean } | undefined>

/** 已存在目标能否被「替换」：类型一致且可写。文件夹不提供替换（无合并语义）。 */
export function filesConflictAllowsReplace(conflict: FilesConflictInfo): boolean {
  if (conflict.existingKind !== conflict.kind) return false
  if (conflict.existingWritable === false) return false
  return true
}

/**
 * 把逐次询问包成批级决策器：勾选「应用到全部」后，同批剩余冲突按所选策略执行，
 * 不再打扰。例外：记住的是「替换」但后续冲突不可替换时，回退为逐个重新询问。
 * 返回 undefined 表示用户取消了整个操作。
 */
export function createFilesConflictResolver(ask: AskFilesConflict) {
  let remembered: FilesConflictChoice | undefined
  return async (conflict: FilesConflictInfo): Promise<FilesConflictChoice | undefined> => {
    const canReplace = filesConflictAllowsReplace(conflict)
    if (remembered && (remembered !== 'replace' || canReplace)) {
      return remembered
    }
    const answer = await ask(conflict)
    if (!answer) return undefined
    if (answer.applyToAll === true && (answer.choice !== 'replace' || canReplace)) {
      remembered = answer.choice
    }
    return answer.choice
  }
}
