/**
 * 第九期（iCode agent 接入 VFS 并发检查）：记读、写时带期望版本。
 *
 * 挂在 agent 会话实例的宿主侧（用户自己的终端不挂）：
 * - 读类成功后记住 path → contentRevisionId（读后即记，无需显式声明）；
 * - 写前若表中有该路径的记录，则补 expectedContentRevisionId，
 *   文件被外部改过时由第八期校验拒绝（错误信息提示重读）；
 * - 从未读过的路径不填（盲写放行），保留脚本式一次性写出的用法；
 * - 写入成功后用 writtenContentRevisionId 刷新记录；结构性变更
 *   （删除/改名/复制覆盖/流式打开）剔除记录，避免持有陈旧期望。
 *
 * 记录只存在实例内存里，跟随实例销毁消失，不落盘。
 */
import type { QuickJsSyscallInterceptor } from './quickjs-syscall.ts'

/** 会回填 observedContentRevisionId 的读类动作（access 也回填，一并记账） */
const TRACKED_READ_ACTIONS: ReadonlySet<string> = new Set([
  'file.readFile',
  'file.stat',
  'file.lstat',
  'file.access',
])

export function createFsRevisionMemoryInterceptor(): QuickJsSyscallInterceptor {
  const revisions = new Map<string, string>()

  /** 剔除一条记录及其子树（rm -r / 目录改名会让整棵子树的记录失效） */
  const forgetTree = (path: string): void => {
    revisions.delete(path)
    const prefix = `${path}/`
    for (const key of revisions.keys()) {
      if (key.startsWith(prefix)) {
        revisions.delete(key)
      }
    }
  }

  const pathOf = (params: Record<string, unknown>, key = 'path'): string | undefined =>
    typeof params[key] === 'string' ? (params[key] as string) : undefined

  return {
    name: 'fs-revision-memory',
    matches: (syscallName) => syscallName.startsWith('file.'),
    before(invocation) {
      if (invocation.name !== 'file.writeFile' && invocation.name !== 'file.appendFile') return
      const path = pathOf(invocation.params)
      if (path === undefined) return
      const expected = revisions.get(path)
      if (expected !== undefined && invocation.params.expectedContentRevisionId === undefined) {
        invocation.params.expectedContentRevisionId = expected
      }
    },
    after(invocation) {
      const params = invocation.params
      if (TRACKED_READ_ACTIONS.has(invocation.name)) {
        const path = pathOf(params)
        if (path === undefined) return
        if (
          params.observedKind === 'file' &&
          typeof params.observedContentRevisionId === 'string'
        ) {
          revisions.set(path, params.observedContentRevisionId)
        } else {
          // 记下的不再是普通文件（目录/软链/被删），清掉旧期望
          forgetTree(path)
        }
        return
      }
      switch (invocation.name) {
        case 'file.writeFile':
        case 'file.appendFile': {
          const path = pathOf(params)
          if (path === undefined) return
          const written = params.writtenContentRevisionId
          if (typeof written === 'string') {
            revisions.set(path, written)
          }
          // 新建文件没有回填值：保留可能已失效的旧期望，让下一次写先被拒再重读，宁严勿漏
          return
        }
        case 'file.openStreamWrite': {
          // 真正的落盘发生在之后逐 chunk 的 writes 里、不经过拦截链；
          // 打开即视为内容将变，剔除记录使后续写退回盲写/重读。
          const path = pathOf(params)
          if (path !== undefined) forgetTree(path)
          return
        }
        case 'file.unlink':
        case 'file.rm':
        case 'file.rmdir': {
          const path = pathOf(params)
          if (path !== undefined) forgetTree(path)
          return
        }
        case 'file.copyFile': {
          const dest = pathOf(params, 'dest')
          if (dest !== undefined) forgetTree(dest)
          return
        }
        case 'file.rename': {
          const from = pathOf(params, 'from')
          const to = pathOf(params, 'to')
          if (from !== undefined) forgetTree(from)
          if (to !== undefined) forgetTree(to)
          return
        }
        default:
          return
      }
    },
  }
}
