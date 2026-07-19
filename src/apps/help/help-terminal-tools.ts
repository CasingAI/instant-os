import { defineTool } from '../../ai/agent-tool.ts'
import { osOpenApp } from '../../os/os-open-app-bridge.ts'
import { createTerminalPrivilegeId } from '../../terminal/terminal-privilege-types.ts'
import type { TerminalPrivilegeKind } from '../../terminal/terminal-privilege-types.ts'

const KIND_SET = new Set<TerminalPrivilegeKind>([
  'mount',
  'unmount',
  'fs.remove',
  'storage.removeKey',
])

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

/**
 * 帮助不能自己改系统：需要动手时打开终端并注入待确认特权操作。
 * 账户与 API Key 不可经终端处理，应引导用户打开「钥匙串」。
 */
export const HELP_TERMINAL_REQUEST_TOOLS = [
  defineTool({
    name: 'request_terminal_action',
    description:
      '当用户需要挂载/卸载本机文件夹、删除虚拟文件系统中的文件/文件夹、或删除非账户类 localStorage 键时调用。会打开「终端」并提交待用户确认的特权操作。账户与 API Key 请引导用户打开「钥匙串」，不要经终端清空或改写。你自己不能改数据。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'summary'],
      properties: {
        kind: {
          type: 'string',
          enum: ['mount', 'unmount', 'fs.remove', 'storage.removeKey'],
          description: '特权操作类型',
        },
        summary: {
          type: 'string',
          description:
            '补充说明（可选）：为何建议用户做此事；会显示在确认框「说明」里。操作本身由 kind 决定，文案会写成「帮助」想要…',
        },
        mount_path: {
          type: 'string',
          description: '卸载时可选：挂载路径如 /mount/xxxxxxxx 或卷标签',
        },
        fs_path: {
          type: 'string',
          description: 'fs.remove 时必填：要删除的虚拟文件系统绝对路径',
        },
        fs_kind: {
          type: 'string',
          enum: ['file', 'folder'],
          description: 'fs.remove 时可选：文件或文件夹（影响确认文案）',
        },
        storage_key: {
          type: 'string',
          description: 'storage.removeKey 时必填：localStorage 键名（不可为账户设置键）',
        },
      },
    },
    execute: async (args) => {
      const kindRaw = asString(args.kind).trim() as TerminalPrivilegeKind
      if (!KIND_SET.has(kindRaw)) {
        return '无效的 kind；请使用 mount / unmount / fs.remove / storage.removeKey。账户相关请引导用户打开「钥匙串」。'
      }
      const summary = asString(args.summary).trim()
      const mountPath = asString(args.mount_path).trim()
      const fsPath = asString(args.fs_path).trim()
      const fsKindRaw = asString(args.fs_kind).trim()
      const fsKind = fsKindRaw === 'folder' ? 'folder' : fsKindRaw === 'file' ? 'file' : undefined
      const storageKey = asString(args.storage_key).trim()

      if (kindRaw === 'storage.removeKey' && !storageKey) {
        return 'storage.removeKey 需要提供 storage_key'
      }
      if (kindRaw === 'fs.remove' && !fsPath) {
        return 'fs.remove 需要提供 fs_path'
      }
      if (kindRaw === 'unmount' && !mountPath) {
        return 'unmount 需要提供 mount_path（可用终端 umount 先列出挂载卷）'
      }

      try {
        osOpenApp('terminal', {
          terminalAction: {
            id: createTerminalPrivilegeId(),
            kind: kindRaw,
            source: 'help',
            actorLabel: '帮助',
            summary,
            args: {
              mountPath: mountPath || undefined,
              mountLabel: mountPath || undefined,
              fsPath: fsPath || undefined,
              fsKind,
              storageKey: storageKey || undefined,
            },
          },
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return `无法打开终端：${message}`
      }

      return '已打开「终端」并提交待确认操作。请引导用户查看弹出的确认对话框；你不要声称操作已经完成。'
    },
  }),
]
