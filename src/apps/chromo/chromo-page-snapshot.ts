import { formatChromoEvalValue } from './chromo-eval-format.ts'

export type ChromoPageSnapshot = {
  title: string
  text: string
  raw?: string
  error?: string
}

const PAGE_SNAPSHOT_SCRIPT = `(function () {
  var body = document.body
  var text = body ? body.innerText : ''
  return {
    title: document.title || '',
    text: (text || '').replace(/\\s+/g, ' ').trim().slice(0, 12000),
  }
})()`

function parseSnapshotValue(value: unknown): ChromoPageSnapshot | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const record = value as Record<string, unknown>
  const title = typeof record.title === 'string' ? record.title : ''
  const text = typeof record.text === 'string' ? record.text : ''

  if (!title && !text) {
    return undefined
  }

  return { title, text }
}

export async function fetchChromoPageSnapshot(
  evalInPage: (code: string) => Promise<unknown>,
): Promise<ChromoPageSnapshot> {
  try {
    const value = await evalInPage(PAGE_SNAPSHOT_SCRIPT)
    const raw = formatChromoEvalValue(value)
    const parsed = parseSnapshotValue(value)

    if (parsed) {
      return { ...parsed, raw }
    }

    if (typeof value === 'string' && value.trim()) {
      return { title: '', text: value.trim().slice(0, 12000), raw }
    }

    return {
      title: '',
      text: '',
      raw,
      error: '未能从页面读取文本（返回为空）',
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      title: '',
      text: '',
      error: message,
    }
  }
}

export function buildSnapshotContext(
  snapshot: ChromoPageSnapshot,
  page: { url: string; title: string },
): string {
  const lines = [
    '【当前页面（已由浏览器读取，可直接使用）】',
    `地址栏 URL：${page.url || '未知'}`,
    `标签标题：${page.title || snapshot.title || '未知'}`,
  ]

  if (snapshot.title) {
    lines.push(`document.title：${snapshot.title}`)
  }

  if (snapshot.error) {
    lines.push(`读取正文失败：${snapshot.error}`)
  } else if (snapshot.text) {
    lines.push(`正文摘录（前 ${snapshot.text.length} 字）：\n${snapshot.text}`)
  } else {
    lines.push('正文摘录：空')
  }

  lines.push('不要声称「页面尚未加载」——上述信息来自当前标签页。如需更多细节，请调用 run_javascript。')
  return lines.join('\n')
}
