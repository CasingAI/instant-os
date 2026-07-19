import { defineTool } from '../ai/agent-tool.ts'
import { getLocalStorageKeyLabel } from '../ai/storage-inspection.ts'
import {
  filesCopy,
  filesCreateText,
  filesList,
  filesListVolumes,
  filesMkdir,
  filesMove,
  filesReadText,
  filesRename,
  filesStat,
  filesWriteText,
} from '../apps/files/files-api.ts'
import { getLocalStorageKeyBytes } from '../os/device-storage.ts'
import { formatStorageSize } from '../os/format-storage-size.ts'
import { resolveTerminalPath } from './terminal-path.ts'
import {
  createTerminalPrivilegeId,
  type TerminalPrivilegeSource,
} from './terminal-privilege-types.ts'
import { runTerminalPrivilege, getTerminalStorageKeyDenial } from './terminal-privilege.ts'

function formatEntryLine(entry: {
  path: string
  name: string
  kind: 'file' | 'folder'
  byteSize: number
  writable: boolean
}): string {
  const kind = entry.kind === 'folder' ? 'dir' : 'file'
  const mode = entry.writable ? 'rw' : 'ro'
  const size = entry.kind === 'folder' ? '-' : String(entry.byteSize)
  return `${kind}\t${mode}\t${size}\t${entry.name}`
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

export function createTerminalFsTools(
  getCwd: () => string,
  options?: { privilegeSource?: TerminalPrivilegeSource; privilegeActorLabel?: string },
) {
  const privilegeSource = options?.privilegeSource ?? 'user'
  const privilegeActorLabel = options?.privilegeActorLabel?.trim() || '终端'
  const resolve = (path: string | undefined) => {
    const raw = (path ?? '.').trim() || '.'
    return resolveTerminalPath(getCwd(), raw)
  }

  return [
    defineTool({
      name: 'list_volumes',
      description: '列出虚拟文件系统中的卷（/user、/system、/models、挂载卷等）',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
      execute: async () => {
        const volumes = await filesListVolumes()
        if (volumes.length === 0) return '(无卷)'
        return volumes
          .map((volume) => `${volume.writable ? 'rw' : 'ro'}\t${volume.path}\t${volume.label}`)
          .join('\n')
      },
    }),
    defineTool({
      name: 'list_dir',
      description: '列出目录内容。path 可为相对当前工作目录的路径，默认当前目录。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', description: '目录路径，相对或绝对' },
        },
      },
      execute: async (args) => {
        const path = resolve(asString(args.path, '.'))
        const entries = await filesList(path)
        if (entries.length === 0) return '(空目录)'
        return entries.map(formatEntryLine).join('\n')
      },
    }),
    defineTool({
      name: 'stat_path',
      description: '查询路径是否存在及其类型、大小、可写性',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['path'],
        properties: {
          path: { type: 'string' },
        },
      },
      execute: async (args) => {
        const path = resolve(asString(args.path))
        const entry = await filesStat(path)
        if (!entry) return `不存在: ${path}`
        return [
          `path: ${entry.path}`,
          `name: ${entry.name}`,
          `kind: ${entry.kind}`,
          `size: ${entry.byteSize}`,
          `writable: ${entry.writable}`,
        ].join('\n')
      },
    }),
    defineTool({
      name: 'read_text',
      description: '读取文本文件全部内容',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['path'],
        properties: {
          path: { type: 'string' },
        },
      },
      execute: async (args) => {
        const path = resolve(asString(args.path))
        return await filesReadText(path)
      },
    }),
    defineTool({
      name: 'write_text',
      description: '覆写已存在的文本文件内容',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'text'],
        properties: {
          path: { type: 'string' },
          text: { type: 'string' },
        },
      },
      execute: async (args) => {
        const path = resolve(asString(args.path))
        const entry = await filesWriteText(path, asString(args.text))
        return `已写入 ${entry.path} (${entry.byteSize} bytes)`
      },
    }),
    defineTool({
      name: 'create_text',
      description: '新建文本文件（不可覆盖已有路径）',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['path'],
        properties: {
          path: { type: 'string' },
          text: { type: 'string', description: '可选初始内容，默认空' },
        },
      },
      execute: async (args) => {
        const path = resolve(asString(args.path))
        const entry = await filesCreateText(path, asString(args.text, ''))
        return `已创建 ${entry.path}`
      },
    }),
    defineTool({
      name: 'mkdir',
      description: '新建文件夹（父目录须已存在）',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['path'],
        properties: {
          path: { type: 'string', description: '新文件夹的完整路径（相对或绝对）' },
        },
      },
      execute: async (args) => {
        const path = resolve(asString(args.path))
        const entry = await filesMkdir(path)
        return `已创建目录 ${entry.path}`
      },
    }),
    defineTool({
      name: 'rename',
      description: '在同一父目录下重命名文件或文件夹',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'next_name'],
        properties: {
          path: { type: 'string' },
          next_name: { type: 'string', description: '新名称（不含路径）' },
        },
      },
      execute: async (args) => {
        const path = resolve(asString(args.path))
        const entry = await filesRename(path, asString(args.next_name))
        return `已重命名为 ${entry.path}`
      },
    }),
    defineTool({
      name: 'remove',
      description: '删除文件或文件夹（文件夹会递归删除；会弹确认对话框）',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['path'],
        properties: {
          path: { type: 'string' },
        },
      },
      execute: async (args) => {
        const path = resolve(asString(args.path))
        const entry = await filesStat(path)
        if (!entry) return `路径不存在: ${path}`
        const result = await runTerminalPrivilege({
          id: createTerminalPrivilegeId(),
          kind: 'fs.remove',
          source: privilegeSource,
          actorLabel: privilegeActorLabel,
          summary: '',
          args: {
            fsPath: path,
            fsKind: entry.kind === 'folder' ? 'folder' : 'file',
          },
        })
        if (result.cancelled) return '用户取消删除'
        return result.message
      },
    }),
    defineTool({
      name: 'copy',
      description: '将文件/文件夹复制到目标目录（保留原名；同名自动加后缀）',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['source', 'dest_dir'],
        properties: {
          source: { type: 'string' },
          dest_dir: { type: 'string', description: '已存在的目标目录' },
        },
      },
      execute: async (args) => {
        const source = resolve(asString(args.source))
        const destDir = resolve(asString(args.dest_dir))
        const entry = await filesCopy(source, destDir)
        return `已复制到 ${entry.path}`
      },
    }),
    defineTool({
      name: 'move',
      description: '将文件/文件夹移动到目标目录（跨目录：复制后删源；保留原名）',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['source', 'dest_dir'],
        properties: {
          source: { type: 'string' },
          dest_dir: { type: 'string', description: '已存在的目标目录' },
        },
      },
      execute: async (args) => {
        const source = resolve(asString(args.source))
        const destDir = resolve(asString(args.dest_dir))
        const entry = await filesMove(source, destDir)
        return `已移动到 ${entry.path}`
      },
    }),
    defineTool({
      name: 'storage_list_keys',
      description: '列出 localStorage 全部键名、字节大小与可读标签（只读，不需确认）',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
      execute: async () => {
        const keys: string[] = []
        for (let index = 0; index < localStorage.length; index += 1) {
          const key = localStorage.key(index)
          if (key) keys.push(key)
        }
        keys.sort((a, b) => a.localeCompare(b))
        if (keys.length === 0) return '(localStorage 为空)'
        return keys
          .map((key) => {
            const bytes = getLocalStorageKeyBytes(key)
            return `${formatStorageSize(bytes)}\t${key}\t${getLocalStorageKeyLabel(key)}`
          })
          .join('\n')
      },
    }),
    defineTool({
      name: 'storage_get_key',
      description: '读取指定 localStorage 键的文本值（只读；账户与 API Key 键会直接拒绝；过长会截断）',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['key'],
        properties: {
          key: { type: 'string' },
        },
      },
      execute: async (args) => {
        const key = asString(args.key).trim()
        if (!key) return '缺少 key'
        const denial = getTerminalStorageKeyDenial(key)
        if (denial) return denial
        const value = localStorage.getItem(key)
        if (value === null) return `键不存在: ${key}`
        const max = 8000
        if (value.length <= max) return value
        return `${value.slice(0, max)}\n…（已截断，共 ${value.length} 字符）`
      },
    }),
    defineTool({
      name: 'storage_set_key',
      description: '写入或覆盖 localStorage 键（敏感，会弹确认；账户与 API Key 键会直接拒绝）',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'value'],
        properties: {
          key: { type: 'string' },
          value: { type: 'string', description: '要写入的完整文本值' },
        },
      },
      execute: async (args) => {
        const key = asString(args.key).trim()
        if (!key) return '缺少 key'
        const value = asString(args.value)
        const result = await runTerminalPrivilege({
          id: createTerminalPrivilegeId(),
          kind: 'storage.setKey',
          source: privilegeSource,
          actorLabel: privilegeActorLabel,
          summary: '',
          args: { storageKey: key, storageValue: value },
        })
        if (result.cancelled) return '用户取消写入'
        return result.message
      },
    }),
    defineTool({
      name: 'storage_remove_key',
      description: '删除指定 localStorage 键（敏感，会弹确认；账户与 API Key 键会直接拒绝）',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['key'],
        properties: {
          key: { type: 'string' },
        },
      },
      execute: async (args) => {
        const key = asString(args.key).trim()
        if (!key) return '缺少 key'
        const result = await runTerminalPrivilege({
          id: createTerminalPrivilegeId(),
          kind: 'storage.removeKey',
          source: privilegeSource,
          actorLabel: privilegeActorLabel,
          summary: '',
          args: { storageKey: key },
        })
        if (result.cancelled) return '用户取消删除'
        return result.message
      },
    }),
  ]
}
