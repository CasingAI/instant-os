import { defineTool, type AgentTool } from './agent-tool.ts'
import {
  grepSource,
  listSourcePaths,
  readSourceFile,
} from './source-snapshot-store.ts'

const MAX_READ_CHARS = 24_000

export const listSourceTreeTool = defineTool<{
  prefix?: string
  max_depth?: number
}>({
  name: 'list_source_tree',
  description:
    '列出 Instant OS 资料快照中的文件路径（含 src 源码、根目录 README 等说明文档）。可用 prefix 限定目录（如 src/apps/help、README.md、src/bridge），用 max_depth 限制相对深度。',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      prefix: {
        type: 'string',
        description: '可选路径前缀，例如 src/apps/help、src/bridge 或 README.md',
      },
      max_depth: {
        type: 'number',
        description: '相对 prefix 的最大路径深度；省略则不限制',
      },
    },
  },
  async execute(args) {
    const paths = await listSourcePaths({
      prefix: typeof args.prefix === 'string' ? args.prefix : undefined,
      maxDepth: typeof args.max_depth === 'number' ? args.max_depth : undefined,
    })
    return {
      count: paths.length,
      paths,
    }
  },
})

export const readSourceFileTool = defineTool<{
  path: string
  start_line?: number
  end_line?: number
}>({
  name: 'read_source_file',
  description:
    '按路径读取资料快照中的单个文件。路径相对于仓库根目录，例如 src/apps/settings/settings-app.tsx、README.md。可用 start_line / end_line（从 1 起，含两端）读取片段；若返回 truncated，请用更大的 start_line 继续读后半段。回答操作步骤时应核对应用/设置源码的界面文案；README 等文档用于产品能力与语境，宜按段落读取并与源码交叉验证。',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['path'],
    properties: {
      path: {
        type: 'string',
        description: '相对仓库根的路径',
      },
      start_line: {
        type: 'number',
        description: '起始行号（从 1 起，含）。省略则从第 1 行开始',
      },
      end_line: {
        type: 'number',
        description: '结束行号（从 1 起，含）。省略则读到文件末尾',
      },
    },
  },
  async execute(args) {
    const path = typeof args.path === 'string' ? args.path.trim() : ''
    if (!path) {
      return { error: 'path 不能为空' }
    }

    const content = await readSourceFile(path)
    if (content === undefined) {
      return { error: `文件不存在: ${path}` }
    }

    const lines = content.split('\n')
    const totalLines = lines.length
    const requestedStart =
      typeof args.start_line === 'number' && Number.isFinite(args.start_line)
        ? Math.floor(args.start_line)
        : 1
    const requestedEnd =
      typeof args.end_line === 'number' && Number.isFinite(args.end_line)
        ? Math.floor(args.end_line)
        : totalLines

    if (requestedStart < 1) {
      return { error: 'start_line 必须 ≥ 1' }
    }
    if (requestedEnd < requestedStart) {
      return { error: 'end_line 必须 ≥ start_line' }
    }

    const startLine = Math.min(requestedStart, totalLines + 1)
    const endLine = Math.min(requestedEnd, totalLines)
    if (startLine > totalLines) {
      return {
        path,
        content: '',
        startLine,
        endLine: totalLines,
        totalLines,
        truncated: false,
        originalLength: content.length,
      }
    }

    const selected = lines.slice(startLine - 1, endLine)
    let usedEndLine = endLine
    let selectedText = selected.join('\n')
    let truncated = false

    if (selectedText.length > MAX_READ_CHARS) {
      truncated = true
      let charCount = 0
      const kept: string[] = []
      for (let index = 0; index < selected.length; index += 1) {
        const line = selected[index] ?? ''
        const nextCount = charCount + line.length + (kept.length > 0 ? 1 : 0)
        if (nextCount > MAX_READ_CHARS && kept.length > 0) {
          break
        }
        kept.push(line)
        charCount = nextCount
        usedEndLine = startLine + kept.length - 1
        if (charCount >= MAX_READ_CHARS) {
          break
        }
      }
      selectedText = kept.join('\n')
    }

    return {
      path,
      content: truncated
        ? `${selectedText}\n\n…[已截断，已读到第 ${usedEndLine} 行 / 共 ${totalLines} 行；可用 start_line=${usedEndLine + 1} 继续]`
        : selectedText,
      startLine,
      endLine: usedEndLine,
      totalLines,
      truncated,
      originalLength: content.length,
      nextStartLine: truncated ? usedEndLine + 1 : undefined,
    }
  },
})

export const grepSourceTool = defineTool<{
  pattern: string
  path_prefix?: string
  case_insensitive?: boolean
  max_matches?: number
}>({
  name: 'grep_source',
  description:
    '在资料快照中用正则搜索（源码与 Markdown 说明文档均在内）。返回路径、行号与行摘录。先用本工具定位，再用 read_source_file 阅读相关文件。',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['pattern'],
    properties: {
      pattern: {
        type: 'string',
        description: 'JavaScript 正则（不要包斜杠）',
      },
      path_prefix: {
        type: 'string',
        description: '可选目录前缀，缩小搜索范围',
      },
      case_insensitive: {
        type: 'boolean',
        description: '默认 true（忽略大小写）',
      },
      max_matches: {
        type: 'number',
        description: '最多返回多少条匹配，默认 40',
      },
    },
  },
  async execute(args) {
    const pattern = typeof args.pattern === 'string' ? args.pattern : ''
    if (!pattern.trim()) {
      return { error: 'pattern 不能为空' }
    }

    try {
      const result = await grepSource({
        pattern,
        pathPrefix: typeof args.path_prefix === 'string' ? args.path_prefix : undefined,
        caseInsensitive: args.case_insensitive === false ? false : true,
        maxMatches: typeof args.max_matches === 'number' ? args.max_matches : undefined,
      })
      return result
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
      }
    }
  },
})

export const SOURCE_INSPECTION_TOOLS: AgentTool[] = [
  listSourceTreeTool as AgentTool,
  readSourceFileTool as AgentTool,
  grepSourceTool as AgentTool,
]
