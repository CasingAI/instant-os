/**
 * VS Code 资源管理器小尺寸文件图标（Seti 风格简化版）。
 * 字形与配色参考 seti-ui（MIT，Jesse Weed），未直接打包其字体资源。
 */

export type VscodeFileIconKind =
  | 'file'
  | 'folder'
  | 'folder-open'
  | 'typescript'
  | 'javascript'
  | 'json'
  | 'html'
  | 'css'
  | 'markdown'
  | 'yaml'
  | 'xml'
  | 'shell'
  | 'python'
  | 'go'
  | 'rust'
  | 'java'
  | 'csharp'
  | 'php'
  | 'ruby'
  | 'swift'
  | 'kotlin'
  | 'dart'
  | 'lua'
  | 'sql'
  | 'docker'
  | 'git'
  | 'lock'
  | 'image'
  | 'config'
  | 'text'

export type VscodeFileIconColor =
  | 'blue'
  | 'green'
  | 'yellow'
  | 'orange'
  | 'purple'
  | 'pink'
  | 'red'
  | 'grey'
  | 'cyan'

const SETI_COLORS: Record<VscodeFileIconColor, string> = {
  blue: '#519aba',
  green: '#8dc149',
  yellow: '#cbcb41',
  orange: '#e37933',
  purple: '#a074c4',
  pink: '#f55385',
  red: '#cc3e44',
  grey: '#6d8086',
  cyan: '#55b5c4',
}

const FILE_NAME_ICONS: Record<string, VscodeFileIconKind> = {
  'package.json': 'json',
  'package-lock.json': 'lock',
  'tsconfig.json': 'json',
  'jsconfig.json': 'json',
  '.gitignore': 'git',
  '.gitattributes': 'git',
  '.gitmodules': 'git',
  'dockerfile': 'docker',
  'makefile': 'shell',
  'gnumakefile': 'shell',
  'readme.md': 'markdown',
  'license': 'text',
  'license.md': 'markdown',
  'license.txt': 'text',
}

const EXTENSION_ICONS: Record<string, VscodeFileIconKind> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  jsonc: 'json',
  html: 'html',
  htm: 'html',
  xhtml: 'html',
  css: 'css',
  scss: 'css',
  less: 'css',
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  xml: 'xml',
  svg: 'image',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  ico: 'image',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  fish: 'shell',
  ps1: 'shell',
  py: 'python',
  pyw: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  cs: 'csharp',
  php: 'php',
  rb: 'ruby',
  swift: 'swift',
  kt: 'kotlin',
  kts: 'kotlin',
  dart: 'dart',
  lua: 'lua',
  sql: 'sql',
  dockerfile: 'docker',
  ini: 'config',
  conf: 'config',
  cfg: 'config',
  env: 'config',
  toml: 'config',
  properties: 'config',
  txt: 'text',
  log: 'text',
}

const KIND_COLORS: Record<VscodeFileIconKind, VscodeFileIconColor> = {
  file: 'grey',
  folder: 'blue',
  'folder-open': 'blue',
  typescript: 'blue',
  javascript: 'yellow',
  json: 'yellow',
  html: 'orange',
  css: 'pink',
  markdown: 'cyan',
  yaml: 'purple',
  xml: 'orange',
  shell: 'green',
  python: 'blue',
  go: 'cyan',
  rust: 'orange',
  java: 'pink',
  csharp: 'purple',
  php: 'pink',
  ruby: 'red',
  swift: 'orange',
  kotlin: 'orange',
  dart: 'blue',
  lua: 'blue',
  sql: 'pink',
  docker: 'blue',
  git: 'orange',
  lock: 'red',
  image: 'pink',
  config: 'purple',
  text: 'grey',
}

export type VscodeFileIconSpec = {
  kind: VscodeFileIconKind
  color: string
}

export function resolveVscodeFileIcon(fileName: string): VscodeFileIconSpec {
  const lower = fileName.toLowerCase()
  const byName = FILE_NAME_ICONS[lower]
  if (byName) {
    return { kind: byName, color: SETI_COLORS[KIND_COLORS[byName]] }
  }

  const dot = lower.lastIndexOf('.')
  if (dot > 0 && dot < lower.length - 1) {
    const ext = lower.slice(dot + 1)
    const byExt = EXTENSION_ICONS[ext]
    if (byExt) {
      return { kind: byExt, color: SETI_COLORS[KIND_COLORS[byExt]] }
    }
  }

  return { kind: 'file', color: SETI_COLORS.grey }
}

export function resolveVscodeFolderIcon(expanded: boolean): VscodeFileIconSpec {
  const kind = expanded ? 'folder-open' : 'folder'
  return { kind, color: SETI_COLORS[KIND_COLORS[kind]] }
}

type VscodeTreeTwistieProps = {
  expanded: boolean
}

export function VscodeTreeTwistie({ expanded }: VscodeTreeTwistieProps) {
  return (
    <svg
      class="vscode__tree-chevron-svg"
      viewBox="0 0 14 14"
      width="14"
      height="14"
      aria-hidden="true"
    >
      <path
        class="vscode__tree-chevron-shadow"
        d={expanded ? 'M3.5 5.5 L7 9.5 L10.5 5.5 Z' : 'M5.5 3.5 L9.5 7 L5.5 10.5 Z'}
      />
      <path
        class="vscode__tree-chevron-face"
        d={expanded ? 'M3 5 L7 9 L11 5 Z' : 'M5 3 L9 7 L5 11 Z'}
      />
    </svg>
  )
}

type VscodeFileIconProps = {
  fileName: string
  selected?: boolean
}

export function VscodeFileIcon({ fileName, selected = false }: VscodeFileIconProps) {
  const { kind, color } = resolveVscodeFileIcon(fileName)
  return (
    <span
      class={`vscode__tree-icon vscode__tree-icon--file${selected ? ' vscode__tree-icon--selected' : ''}`}
      style={{ '--vscode-file-icon-color': color }}
      aria-hidden="true"
    >
      <svg class="vscode__tree-icon-svg" viewBox="0 0 16 16" width="16" height="16">
        {renderFileGlyph(kind)}
      </svg>
    </span>
  )
}

type VscodeFolderIconProps = {
  expanded: boolean
  selected?: boolean
}

export function VscodeFolderIcon({ expanded, selected = false }: VscodeFolderIconProps) {
  const { kind, color } = resolveVscodeFolderIcon(expanded)
  return (
    <span
      class={`vscode__tree-icon vscode__tree-icon--folder${selected ? ' vscode__tree-icon--selected' : ''}`}
      style={{ '--vscode-file-icon-color': color }}
      aria-hidden="true"
    >
      <svg class="vscode__tree-icon-svg" viewBox="0 0 16 16" width="16" height="16">
        {renderFileGlyph(kind)}
      </svg>
    </span>
  )
}

function renderFileGlyph(kind: VscodeFileIconKind) {
  switch (kind) {
    case 'folder':
      return (
        <>
          <path
            fill="currentColor"
            d="M1.5 4.5c0-.55.45-1 1-1h3.2l1 1.2h6.3c.55 0 1 .45 1 1v6.8c0 .55-.45 1-1 1H2.5c-.55 0-1-.45-1-1V4.5z"
          />
        </>
      )
    case 'folder-open':
      return (
        <>
          <path
            fill="currentColor"
            d="M1.5 4.5c0-.55.45-1 1-1h3.2l1 1.2h6.3c.55 0 1 .45 1 1v1.2H2.2c-.55 0-1 .45-1 1v4.6c0 .55.45 1 1 1h10.3c.55 0 1-.45 1-1V4.5H1.5z"
          />
        </>
      )
    case 'typescript':
      return (
        <>
          <path fill="currentColor" d="M3 1.5h10c.83 0 1.5.67 1.5 1.5v10c0 .83-.67 1.5-1.5 1.5H3c-.83 0-1.5-.67-1.5-1.5V3c0-.83.67-1.5 1.5-1.5z" opacity="0.22" />
          <text x="8" y="11.5" textAnchor="middle" fontSize="7" fontWeight="700" fill="currentColor" fontFamily="system-ui, sans-serif">
            TS
          </text>
        </>
      )
    case 'javascript':
      return (
        <>
          <path fill="currentColor" d="M3 1.5h10c.83 0 1.5.67 1.5 1.5v10c0 .83-.67 1.5-1.5 1.5H3c-.83 0-1.5-.67-1.5-1.5V3c0-.83.67-1.5 1.5-1.5z" opacity="0.22" />
          <text x="8" y="11.5" textAnchor="middle" fontSize="7" fontWeight="700" fill="currentColor" fontFamily="system-ui, sans-serif">
            JS
          </text>
        </>
      )
    case 'json':
      return (
        <>
          <path fill="currentColor" d="M3 1.5h10c.83 0 1.5.67 1.5 1.5v10c0 .83-.67 1.5-1.5 1.5H3c-.83 0-1.5-.67-1.5-1.5V3c0-.83.67-1.5 1.5-1.5z" opacity="0.22" />
          <text
            x="8"
            y="11.5"
            textAnchor="middle"
            fontSize="8"
            fontWeight="700"
            fill="currentColor"
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          >
            {'{}'}
          </text>
        </>
      )
    case 'html':
      return (
        <>
          <path fill="currentColor" d="M3 1.5h10c.83 0 1.5.67 1.5 1.5v10c0 .83-.67 1.5-1.5 1.5H3c-.83 0-1.5-.67-1.5-1.5V3c0-.83.67-1.5 1.5-1.5z" opacity="0.22" />
          <text x="8" y="11.5" textAnchor="middle" fontSize="6.5" fontWeight="700" fill="currentColor" fontFamily="system-ui, sans-serif">
            HTML
          </text>
        </>
      )
    case 'css':
      return (
        <>
          <path fill="currentColor" d="M3 1.5h10c.83 0 1.5.67 1.5 1.5v10c0 .83-.67 1.5-1.5 1.5H3c-.83 0-1.5-.67-1.5-1.5V3c0-.83.67-1.5 1.5-1.5z" opacity="0.22" />
          <text x="8" y="11.5" textAnchor="middle" fontSize="7" fontWeight="700" fill="currentColor" fontFamily="system-ui, sans-serif">
            CSS
          </text>
        </>
      )
    case 'markdown':
      return (
        <>
          <path fill="currentColor" d="M3 1.5h10c.83 0 1.5.67 1.5 1.5v10c0 .83-.67 1.5-1.5 1.5H3c-.83 0-1.5-.67-1.5-1.5V3c0-.83.67-1.5 1.5-1.5z" opacity="0.22" />
          <text x="8" y="11.5" textAnchor="middle" fontSize="7" fontWeight="700" fill="currentColor" fontFamily="system-ui, sans-serif">
            M
          </text>
        </>
      )
    case 'yaml':
      return (
        <>
          <path fill="currentColor" d="M3 1.5h10c.83 0 1.5.67 1.5 1.5v10c0 .83-.67 1.5-1.5 1.5H3c-.83 0-1.5-.67-1.5-1.5V3c0-.83.67-1.5 1.5-1.5z" opacity="0.22" />
          <text x="8" y="11.5" textAnchor="middle" fontSize="6" fontWeight="700" fill="currentColor" fontFamily="system-ui, sans-serif">
            YML
          </text>
        </>
      )
    case 'xml':
      return (
        <>
          <path fill="currentColor" d="M3 1.5h10c.83 0 1.5.67 1.5 1.5v10c0 .83-.67 1.5-1.5 1.5H3c-.83 0-1.5-.67-1.5-1.5V3c0-.83.67-1.5 1.5-1.5z" opacity="0.22" />
          <path fill="currentColor" d="M5.2 11.2L8 7.8l2.8 3.4h-1.4L8 9.4l-1.4 1.8H5.2zM5.2 4.8h1.4L8 6.6l1.4-1.8h1.4L8 7.8 5.2 4.8z" />
        </>
      )
    case 'shell':
      return (
        <>
          <path fill="currentColor" d="M3 1.5h10c.83 0 1.5.67 1.5 1.5v10c0 .83-.67 1.5-1.5 1.5H3c-.83 0-1.5-.67-1.5-1.5V3c0-.83.67-1.5 1.5-1.5z" opacity="0.22" />
          <path fill="currentColor" d="M4.5 6.2l1.8 1.3-1.8 1.3V6.2zm2.8 3.5h4.2v1.1H7.3V9.7z" />
        </>
      )
    case 'python':
      return (
        <>
          <path fill="currentColor" d="M3 1.5h10c.83 0 1.5.67 1.5 1.5v10c0 .83-.67 1.5-1.5 1.5H3c-.83 0-1.5-.67-1.5-1.5V3c0-.83.67-1.5 1.5-1.5z" opacity="0.22" />
          <text x="8" y="11.5" textAnchor="middle" fontSize="7" fontWeight="700" fill="currentColor" fontFamily="system-ui, sans-serif">
            PY
          </text>
        </>
      )
    case 'go':
      return (
        <>
          <path fill="currentColor" d="M3 1.5h10c.83 0 1.5.67 1.5 1.5v10c0 .83-.67 1.5-1.5 1.5H3c-.83 0-1.5-.67-1.5-1.5V3c0-.83.67-1.5 1.5-1.5z" opacity="0.22" />
          <text x="8" y="11.5" textAnchor="middle" fontSize="7" fontWeight="700" fill="currentColor" fontFamily="system-ui, sans-serif">
            GO
          </text>
        </>
      )
    case 'rust':
      return (
        <>
          <path fill="currentColor" d="M3 1.5h10c.83 0 1.5.67 1.5 1.5v10c0 .83-.67 1.5-1.5 1.5H3c-.83 0-1.5-.67-1.5-1.5V3c0-.83.67-1.5 1.5-1.5z" opacity="0.22" />
          <text x="8" y="11.5" textAnchor="middle" fontSize="6.5" fontWeight="700" fill="currentColor" fontFamily="system-ui, sans-serif">
            RS
          </text>
        </>
      )
    case 'java':
      return (
        <>
          <path fill="currentColor" d="M3 1.5h10c.83 0 1.5.67 1.5 1.5v10c0 .83-.67 1.5-1.5 1.5H3c-.83 0-1.5-.67-1.5-1.5V3c0-.83.67-1.5 1.5-1.5z" opacity="0.22" />
          <text x="8" y="11.5" textAnchor="middle" fontSize="6" fontWeight="700" fill="currentColor" fontFamily="system-ui, sans-serif">
            JAVA
          </text>
        </>
      )
    case 'csharp':
      return (
        <>
          <path fill="currentColor" d="M3 1.5h10c.83 0 1.5.67 1.5 1.5v10c0 .83-.67 1.5-1.5 1.5H3c-.83 0-1.5-.67-1.5-1.5V3c0-.83.67-1.5 1.5-1.5z" opacity="0.22" />
          <text x="8" y="11.5" textAnchor="middle" fontSize="6" fontWeight="700" fill="currentColor" fontFamily="system-ui, sans-serif">
            C#
          </text>
        </>
      )
    case 'php':
      return (
        <>
          <path fill="currentColor" d="M3 1.5h10c.83 0 1.5.67 1.5 1.5v10c0 .83-.67 1.5-1.5 1.5H3c-.83 0-1.5-.67-1.5-1.5V3c0-.83.67-1.5 1.5-1.5z" opacity="0.22" />
          <text x="8" y="11.5" textAnchor="middle" fontSize="6.5" fontWeight="700" fill="currentColor" fontFamily="system-ui, sans-serif">
            PHP
          </text>
        </>
      )
    case 'ruby':
      return (
        <>
          <path fill="currentColor" d="M3 1.5h10c.83 0 1.5.67 1.5 1.5v10c0 .83-.67 1.5-1.5 1.5H3c-.83 0-1.5-.67-1.5-1.5V3c0-.83.67-1.5 1.5-1.5z" opacity="0.22" />
          <text x="8" y="11.5" textAnchor="middle" fontSize="6.5" fontWeight="700" fill="currentColor" fontFamily="system-ui, sans-serif">
            RB
          </text>
        </>
      )
    case 'swift':
      return (
        <>
          <path fill="currentColor" d="M3 1.5h10c.83 0 1.5.67 1.5 1.5v10c0 .83-.67 1.5-1.5 1.5H3c-.83 0-1.5-.67-1.5-1.5V3c0-.83.67-1.5 1.5-1.5z" opacity="0.22" />
          <text x="8" y="11.5" textAnchor="middle" fontSize="6" fontWeight="700" fill="currentColor" fontFamily="system-ui, sans-serif">
            SWIFT
          </text>
        </>
      )
    case 'kotlin':
      return (
        <>
          <path fill="currentColor" d="M3 1.5h10c.83 0 1.5.67 1.5 1.5v10c0 .83-.67 1.5-1.5 1.5H3c-.83 0-1.5-.67-1.5-1.5V3c0-.83.67-1.5 1.5-1.5z" opacity="0.22" />
          <text x="8" y="11.5" textAnchor="middle" fontSize="6" fontWeight="700" fill="currentColor" fontFamily="system-ui, sans-serif">
            KT
          </text>
        </>
      )
    case 'dart':
      return (
        <>
          <path fill="currentColor" d="M3 1.5h10c.83 0 1.5.67 1.5 1.5v10c0 .83-.67 1.5-1.5 1.5H3c-.83 0-1.5-.67-1.5-1.5V3c0-.83.67-1.5 1.5-1.5z" opacity="0.22" />
          <text x="8" y="11.5" textAnchor="middle" fontSize="6.5" fontWeight="700" fill="currentColor" fontFamily="system-ui, sans-serif">
            DART
          </text>
        </>
      )
    case 'lua':
      return (
        <>
          <path fill="currentColor" d="M3 1.5h10c.83 0 1.5.67 1.5 1.5v10c0 .83-.67 1.5-1.5 1.5H3c-.83 0-1.5-.67-1.5-1.5V3c0-.83.67-1.5 1.5-1.5z" opacity="0.22" />
          <text x="8" y="11.5" textAnchor="middle" fontSize="7" fontWeight="700" fill="currentColor" fontFamily="system-ui, sans-serif">
            LUA
          </text>
        </>
      )
    case 'sql':
      return (
        <>
          <path fill="currentColor" d="M3 1.5h10c.83 0 1.5.67 1.5 1.5v10c0 .83-.67 1.5-1.5 1.5H3c-.83 0-1.5-.67-1.5-1.5V3c0-.83.67-1.5 1.5-1.5z" opacity="0.22" />
          <text x="8" y="11.5" textAnchor="middle" fontSize="6.5" fontWeight="700" fill="currentColor" fontFamily="system-ui, sans-serif">
            SQL
          </text>
        </>
      )
    case 'docker':
      return (
        <>
          <path fill="currentColor" d="M3 1.5h10c.83 0 1.5.67 1.5 1.5v10c0 .83-.67 1.5-1.5 1.5H3c-.83 0-1.5-.67-1.5-1.5V3c0-.83.67-1.5 1.5-1.5z" opacity="0.22" />
          <path fill="currentColor" d="M4.5 8.2h1.2v1.2H4.5V8.2zm1.8 0h1.2v1.2H6.3V8.2zm1.8 0h1.2v1.2H8.1V8.2zm1.8 0h1.2v1.2H9.9V8.2zM6.3 6.4h1.2v1.2H6.3V6.4zm1.8 0h1.2v1.2H8.1V6.4z" />
        </>
      )
    case 'git':
      return (
        <>
          <path fill="currentColor" d="M3 1.5h10c.83 0 1.5.67 1.5 1.5v10c0 .83-.67 1.5-1.5 1.5H3c-.83 0-1.5-.67-1.5-1.5V3c0-.83.67-1.5 1.5-1.5z" opacity="0.22" />
          <path fill="currentColor" d="M8 4.8c-1.75 0-3.2 1.45-3.2 3.2 0 1.35.85 2.5 2.05 2.95l.35-1.05c-.55-.2-.95-.7-.95-1.3 0-.75.6-1.35 1.35-1.35.75 0 1.35.6 1.35 1.35 0 .6-.4 1.1-.95 1.3l.35 1.05c1.2-.45 2.05-1.6 2.05-2.95 0-1.75-1.45-3.2-3.2-3.2z" />
        </>
      )
    case 'lock':
      return (
        <>
          <path fill="currentColor" d="M3 1.5h10c.83 0 1.5.67 1.5 1.5v10c0 .83-.67 1.5-1.5 1.5H3c-.83 0-1.5-.67-1.5-1.5V3c0-.83.67-1.5 1.5-1.5z" opacity="0.22" />
          <path fill="currentColor" d="M8 5.2c-.9 0-1.6.7-1.6 1.6v.8H6v3.4h4V7.6h-.4v-.8c0-.9-.7-1.6-1.6-1.6zm0 .8c.45 0 .8.35.8.8v.8H7.2v-.8c0-.45.35-.8.8-.8z" />
        </>
      )
    case 'image':
      return (
        <>
          <path fill="currentColor" d="M3 1.5h10c.83 0 1.5.67 1.5 1.5v10c0 .83-.67 1.5-1.5 1.5H3c-.83 0-1.5-.67-1.5-1.5V3c0-.83.67-1.5 1.5-1.5z" opacity="0.22" />
          <circle cx="6" cy="6.2" r="1" fill="currentColor" />
          <path fill="currentColor" d="M4.5 12l2.2-2.4 1.6 1.6 1.7-2.2L11.5 12H4.5z" />
        </>
      )
    case 'config':
      return (
        <>
          <path fill="currentColor" d="M3 1.5h10c.83 0 1.5.67 1.5 1.5v10c0 .83-.67 1.5-1.5 1.5H3c-.83 0-1.5-.67-1.5-1.5V3c0-.83.67-1.5 1.5-1.5z" opacity="0.22" />
          <path fill="currentColor" d="M8 5.2l1.1 2.2 2.4.35-1.75 1.7.4 2.35L8 10.7l-2.15 1.1.4-2.35-1.75-1.7 2.4-.35L8 5.2z" />
        </>
      )
    case 'text':
      return (
        <>
          <path fill="currentColor" d="M3 1.5h10c.83 0 1.5.67 1.5 1.5v10c0 .83-.67 1.5-1.5 1.5H3c-.83 0-1.5-.67-1.5-1.5V3c0-.83.67-1.5 1.5-1.5z" opacity="0.22" />
          <path fill="currentColor" d="M5.5 5.5h5v1.2H9.2v5.3H6.8V6.7H5.5V5.5z" />
        </>
      )
    case 'file':
    default:
      return (
        <>
          <path fill="currentColor" d="M4.5 1.5h5.8l2.2 2.2v9.3c0 .55-.45 1-1 1H4.5c-.55 0-1-.45-1-1V2.5c0-.55.45-1 1-1z" opacity="0.22" />
          <path fill="currentColor" d="M10.3 1.5v2.2c0 .55.45 1 1 1h2.2L10.3 1.5z" opacity="0.35" />
          <path fill="currentColor" d="M5.5 7.5h5v1.1h-5V7.5zm0 2.2h3.5v1.1H5.5V9.7z" />
        </>
      )
  }
}
