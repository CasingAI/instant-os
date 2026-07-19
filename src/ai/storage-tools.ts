import { defineTool, type AgentTool } from './agent-tool.ts'
import {
  getStorageUsageSnapshot,
  listLocalStorageKeyInfos,
  readLocalStorageKeyValue,
} from './storage-inspection.ts'

export const listLocalStorageKeysTool = defineTool<{
  prefix?: string
  accounted_only?: boolean
}>({
  name: 'list_local_storage_keys',
  description:
    '列出浏览器 localStorage（系统空间）中的键：键名、用途标签、占用字节、是否可读。用于弄清「本地存了什么」。不要用它读 API Key；账户键会标为不可读。',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      prefix: {
        type: 'string',
        description: '可选键名前缀，例如 instant-os- 或 instant-os-generated-app-data:',
      },
      accounted_only: {
        type: 'boolean',
        description: '为 true 时只返回系统已归类的键；默认 false 返回全部',
      },
    },
  },
  async execute(args) {
    const keys = listLocalStorageKeyInfos({
      prefix: typeof args.prefix === 'string' ? args.prefix : undefined,
      accountedOnly: args.accounted_only === true,
    })
    return {
      count: keys.length,
      keys,
      hint: '若要理解某键含义，可 grep_source / read_source_file 搜索该键名；读内容用 read_local_storage_key。',
    }
  },
})

export const readLocalStorageKeyTool = defineTool<{
  key: string
  max_chars?: number
}>({
  name: 'read_local_storage_key',
  description:
    '读取单个 localStorage 键的内容（只读）。账户/API Key 键会被拒绝。JSON 会解析并对 apiKey 等字段脱敏；过长会截断。可结合源码中对该键的读写理解用途。',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['key'],
    properties: {
      key: {
        type: 'string',
        description: '完整键名，例如 instant-os-wallpaper-settings',
      },
      max_chars: {
        type: 'number',
        description: '返回文本最大字符数，默认 12000，上限 24000',
      },
    },
  },
  async execute(args) {
    const key = typeof args.key === 'string' ? args.key.trim() : ''
    if (!key) {
      return { error: 'key 不能为空' }
    }
    return readLocalStorageKeyValue(key, {
      maxChars: typeof args.max_chars === 'number' ? args.max_chars : undefined,
    })
  },
})

export const getStorageUsageTool = defineTool<Record<string, never>>({
  name: 'get_storage_usage',
  description:
    '读取系统存储用量总览：系统空间（localStorage）与数据空间（IndexedDB，含文件应用用户文件等）已用/上限/剩余、主要分类，以及占用靠前的应用。回答「占了多少空间、谁占得多」时优先用本工具。只读，不能清理或卸载。',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {},
  },
  async execute() {
    return getStorageUsageSnapshot()
  },
})

export const STORAGE_INSPECTION_TOOLS: AgentTool[] = [
  listLocalStorageKeysTool as AgentTool,
  readLocalStorageKeyTool as AgentTool,
  getStorageUsageTool as AgentTool,
]
