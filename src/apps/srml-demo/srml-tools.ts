/**
 * SRML 内置工具集。
 *
 * 文件类工具双环境适配：
 * - Node 环境（测试 / 桌面壳）：真实读写文件系统。
 * - 浏览器环境（vite dev / build 产物）：走内存虚拟文件系统，
 *   并持久化到 localStorage（键 srml-virtual-fs），避免页面刷新丢失。
 *
 * 模型视角：工具都是真实能力，不暴露实现细节（download_file 的耗时
 * 是模拟的网络传输，但对模型只表现为「下载需要一点时间」）。
 *
 * 安全边界（代码层，不写进工具描述）：
 * - 读取（list_files / read_file）：限定在工作区内（相对路径，防 ../ 越界）。
 * - 写入（write_file / download_file 落盘）：仅限沙盒目录 srml-demo-workspace/ 内。
 *
 * 工具定义注入系统提示词（见 srml-agent.ts 的 buildSrmlToolList），
 * estimatedMs > 0 时清单会显示「预计耗时」，让模型知道哪些工具慢。
 */
import {
  isTraversal,
  isWithinSandbox,
  listDir,
  normalizePath,
  readFile,
  SANDBOX_DIR,
  writeFile,
} from './srml-workspace.ts'

export type SrmlToolDefinition = {
  name: string
  description: string
  /** 参数说明（人读文本，注入系统提示词） */
  parameters: string
  /** 预计耗时毫秒（注入系统提示词） */
  estimatedMs: number
  execute: (args: Record<string, unknown>, signal?: AbortSignal) => Promise<string>
}

export const SRML_TOOLS: SrmlToolDefinition[] = [
  {
    name: 'get_current_time',
    description: '获取指定时区的当前日期时间',
    parameters: '{"timezone": "string，可选，IANA 时区名，默认 Asia/Shanghai"}',
    estimatedMs: 0,
    async execute(args) {
      const timezone = typeof args.timezone === 'string' ? args.timezone : 'Asia/Shanghai'
      try {
        const now = new Date()
        const formatter = new Intl.DateTimeFormat('zh-CN', {
          timeZone: timezone,
          dateStyle: 'full',
          timeStyle: 'medium',
        })
        return JSON.stringify({ datetime: formatter.format(now), timezone, iso: now.toISOString() })
      } catch {
        return JSON.stringify({ error: `未知时区：${timezone}` })
      }
    },
  },
  {
    name: 'calculate',
    description: '执行一个安全的四则运算表达式并返回结果',
    parameters: '{"expression": "string，必填，如 (1+2)*3"}',
    estimatedMs: 0,
    async execute(args) {
      const expression = typeof args.expression === 'string' ? args.expression.trim() : ''
      if (!expression) return JSON.stringify({ error: '缺少 expression 参数' })
      if (!/^[0-9+\-*/%().\s]+$/.test(expression)) {
        return JSON.stringify({ error: '表达式包含非法字符，只允许数字与 + - * / % ( )' })
      }
      try {
        // 已通过白名单校验（无字母、无对象访问），仅做算术求值
        const result = Function(`'use strict'; return (${expression})`)()
        if (typeof result !== 'number' || !Number.isFinite(result)) {
          return JSON.stringify({ error: '无法计算该表达式' })
        }
        return JSON.stringify({ expression, result })
      } catch (error) {
        return JSON.stringify({ error: `计算失败：${error instanceof Error ? error.message : String(error)}` })
      }
    },
  },
  {
    name: 'download_file',
    description: '从远程地址下载文件到工作区，返回保存路径、文件大小与内容预览',
    parameters: '{"url": "string，必填，远程文件地址", "filename": "string，可选，保存的文件名，默认取自 URL"}',
    estimatedMs: 2000,
    async execute(args, signal) {
      const url = typeof args.url === 'string' ? args.url.trim() : ''
      if (!url) return JSON.stringify({ error: '缺少 url 参数' })
      let filename =
        typeof args.filename === 'string' && args.filename.trim() ? args.filename.trim() : ''
      if (!filename) {
        filename = url.split('/').pop()?.split('?')[0] ?? ''
      }
      filename = normalizePath(filename)
      if (!filename || filename === '.' || isTraversal(filename)) {
        filename = `download_${Date.now()}.txt`
      }
      const filePath = `${SANDBOX_DIR}/${filename}`
      // 模拟网络传输耗时（对模型只表现为「下载需要一点时间」）
      await sleep(2000, signal)
      const content = [
        `# ${filename}`,
        '',
        `来源: ${url}`,
        `下载时间: ${new Date().toISOString()}`,
        '',
        '本文档记录了从上述地址获取的资料内容，供后续任务读取与引用。',
      ].join('\n')
      await writeFile(filePath, content)
      return JSON.stringify({
        status: 'downloaded',
        path: filePath,
        size: new TextEncoder().encode(content).length,
        preview: content.slice(0, 120),
      })
    },
  },
  {
    name: 'list_files',
    description: '列出工作区内某个目录下的文件与子目录',
    parameters: '{"dir": "string，可选，相对工作区的目录，默认根目录"}',
    estimatedMs: 0,
    async execute(args) {
      const dir = typeof args.dir === 'string' ? args.dir : ''
      const normalized = normalizePath(dir)
      if (isTraversal(normalized)) return JSON.stringify({ error: '路径越界，不允许访问工作区之外' })
      const entries = await listDir(normalized)
      return JSON.stringify({ dir: normalized || '.', entries })
    },
  },
  {
    name: 'read_file',
    description: '读取工作区内某个文本文件的内容',
    parameters: '{"path": "string，必填，相对工作区的文件路径"}',
    estimatedMs: 0,
    async execute(args) {
      const path = typeof args.path === 'string' ? args.path : ''
      const normalized = normalizePath(path)
      if (isTraversal(normalized)) return JSON.stringify({ error: '路径越界，不允许访问工作区之外' })
      const content = await readFile(normalized)
      if (content === null) return JSON.stringify({ error: `文件不存在：${normalized}` })
      const max = 8000
      const truncated = content.length > max
      return JSON.stringify({
        path: normalized,
        length: content.length,
        content: truncated ? `${content.slice(0, max)}\n…(已截断)` : content,
      })
    },
  },
  {
    name: 'write_file',
    description: '写入（或覆盖）工作区中的一个文本文件',
    parameters: '{"path": "string，必填，目标文件路径", "content": "string，必填，文件内容"}',
    estimatedMs: 0,
    async execute(args) {
      const path = typeof args.path === 'string' ? args.path : ''
      const content = typeof args.content === 'string' ? args.content : ''
      const normalized = normalizePath(path)
      if (!isWithinSandbox(normalized)) {
        return JSON.stringify({ error: `不允许写入该路径（仅限工作区内可写目录）：${normalized}` })
      }
      await writeFile(normalized, content)
      return JSON.stringify({ status: 'written', path: normalized, length: content.length })
    },
  },
]

export function findTool(name: string): SrmlToolDefinition | undefined {
  return SRML_TOOLS.find((tool) => tool.name === name)
}

/** 工具清单序列化（注入系统提示词） */
export function buildSrmlToolList(): string {
  return SRML_TOOLS.map((tool, index) => {
    const lines = [
      `<|begin_of_tool_${index + 1}|>`,
      `名称: ${tool.name}`,
      `描述: ${tool.description}`,
      `参数: ${tool.parameters}`,
    ]
    if (tool.estimatedMs > 0) {
      const seconds = Math.max(1, Math.round(tool.estimatedMs / 1000))
      lines.push(`预计耗时: 约 ${seconds} 秒`)
    }
    lines.push(`<|end_of_tool_${index + 1}|>`)
    return lines.join('\n')
  }).join('\n\n')
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
