/** 按文件名后缀推断 Monaco language id */
export function monacoLanguageFromFileName(fileName: string): string {
  const base = fileName.trim()
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) {
    const lower = base.toLowerCase()
    if (lower === 'dockerfile') return 'dockerfile'
    if (lower === 'makefile' || lower === 'gnumakefile') return 'makefile'
    return 'plaintext'
  }

  const ext = base.slice(dot + 1).toLowerCase()
  switch (ext) {
    case 'js':
    case 'mjs':
    case 'cjs':
      return 'javascript'
    case 'jsx':
      return 'javascript'
    case 'ts':
    case 'mts':
    case 'cts':
      return 'typescript'
    case 'tsx':
      return 'typescript'
    case 'json':
    case 'jsonc':
      return 'json'
    case 'html':
    case 'htm':
    case 'xhtml':
      return 'html'
    case 'css':
      return 'css'
    case 'scss':
      return 'scss'
    case 'less':
      return 'less'
    case 'md':
    case 'markdown':
    case 'mdx':
      return 'markdown'
    case 'xml':
    case 'svg':
      return 'xml'
    case 'yaml':
    case 'yml':
      return 'yaml'
    case 'toml':
      return 'ini'
    case 'py':
    case 'pyw':
      return 'python'
    case 'go':
      return 'go'
    case 'rs':
      return 'rust'
    case 'java':
      return 'java'
    case 'c':
    case 'h':
      return 'c'
    case 'cpp':
    case 'cc':
    case 'cxx':
    case 'hpp':
    case 'hh':
      return 'cpp'
    case 'cs':
      return 'csharp'
    case 'php':
      return 'php'
    case 'rb':
      return 'ruby'
    case 'swift':
      return 'swift'
    case 'kt':
    case 'kts':
      return 'kotlin'
    case 'dart':
      return 'dart'
    case 'lua':
      return 'lua'
    case 'r':
      return 'r'
    case 'sql':
      return 'sql'
    case 'sh':
    case 'bash':
    case 'zsh':
      return 'shell'
    case 'ps1':
      return 'powershell'
    case 'vue':
      return 'html'
    case 'svelte':
      return 'html'
    case 'graphql':
    case 'gql':
      return 'graphql'
    case 'proto':
      return 'protobuf'
    case 'ini':
    case 'conf':
    case 'cfg':
    case 'env':
    case 'properties':
      return 'ini'
    case 'txt':
    case 'log':
      return 'plaintext'
    default:
      return 'plaintext'
  }
}

/** 状态栏 / 选择器用的显示名（与 Monaco language id 对应） */
const MONACO_LANGUAGE_LABELS: Record<string, string> = {
  plaintext: 'Plain Text',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  json: 'JSON',
  html: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  less: 'Less',
  markdown: 'Markdown',
  xml: 'XML',
  yaml: 'YAML',
  ini: 'INI',
  python: 'Python',
  go: 'Go',
  rust: 'Rust',
  java: 'Java',
  c: 'C',
  cpp: 'C++',
  csharp: 'C#',
  php: 'PHP',
  ruby: 'Ruby',
  swift: 'Swift',
  kotlin: 'Kotlin',
  dart: 'Dart',
  lua: 'Lua',
  r: 'R',
  sql: 'SQL',
  shell: 'Shell Script',
  powershell: 'PowerShell',
  graphql: 'GraphQL',
  protobuf: 'Protocol Buffers',
  dockerfile: 'Dockerfile',
  makefile: 'Makefile',
}

/** 可手动切换的语言列表（按显示名排序；含 JSX/TSX 搜索别名） */
export const MONACO_SELECTABLE_LANGUAGES: readonly {
  id: string
  label: string
  keywords?: readonly string[]
}[] = [
  { id: 'c', label: 'C', keywords: ['c', 'h'] },
  { id: 'cpp', label: 'C++', keywords: ['cpp', 'cc', 'cxx', 'hpp'] },
  { id: 'csharp', label: 'C#', keywords: ['cs', 'csharp'] },
  { id: 'css', label: 'CSS', keywords: ['css'] },
  { id: 'dart', label: 'Dart', keywords: ['dart'] },
  { id: 'dockerfile', label: 'Dockerfile', keywords: ['docker'] },
  { id: 'go', label: 'Go', keywords: ['golang', 'go'] },
  { id: 'graphql', label: 'GraphQL', keywords: ['gql', 'graphql'] },
  { id: 'html', label: 'HTML', keywords: ['htm', 'html'] },
  { id: 'ini', label: 'INI', keywords: ['ini', 'conf', 'env', 'toml'] },
  { id: 'java', label: 'Java', keywords: ['java'] },
  { id: 'javascript', label: 'JavaScript', keywords: ['js', 'mjs', 'cjs', 'jsx'] },
  { id: 'json', label: 'JSON', keywords: ['json', 'jsonc'] },
  { id: 'kotlin', label: 'Kotlin', keywords: ['kt', 'kts'] },
  { id: 'less', label: 'Less', keywords: ['less'] },
  { id: 'lua', label: 'Lua', keywords: ['lua'] },
  { id: 'makefile', label: 'Makefile', keywords: ['make'] },
  { id: 'markdown', label: 'Markdown', keywords: ['md', 'mdx'] },
  { id: 'php', label: 'PHP', keywords: ['php'] },
  { id: 'plaintext', label: 'Plain Text', keywords: ['txt', 'text', 'plain'] },
  { id: 'powershell', label: 'PowerShell', keywords: ['ps1'] },
  { id: 'protobuf', label: 'Protocol Buffers', keywords: ['proto'] },
  { id: 'python', label: 'Python', keywords: ['py'] },
  { id: 'r', label: 'R', keywords: ['r'] },
  { id: 'ruby', label: 'Ruby', keywords: ['rb'] },
  { id: 'rust', label: 'Rust', keywords: ['rs'] },
  { id: 'scss', label: 'SCSS', keywords: ['scss', 'sass'] },
  { id: 'shell', label: 'Shell Script', keywords: ['sh', 'bash', 'zsh'] },
  { id: 'sql', label: 'SQL', keywords: ['sql'] },
  { id: 'swift', label: 'Swift', keywords: ['swift'] },
  { id: 'typescript', label: 'TypeScript', keywords: ['ts', 'tsx', 'mts', 'cts', 'typescriptreact'] },
  { id: 'xml', label: 'XML', keywords: ['xml', 'svg'] },
  { id: 'yaml', label: 'YAML', keywords: ['yml', 'yaml'] },
].sort((a, b) => a.label.localeCompare(b.label, 'en'))

export function monacoLanguageLabel(languageId: string): string {
  return MONACO_LANGUAGE_LABELS[languageId] ?? languageId
}

export function fileNameFromPath(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const slash = trimmed.lastIndexOf('/')
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed
}

export function parentDirFromPath(path: string): string {
  const trimmed = path.replace(/\/+$/, '') || '/'
  if (trimmed === '/') return '/'
  const slash = trimmed.lastIndexOf('/')
  if (slash <= 0) return '/'
  return trimmed.slice(0, slash) || '/'
}
