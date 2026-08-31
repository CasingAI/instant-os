import type { ComponentChildren } from 'preact'
import { useEffect, useId, useState } from 'preact/hooks'
import {
  FILE_OPEN_PREFS_CHANGED_EVENT,
  fileNameExtension,
  getDefaultFileOpenApp,
} from '../../os/file-open-registry.ts'
import { isApplicationsBundleRootNode } from './files-location-applications.ts'
import { FilesAppBundleIcon } from './files-app-bundle-icon.tsx'
import { resolveArchiveUtilityFormat } from '../archive-utility/archive-utility-format.ts'
import { isDiskImageFileName } from './files-disk-image-name.ts'
import { MUSIC_AUDIO_EXTENSIONS, MUSIC_LYRICS_EXTENSIONS } from '../music/music-storage.ts'
import { VSCODE_OPEN_EXTENSIONS } from '../vscode/vscode-tabs.ts'
import type { FilesNode } from './files-types.ts'
import {
  isUserSpecialFolderNode,
  type UserSpecialFolderName,
} from './files-user-special.ts'
import { FILES_VFS_CHANGED_EVENT, readTextFile } from './files-vfs.ts'
import './files-node-icon.css'

export type FilesNodeIconSize = 'grid' | 'list'

/** 超过此大小不再读取正文做图标预览，避免拖慢目录列表 */
const TXT_PREVIEW_MAX_BYTES = 256 * 1024
/**
 * 结构点阵：行距压得很密，才能在纸面高度内塞进足够多的正文结构。
 * 与 SVG pitchY≈0.24 配套；过长行向右溢出后由四边等距 clip 裁掉（不换行）。
 */
const STRUCTURE_MAX_ROWS = 160
const STRUCTURE_MAX_DOTS = 56
const STRUCTURE_MAX_INDENT = 8

/** 纸面白区（与 TxtPaperGlyph 内页路径对齐） */
const PAPER_LEFT = 9.8
const PAPER_TOP = 5.3
const PAPER_RIGHT = 37.5
const PAPER_BOTTOM = 51
/** 上/右/下边距；左边略收，避免视觉上比上边更「空」 */
const PAPER_PAGE_MARGIN = 3.2
const PAPER_PAGE_MARGIN_LEFT = 1.0

export type StructureRow = {
  indent: number
  dots: number
}

export function isTxtFileName(fileName: string): boolean {
  return fileNameExtension(fileName) === 'txt'
}

export function isTxtFilesNode(node: Pick<FilesNode, 'kind' | 'name'>): boolean {
  return node.kind === 'file' && isTxtFileName(node.name)
}

const BROWSER_OPEN_EXTENSIONS = new Set(['html', 'htm', 'xhtml', 'svg'])
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp'])
const MODEL3D_EXTENSIONS = new Set(['gltf', 'glb'])
const DOCX_EXTENSIONS = new Set(['docx'])
const MUSIC_EXTENSIONS = new Set<string>(MUSIC_AUDIO_EXTENSIONS)
const LYRIC_EXTENSIONS = new Set<string>(MUSIC_LYRICS_EXTENSIONS)
const VSCODE_OPEN_EXTENSION_SET = new Set<string>(VSCODE_OPEN_EXTENSIONS)

/** 无常规后缀、但应显示 Code 卡片的特殊文件名 → 卡片标签与色调键 */
const CODE_SPECIAL_FILE_NAMES: Record<string, { label: string; toneKey: string }> = {
  dockerfile: { label: 'DOCK', toneKey: 'docker' },
  makefile: { label: 'MAKE', toneKey: 'sh' },
  gnumakefile: { label: 'MAKE', toneKey: 'sh' },
  '.gitignore': { label: 'Git', toneKey: 'git' },
  '.gitattributes': { label: 'Git', toneKey: 'git' },
  '.gitmodules': { label: 'Git', toneKey: 'git' },
  'package-lock.json': { label: 'LOCK', toneKey: 'json' },
  license: { label: 'TEXT', toneKey: 'txt' },
}

export function isBrowserOpenExtension(extension: string | undefined): boolean {
  return extension !== undefined && BROWSER_OPEN_EXTENSIONS.has(extension)
}

export function isImageFileExtension(extension: string | undefined): boolean {
  return extension !== undefined && IMAGE_EXTENSIONS.has(extension)
}

export function isModel3dFileExtension(extension: string | undefined): boolean {
  return extension !== undefined && MODEL3D_EXTENSIONS.has(extension)
}

export function isDocxFileExtension(extension: string | undefined): boolean {
  return extension !== undefined && DOCX_EXTENSIONS.has(extension)
}

export function isMusicFileExtension(extension: string | undefined): boolean {
  return extension !== undefined && MUSIC_EXTENSIONS.has(extension)
}

export function isLyricFileExtension(extension: string | undefined): boolean {
  return extension !== undefined && LYRIC_EXTENSIONS.has(extension)
}

export function browserFileBadgeLabel(extension: string): string {
  const ext = extension.trim().toLowerCase()
  if (ext === 'svg') return 'SVG'
  return 'HTML'
}

type CodeIconSpec = {
  extension: string
  label?: string
}

/** 按后缀或特殊文件名解析 Code 卡片；不含 txt/html 等可选关联 */
function resolveCodeFileIconSpec(fileName: string): CodeIconSpec | undefined {
  const lower = fileName.toLowerCase()
  const special = CODE_SPECIAL_FILE_NAMES[lower]
  if (special) {
    return { extension: special.toneKey, label: special.label }
  }
  const extension = fileNameExtension(fileName)
  if (extension !== undefined && VSCODE_OPEN_EXTENSION_SET.has(extension)) {
    return { extension }
  }
  return undefined
}

function pushStructureRow(rows: StructureRow[], indent: number, dots: number): boolean {
  if (rows.length >= STRUCTURE_MAX_ROWS) return false
  rows.push({ indent, dots })
  return true
}

/** 把正文压成「缩进 + 点密度」行，用于图标结构纹理 */
export function toStructureRows(text: string): StructureRow[] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\t/g, '  ').split('\n')
  const rows: StructureRow[] = []
  let started = false

  for (const line of lines) {
    if (rows.length >= STRUCTURE_MAX_ROWS) break
    const leading = line.match(/^ */)?.[0].length ?? 0
    const content = line.slice(leading).trimEnd()
    if (!started) {
      if (!content.trim()) continue
      started = true
    }

    const indent = Math.min(STRUCTURE_MAX_INDENT, Math.floor(leading / 2))
    const trimmed = content.trim()
    if (!trimmed) {
      pushStructureRow(rows, indent, 0)
      continue
    }

    // 一行对应一行点阵；过长则点继续往右画，由折角外侧的 clip 裁掉
    const dots = Math.min(STRUCTURE_MAX_DOTS, Math.max(2, Math.ceil(trimmed.length / 1.15)))
    if (!pushStructureRow(rows, indent, dots)) break
  }

  while (rows.length > 0 && rows[rows.length - 1]?.dots === 0) {
    rows.pop()
  }
  return rows
}

/** 写在纸页上的后缀字：短后缀直接大写，过长用常见缩写 */
export function codeFileExtLabel(extension: string): string {
  const ext = extension.trim().toLowerCase()
  const aliases: Record<string, string> = {
    markdown: 'MD',
    properties: 'PROP',
    graphql: 'GQL',
    typescript: 'TS',
    javascript: 'JS',
    xhtml: 'HTML',
  }
  const label = (aliases[ext] ?? ext).toUpperCase()
  if (label.length <= 4) return label
  return label.slice(0, 4)
}

type CodeExtTone = 'blue' | 'yellow' | 'green' | 'orange' | 'purple' | 'gray' | 'teal' | 'red'

/** Code 图标独立材质：顶条釉面 + 浮雕字色，不沿用文本编辑纸页配色 */
const CODE_EXT_MATERIAL: Record<
  CodeExtTone,
  {
    bandTop: string
    bandBot: string
    bandShine: string
    ink: string
    inkDeep: string
    wash: string
  }
> = {
  blue: {
    bandTop: '#6eb0e8',
    bandBot: '#2f6fad',
    bandShine: 'rgba(255,255,255,0.55)',
    ink: '#2a5f9a',
    inkDeep: '#1a3f6a',
    wash: 'rgba(47, 111, 173, 0.12)',
  },
  yellow: {
    bandTop: '#e8c84a',
    bandBot: '#b89018',
    bandShine: 'rgba(255,255,255,0.5)',
    ink: '#8a6a10',
    inkDeep: '#5c4708',
    wash: 'rgba(184, 144, 24, 0.14)',
  },
  green: {
    bandTop: '#7ed089',
    bandBot: '#3d8f4a',
    bandShine: 'rgba(255,255,255,0.5)',
    ink: '#2f6f38',
    inkDeep: '#1e4a24',
    wash: 'rgba(61, 143, 74, 0.12)',
  },
  orange: {
    bandTop: '#f0b060',
    bandBot: '#b86f28',
    bandShine: 'rgba(255,255,255,0.5)',
    ink: '#8a5018',
    inkDeep: '#5c3410',
    wash: 'rgba(184, 111, 40, 0.12)',
  },
  purple: {
    bandTop: '#b89aec',
    bandBot: '#6f4fb0',
    bandShine: 'rgba(255,255,255,0.5)',
    ink: '#553890',
    inkDeep: '#3a2468',
    wash: 'rgba(111, 79, 176, 0.12)',
  },
  gray: {
    bandTop: '#b0b8c4',
    bandBot: '#5f6875',
    bandShine: 'rgba(255,255,255,0.45)',
    ink: '#4a5360',
    inkDeep: '#2e3540',
    wash: 'rgba(95, 104, 117, 0.1)',
  },
  teal: {
    bandTop: '#6fd0d0',
    bandBot: '#2f8a8a',
    bandShine: 'rgba(255,255,255,0.5)',
    ink: '#226868',
    inkDeep: '#144848',
    wash: 'rgba(47, 138, 138, 0.12)',
  },
  red: {
    bandTop: '#f0a080',
    bandBot: '#b85030',
    bandShine: 'rgba(255,255,255,0.5)',
    ink: '#8a3818',
    inkDeep: '#5c2410',
    wash: 'rgba(184, 80, 48, 0.12)',
  },
}

function codeFileExtTone(extension: string): CodeExtTone {
  const ext = extension.trim().toLowerCase()
  switch (ext) {
    case 'js':
    case 'mjs':
    case 'cjs':
    case 'jsx':
      return 'yellow'
    case 'ts':
    case 'mts':
    case 'cts':
    case 'tsx':
      return 'blue'
    case 'py':
    case 'pyw':
      return 'green'
    case 'json':
    case 'jsonc':
    case 'yaml':
    case 'yml':
    case 'toml':
    case 'xml':
    case 'ini':
    case 'conf':
    case 'cfg':
    case 'env':
    case 'properties':
      return 'orange'
    case 'css':
    case 'scss':
    case 'less':
      return 'purple'
    case 'html':
    case 'htm':
    case 'xhtml':
    case 'vue':
    case 'svelte':
      return 'red'
    case 'md':
    case 'markdown':
    case 'mdx':
    case 'txt':
      return 'gray'
    case 'sh':
    case 'bash':
    case 'zsh':
    case 'ps1':
    case 'sql':
    case 'docker':
      return 'teal'
    case 'git':
      return 'orange'
    default:
      return 'blue'
  }
}

type FolderTint = {
  tab: string
  body: string
  lip: string
  shade: string
}

const DEFAULT_FOLDER_TINT: FolderTint = {
  tab: '#c9a046',
  body: '#e8c56a',
  lip: '#f3dfa0',
  shade: '#a67c42',
}

const SPECIAL_FOLDER_TINTS: Record<UserSpecialFolderName, FolderTint> = {
  Downloads: {
    tab: '#4a8fd4',
    body: '#6eb0ef',
    lip: '#a8d4ff',
    shade: '#2f6eab',
  },
  Musics: {
    tab: '#9a5bb8',
    body: '#c07ad9',
    lip: '#e2b6f2',
    shade: '#6e3a88',
  },
  Pictures: {
    tab: '#3f9a72',
    body: '#5fc496',
    lip: '#a8e8c8',
    shade: '#2a6e50',
  },
}

function FolderGlyph({
  className,
  tint = DEFAULT_FOLDER_TINT,
  badge,
}: {
  className: string
  tint?: FolderTint
  badge?: ComponentChildren
}) {
  return (
    <svg class={className} viewBox="0 0 64 52" aria-hidden="true">
      <ellipse cx="32" cy="48.5" rx="20" ry="2.8" fill="rgba(40, 25, 8, 0.22)" />
      <path
        fill={tint.tab}
        d="M7 13.5c0-2.4 1.9-4.3 4.3-4.3h13.2c.9 0 1.7.4 2.3 1.1l1.8 2.1c.3.4.8.6 1.3.6H53c2.2 0 4 1.8 4 4v3.1H7v-6.6z"
      />
      <path
        fill={tint.body}
        d="M5 19.2c0-2.5 2-4.5 4.5-4.5h45c2.5 0 4.5 2 4.5 4.5V42c0 2.8-2.2 5-5 5H10c-2.8 0-5-2.2-5-5V19.2z"
      />
      <path
        fill={tint.lip}
        d="M9.5 14.7h45c1.5 0 2.9.8 3.7 2H5.8c.8-1.2 2.2-2 3.7-2z"
      />
      <path
        fill="#fff"
        opacity="0.35"
        d="M10 16.2h44c.9 0 1.7.4 2.2 1.1H7.8c.5-.7 1.3-1.1 2.2-1.1z"
      />
      <path
        fill={tint.shade}
        opacity="0.28"
        d="M5 34h54v8c0 2.8-2.2 5-5 5H10c-2.8 0-5-2.2-5-5v-8z"
      />
      {badge}
    </svg>
  )
}

const USER_SPECIAL_FOLDER_BADGE_RADIUS = 12.2

function UserSpecialFolderBadge({
  ringStroke,
  children,
}: {
  ringStroke: string
  children: ComponentChildren
}) {
  const r = USER_SPECIAL_FOLDER_BADGE_RADIUS
  return (
    <g transform="translate(32 31)">
      <circle cx="0" cy="0" r={r} fill="rgba(255,255,255,0.92)" />
      <circle cx="0" cy="0" r={r} fill="none" stroke={ringStroke} stroke-width="1.1" />
      <g transform="scale(1.32)">{children}</g>
    </g>
  )
}

function DownloadsFolderBadge() {
  return (
    <UserSpecialFolderBadge ringStroke="rgba(30,70,120,0.28)">
      <path fill="#1f6fc2" d="M-1.4-5.2h2.8v5.4h3.4L0 6.2l-4.8-6h3.4z" />
      <rect x="-5.2" y="6.6" width="10.4" height="1.8" rx="0.7" fill="#1f6fc2" />
    </UserSpecialFolderBadge>
  )
}

function MusicsFolderBadge() {
  return (
    <UserSpecialFolderBadge ringStroke="rgba(80,40,110,0.28)">
      <path
        fill="#7a3fa0"
        d="M2.2-6.2v8.4c-.4-.3-.9-.5-1.5-.5-1.5 0-2.7 1-2.7 2.2S-.8 6.1.7 6.1c1.4 0 2.6-.9 2.7-2.1V-3.4l4.2-1v6.6c-.4-.3-.9-.4-1.4-.4-1.5 0-2.7 1-2.7 2.2s1.2 2.2 2.7 2.2 2.7-1 2.7-2.2V-6.8l-5.5 1.6z"
      />
    </UserSpecialFolderBadge>
  )
}

function PicturesFolderBadge() {
  return (
    <UserSpecialFolderBadge ringStroke="rgba(30,90,60,0.28)">
      <rect x="-6.2" y="-4.6" width="12.4" height="9.6" rx="1.4" fill="#d9f0e4" />
      <rect
        x="-6.2"
        y="-4.6"
        width="12.4"
        height="9.6"
        rx="1.4"
        fill="none"
        stroke="#2f7a56"
        stroke-width="0.9"
      />
      <circle cx="2.4" cy="-1.8" r="1.35" fill="#f0c060" />
      <path fill="#3f9a72" d="M-5.4 4.2h10.8L2.2-.2l-2.4 2.4-1.9-1.6z" />
      <path fill="#2a6e50" opacity="0.9" d="M-5.4 4.2h5.8L-1.6.8l-2 1.5z" />
    </UserSpecialFolderBadge>
  )
}

function SpecialUserFolderGlyph({
  name,
  className,
}: {
  name: UserSpecialFolderName
  className: string
}) {
  const tint = SPECIAL_FOLDER_TINTS[name]
  const badge =
    name === 'Downloads' ? (
      <DownloadsFolderBadge />
    ) : name === 'Musics' ? (
      <MusicsFolderBadge />
    ) : (
      <PicturesFolderBadge />
    )
  return <FolderGlyph className={className} tint={tint} badge={badge} />
}

/** 未知 / 无关联类型的通用文件图标（空白页，无正文暗示） */
function UnknownFileGlyph({ className }: { className: string }) {
  return (
    <svg
      class={className}
      viewBox="4 2 38 58"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <ellipse cx="24" cy="56.5" rx="14" ry="2.2" fill="rgba(40, 25, 8, 0.18)" />
      <path
        fill="#e8e4dc"
        stroke="#9a9284"
        stroke-width="1.2"
        d="M9 4h18l13 13v35c0 2.2-1.8 4-4 4H9c-2.2 0-4-1.8-4-4V8c0-2.2 1.8-4 4-4z"
      />
      <path
        fill="#f3f0ea"
        d="M9.8 5.3H26l11.5 11.5V51c0 1.3-1.1 2.4-2.4 2.4H9.8c-1.3 0-2.4-1.1-2.4-2.4V7.7c0-1.3 1.1-2.4 2.4-2.4z"
      />
      <path
        fill="#d4cfc4"
        stroke="#9a9284"
        stroke-width="1"
        d="M27 4.2v11.2c0 1.1.9 2 2 2H40L27 4.2z"
      />
    </svg>
  )
}

/** 图片文件：折角页上叠简化山景示意（不读文件内容） */
function ImageFileGlyph({ className }: { className: string }) {
  return (
    <svg
      class={className}
      viewBox="4 2 38 58"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <ellipse cx="24" cy="56.5" rx="14" ry="2.2" fill="rgba(40, 25, 8, 0.18)" />
      <path
        fill="#f0f4f8"
        stroke="#7a8a9a"
        stroke-width="1.2"
        d="M9 4h18l13 13v35c0 2.2-1.8 4-4 4H9c-2.2 0-4-1.8-4-4V8c0-2.2 1.8-4 4-4z"
      />
      <path
        fill="#e8eef4"
        d="M9.8 5.3H26l11.5 11.5V51c0 1.3-1.1 2.4-2.4 2.4H9.8c-1.3 0-2.4-1.1-2.4-2.4V7.7c0-1.3 1.1-2.4 2.4-2.4z"
      />
      <path
        fill="#c8d4e0"
        stroke="#7a8a9a"
        stroke-width="1"
        d="M27 4.2v11.2c0 1.1.9 2 2 2H40L27 4.2z"
      />
      {/* 预览窗 */}
      <rect x="11" y="24" width="22" height="18" rx="2" fill="#dce6f0" />
      <rect
        x="11"
        y="24"
        width="22"
        height="18"
        rx="2"
        fill="none"
        stroke="#6a7a8a"
        stroke-width="0.9"
      />
      <circle cx="27.5" cy="29.2" r="2.2" fill="#f0c060" />
      <path fill="#6a9a6a" d="M12.2 40.5h19.6L26 33.2l-4.2 4.5-3.2-2.8z" />
      <path fill="#4a7a4a" opacity="0.85" d="M12.2 40.5h10.5l-3.8-5.2-3.5 2.6z" />
    </svg>
  )
}

/** 空白折角页 + 正中标记（问号 / emoji 等） */
function BlankFileMarkIcon({
  size,
  mark,
}: {
  size: FilesNodeIconSize
  mark: string
}) {
  return (
    <span
      class={`files-node-icon files-node-icon--${size} files-node-icon--blank-mark`}
      aria-hidden="true"
    >
      <UnknownFileGlyph className="files-node-icon__glyph files-node-icon__glyph--file" />
      <span class="files-node-icon__mark">{mark}</span>
    </span>
  )
}

function TxtPaperGlyph({ className }: { className: string }) {
  return (
    <svg
      class={className}
      viewBox="4 2 38 58"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <ellipse cx="24" cy="56.5" rx="14" ry="2.2" fill="rgba(40, 25, 8, 0.18)" />
      <path
        fill="#fffdf8"
        stroke="#b9a888"
        stroke-width="1.2"
        d="M9 4h18l13 13v35c0 2.2-1.8 4-4 4H9c-2.2 0-4-1.8-4-4V8c0-2.2 1.8-4 4-4z"
      />
      <path
        fill="#fff"
        d="M9.8 5.3H26l11.5 11.5V51c0 1.3-1.1 2.4-2.4 2.4H9.8c-1.3 0-2.4-1.1-2.4-2.4V7.7c0-1.3 1.1-2.4 2.4-2.4z"
      />
      <path
        fill="#e6dcc8"
        stroke="#b9a888"
        stroke-width="1"
        d="M27 4.2v11.2c0 1.1.9 2 2 2H40L27 4.2z"
      />
    </svg>
  )
}

/** 折角盖在点阵之上，遮住纸面右上角（Mac 缩略图同款层次） */
function TxtFoldCover() {
  return (
    <svg
      class="files-node-icon__fold"
      viewBox="4 2 38 58"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <path
        fill="#e6dcc8"
        stroke="#b9a888"
        stroke-width="1"
        d="M27 4.2v11.2c0 1.1.9 2 2 2H40L27 4.2z"
      />
    </svg>
  )
}

/**
 * 与纸面同坐标系的 SVG 点阵：点极小且紧贴。
 * 上/右/下等距边距，左边略收；右上沿折痕裁切；过长行向右溢出后被裁掉。
 */
function StructureDots({ rows }: { rows: readonly StructureRow[] }) {
  const rawId = useId()
  const clipId = `files-struct-clip-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`
  const contentLeft = PAPER_LEFT + PAPER_PAGE_MARGIN_LEFT
  const contentTop = PAPER_TOP + PAPER_PAGE_MARGIN
  const contentRight = PAPER_RIGHT - PAPER_PAGE_MARGIN
  const contentBottom = PAPER_BOTTOM - PAPER_PAGE_MARGIN
  const pitchX = 0.42
  const pitchY = 0.24
  const r = 0.2
  const indentStep = 0.72

  return (
    <svg
      class="files-node-icon__structure"
      viewBox="4 2 38 58"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <defs>
        <clipPath id={clipId}>
          {/* 四边内缩同一边距；右上沿折痕裁掉折角三角 */}
          <path
            d={`M${contentLeft} ${contentTop}H27v${15.4 - contentTop}c0 1.1.9 2 2 2H${contentRight}V${contentBottom}H${contentLeft}z`}
          />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`} fill="#3f3a32" opacity="0.5">
        {rows.flatMap((row, rowIndex) =>
          Array.from({ length: row.dots }, (_, dotIndex) => (
            <circle
              key={`${rowIndex}-${dotIndex}`}
              cx={contentLeft + row.indent * indentStep + dotIndex * pitchX}
              cy={contentTop + rowIndex * pitchY}
              r={r}
            />
          )),
        )}
      </g>
      <path
        fill="#e6dcc8"
        stroke="#b9a888"
        stroke-width="1"
        d="M27 4.2v11.2c0 1.1.9 2 2 2H40L27 4.2z"
      />
    </svg>
  )
}

/**
 * Code 文件图标（独立造型，不沿用文本编辑折角纸页）：
 * 厚卡片本体 + 釉面顶条 + 面板区正中浮雕后缀。
 */
function CodeFileGlyph({
  className,
  label,
  tone,
}: {
  className: string
  label: string
  tone: CodeExtTone
}) {
  const rawId = useId()
  const uid = rawId.replace(/[^a-zA-Z0-9_-]/g, '')
  const mat = CODE_EXT_MATERIAL[tone]
  const len = label.length
  const fontSize = len <= 1 ? 20 : len === 2 ? 17 : len === 3 ? 13.5 : 11
  // 面板几何中心（顶条以下）：x 28，y 41
  const cx = 28
  const cy = 41

  const faceGrad = `code-face-${uid}`
  const bandGrad = `code-band-${uid}`
  const edgeGrad = `code-edge-${uid}`
  const glossGrad = `code-gloss-${uid}`

  return (
    <svg class={className} viewBox="0 0 56 68" aria-hidden="true">
      <defs>
        <linearGradient id={faceGrad} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#ffffff" />
          <stop offset="42%" stop-color="#f3f6fa" />
          <stop offset="100%" stop-color="#dde3ec" />
        </linearGradient>
        <linearGradient id={bandGrad} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color={mat.bandTop} />
          <stop offset="100%" stop-color={mat.bandBot} />
        </linearGradient>
        <linearGradient id={edgeGrad} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#9aa3b0" />
          <stop offset="100%" stop-color="#6a7380" />
        </linearGradient>
        <linearGradient id={glossGrad} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="rgba(255,255,255,0.7)" />
          <stop offset="100%" stop-color="rgba(255,255,255,0)" />
        </linearGradient>
      </defs>

      {/* 落地阴影 */}
      <ellipse cx="28" cy="62.5" rx="16" ry="2.6" fill="rgba(18, 28, 42, 0.28)" />

      {/* 厚度侧沿（右下挤出） */}
      <path
        fill={`url(#${edgeGrad})`}
        d="M14 8h28a6 6 0 0 1 6 6v40a6 6 0 0 1-6 6H14a6 6 0 0 1-6-6V14a6 6 0 0 1 6-6z"
        transform="translate(2.2 2.8)"
        opacity="0.9"
      />

      {/* 正面卡片 */}
      <path
        fill={`url(#${faceGrad})`}
        stroke="#8a93a0"
        stroke-width="0.9"
        d="M12 6h28a6 6 0 0 1 6 6v40a6 6 0 0 1-6 6H12a6 6 0 0 1-6-6V12a6 6 0 0 1 6-6z"
      />

      {/* 左侧厚度高光缝 */}
      <path
        fill="none"
        stroke="rgba(255,255,255,0.55)"
        stroke-width="1.1"
        stroke-linecap="round"
        d="M12.2 12.5v35.5"
      />

      {/* 釉面顶条 */}
      <path
        fill={`url(#${bandGrad})`}
        d="M12 6h28a6 6 0 0 1 6 6v8.5H6V12a6 6 0 0 1 6-6z"
      />
      <path fill={`url(#${glossGrad})`} d="M12 6h28a6 6 0 0 1 5.2 3.2H6.8A6 6 0 0 1 12 6z" />
      <path
        fill="none"
        stroke={mat.bandShine}
        stroke-width="1.2"
        stroke-linecap="round"
        opacity="0.85"
        d="M10.5 9.2h31"
      />
      {/* 顶条底沿阴影，压出厚度 */}
      <path fill="rgba(20,30,45,0.22)" d="M6 20.5h40v1.2H6z" />

      {/* 面板内凹感 */}
      <rect x="10" y="24" width="32" height="26" rx="3.5" fill={mat.wash} />
      <rect
        x="10.4"
        y="24.4"
        width="31.2"
        height="25.2"
        rx="3.2"
        fill="none"
        stroke="rgba(255,255,255,0.65)"
        stroke-width="0.7"
      />
      <rect
        x="10.4"
        y="24.4"
        width="31.2"
        height="25.2"
        rx="3.2"
        fill="none"
        stroke="rgba(40,50,65,0.12)"
        stroke-width="0.7"
        transform="translate(0.4 0.5)"
      />

      {/* 面板高光 */}
      <path
        fill={`url(#${glossGrad})`}
        opacity="0.45"
        d="M10 24h32a3.5 3.5 0 0 1 0 1.2L10 28.5V24z"
      />

      {/* 浮雕后缀：阴影 → 高光 → 本体，几何居中于面板凹槽 */}
      <text
        x={cx}
        y={cy + 0.9}
        text-anchor="middle"
        dominant-baseline="central"
        font-family="ui-rounded, system-ui, -apple-system, 'Segoe UI', sans-serif"
        font-size={fontSize}
        font-weight="800"
        fill={mat.inkDeep}
        opacity="0.55"
      >
        {label}
      </text>
      <text
        x={cx - 0.45}
        y={cy - 0.55}
        text-anchor="middle"
        dominant-baseline="central"
        font-family="ui-rounded, system-ui, -apple-system, 'Segoe UI', sans-serif"
        font-size={fontSize}
        font-weight="800"
        fill="rgba(255,255,255,0.85)"
      >
        {label}
      </text>
      <text
        x={cx}
        y={cy}
        text-anchor="middle"
        dominant-baseline="central"
        font-family="ui-rounded, system-ui, -apple-system, 'Segoe UI', sans-serif"
        font-size={fontSize}
        font-weight="800"
        fill={mat.ink}
      >
        {label}
      </text>

      {/* 底边内高光，收口 */}
      <path
        fill="none"
        stroke="rgba(255,255,255,0.4)"
        stroke-width="1"
        stroke-linecap="round"
        d="M12 55.5h28"
      />
    </svg>
  )
}

type StructurePreviewIconProps = {
  nodeId: string
  byteSize: number
  size: FilesNodeIconSize
  badge: string
  badgeTone: 'txt' | 'html' | 'svg'
  /** 不读盘，仅展示空文本样式（如「新建」菜单） */
  staticPreview?: string
}

function StructurePreviewFileIcon({
  nodeId,
  byteSize,
  size,
  badge,
  badgeTone,
  staticPreview,
}: StructurePreviewIconProps) {
  const [rows, setRows] = useState<StructureRow[] | undefined>(
    staticPreview !== undefined ? toStructureRows(staticPreview) : undefined,
  )
  const skipRead = staticPreview !== undefined || byteSize > TXT_PREVIEW_MAX_BYTES

  useEffect(() => {
    if (skipRead) {
      if (staticPreview !== undefined) setRows(toStructureRows(staticPreview))
      return
    }

    let cancelled = false

    const load = () => {
      void readTextFile(nodeId)
        .then(({ text }) => {
          if (!cancelled) setRows(toStructureRows(text))
        })
        .catch(() => {
          if (!cancelled) setRows(undefined)
        })
    }

    load()

    const onVfsChanged = () => load()
    window.addEventListener(FILES_VFS_CHANGED_EVENT, onVfsChanged)
    return () => {
      cancelled = true
      window.removeEventListener(FILES_VFS_CHANGED_EVENT, onVfsChanged)
    }
  }, [nodeId, byteSize, skipRead, staticPreview])

  const showStructure = rows !== undefined && rows.length > 0
  const rootClass =
    `files-node-icon files-node-icon--${size} files-node-icon--preview` +
    (showStructure ? ' files-node-icon--preview-ready' : '')

  return (
    <span class={rootClass} aria-hidden="true">
      <TxtPaperGlyph className="files-node-icon__glyph files-node-icon__glyph--file" />
      {showStructure ? (
        <StructureDots rows={rows} />
      ) : (
        <span class="files-node-icon__lines" />
      )}
      {showStructure ? undefined : <TxtFoldCover />}
      <span class={`files-node-icon__badge files-node-icon__badge--${badgeTone}`}>{badge}</span>
    </span>
  )
}

function TxtFileIcon({
  nodeId,
  byteSize,
  size,
  staticPreview,
}: {
  nodeId: string
  byteSize: number
  size: FilesNodeIconSize
  staticPreview?: string
}) {
  return (
    <StructurePreviewFileIcon
      nodeId={nodeId}
      byteSize={byteSize}
      size={size}
      badge="TXT"
      badgeTone="txt"
      staticPreview={staticPreview}
    />
  )
}

function BrowserFileIcon({
  nodeId,
  byteSize,
  size,
  extension,
}: {
  nodeId: string
  byteSize: number
  size: FilesNodeIconSize
  extension: string
}) {
  const badge = browserFileBadgeLabel(extension)
  return (
    <StructurePreviewFileIcon
      nodeId={nodeId}
      byteSize={byteSize}
      size={size}
      badge={badge}
      badgeTone={badge === 'SVG' ? 'svg' : 'html'}
    />
  )
}

type CodeFileIconProps = {
  extension: string
  size: FilesNodeIconSize
  label?: string
}

/** Code 可打开类型的文件图标：厚卡片拟物 + 正中浮雕后缀 */
function CodeFileIcon({ extension, size, label }: CodeFileIconProps) {
  const resolvedLabel = label ?? codeFileExtLabel(extension)
  const tone = codeFileExtTone(extension)

  return (
    <span
      class={`files-node-icon files-node-icon--${size} files-node-icon--code`}
      aria-hidden="true"
    >
      <CodeFileGlyph
        className="files-node-icon__glyph files-node-icon__glyph--file files-node-icon__glyph--code"
        label={resolvedLabel}
        tone={tone}
      />
    </span>
  )
}

function ImageFileIcon({ size }: { size: FilesNodeIconSize }) {
  return (
    <span
      class={`files-node-icon files-node-icon--${size} files-node-icon--image`}
      aria-hidden="true"
    >
      <ImageFileGlyph className="files-node-icon__glyph files-node-icon__glyph--file" />
    </span>
  )
}

/** 3D 模型：折角页上叠立方体示意 */
function Model3dFileGlyph({ className }: { className: string }) {
  return (
    <svg
      class={className}
      viewBox="4 2 38 58"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <ellipse cx="24" cy="56.5" rx="14" ry="2.2" fill="rgba(40, 25, 8, 0.18)" />
      <path
        fill="#f4ebe0"
        stroke="#8a6a38"
        stroke-width="1.2"
        d="M9 4h18l13 13v35c0 2.2-1.8 4-4 4H9c-2.2 0-4-1.8-4-4V8c0-2.2 1.8-4 4-4z"
      />
      <path
        fill="#efe4d4"
        d="M9.8 5.3H26l11.5 11.5V51c0 1.3-1.1 2.4-2.4 2.4H9.8c-1.3 0-2.4-1.1-2.4-2.4V7.7c0-1.3 1.1-2.4 2.4-2.4z"
      />
      <path
        fill="#e0d0b8"
        stroke="#8a6a38"
        stroke-width="1"
        d="M27 4.2v11.2c0 1.1.9 2 2 2H40L27 4.2z"
      />
      <path
        fill="#f0d9a8"
        stroke="#8a6a38"
        stroke-width="1"
        d="M22 22.5 L31 27 L31 37.5 L22 42 L13 37.5 L13 27 Z"
      />
      <path fill="#c9a66a" opacity="0.7" d="M22 22.5 L31 27 L22 31.5 L13 27 Z" />
      <path
        stroke="#5a4328"
        stroke-width="1"
        fill="none"
        d="M22 31.5 V42 M13 27 L22 31.5 L31 27"
      />
    </svg>
  )
}

function Model3dFileIcon({ size }: { size: FilesNodeIconSize }) {
  return (
    <span
      class={`files-node-icon files-node-icon--${size} files-node-icon--model3d`}
      aria-hidden="true"
    >
      <Model3dFileGlyph className="files-node-icon__glyph files-node-icon__glyph--file" />
    </span>
  )
}

/** 音乐文件：折角页上叠双八分音符 + 谱线（不读文件内容） */
function MusicFileGlyph({ className }: { className: string }) {
  return (
    <svg
      class={className}
      viewBox="4 2 38 58"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <ellipse cx="24" cy="56.5" rx="14" ry="2.2" fill="rgba(40, 25, 8, 0.18)" />
      <path
        fill="#faf5fd"
        stroke="#b08cc0"
        stroke-width="1.2"
        d="M9 4h18l13 13v35c0 2.2-1.8 4-4 4H9c-2.2 0-4-1.8-4-4V8c0-2.2 1.8-4 4-4z"
      />
      <path
        fill="#f6eef9"
        d="M9.8 5.3H26l11.5 11.5V51c0 1.3-1.1 2.4-2.4 2.4H9.8c-1.3 0-2.4-1.1-2.4-2.4V7.7c0-1.3 1.1-2.4 2.4-2.4z"
      />
      <path
        fill="#e6d3ee"
        stroke="#b08cc0"
        stroke-width="1"
        d="M27 4.2v11.2c0 1.1.9 2 2 2H40L27 4.2z"
      />
      {/* 双八分音符：两枚斜置符头 + 符干 + 顶部连梁 */}
      <g fill="#7a3fa0">
        <ellipse cx="18" cy="39.5" rx="3" ry="2.3" transform="rotate(-18 18 39.5)" />
        <ellipse cx="30" cy="37.8" rx="3" ry="2.3" transform="rotate(-18 30 37.8)" />
      </g>
      <path
        fill="none"
        stroke="#7a3fa0"
        stroke-width="1.5"
        stroke-linecap="round"
        d="M20.2 38.3V25"
      />
      <path
        fill="none"
        stroke="#7a3fa0"
        stroke-width="1.5"
        stroke-linecap="round"
        d="M32.2 36.6V23.3"
      />
      <path fill="#7a3fa0" d="M20.2 25.4L32.2 23.7v-1.8L20.2 23.6z" />
      {/* 谱线 */}
      <g stroke="#b07ac8" stroke-width="1" opacity="0.75">
        <line x1="13.5" y1="45.5" x2="34.5" y2="45.5" />
        <line x1="13.5" y1="49" x2="34.5" y2="49" />
      </g>
    </svg>
  )
}

function MusicFileIcon({ size }: { size: FilesNodeIconSize }) {
  return (
    <span
      class={`files-node-icon files-node-icon--${size} files-node-icon--music`}
      aria-hidden="true"
    >
      <MusicFileGlyph className="files-node-icon__glyph files-node-icon__glyph--file" />
    </span>
  )
}

/** 歌词文件：折角页上叠小音符 + 时间戳歌词行（不读文件内容） */
function LyricFileGlyph({ className }: { className: string }) {
  return (
    <svg
      class={className}
      viewBox="4 2 38 58"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <ellipse cx="24" cy="56.5" rx="14" ry="2.2" fill="rgba(40, 25, 8, 0.18)" />
      <path
        fill="#fffaf0"
        stroke="#c9b48a"
        stroke-width="1.2"
        d="M9 4h18l13 13v35c0 2.2-1.8 4-4 4H9c-2.2 0-4-1.8-4-4V8c0-2.2 1.8-4 4-4z"
      />
      <path
        fill="#fffdf6"
        d="M9.8 5.3H26l11.5 11.5V51c0 1.3-1.1 2.4-2.4 2.4H9.8c-1.3 0-2.4-1.1-2.4-2.4V7.7c0-1.3 1.1-2.4 2.4-2.4z"
      />
      <path
        fill="#ecdfc2"
        stroke="#c9b48a"
        stroke-width="1"
        d="M27 4.2v11.2c0 1.1.9 2 2 2H40L27 4.2z"
      />
      {/* 顶部小音符（双八分） */}
      <g fill="#d9537f">
        <ellipse cx="19.5" cy="26.5" rx="2.2" ry="1.7" transform="rotate(-18 19.5 26.5)" />
        <ellipse cx="28.5" cy="25.5" rx="2.2" ry="1.7" transform="rotate(-18 28.5 25.5)" />
      </g>
      <path
        fill="none"
        stroke="#d9537f"
        stroke-width="1.2"
        stroke-linecap="round"
        d="M21.3 25.5V19.5"
      />
      <path
        fill="none"
        stroke="#d9537f"
        stroke-width="1.2"
        stroke-linecap="round"
        d="M30.3 24.5V18.5"
      />
      <path fill="#d9537f" d="M21.3 19.8L30.3 18.8v-1.2L21.3 18.6z" />
      {/* 歌词行：时间戳胶囊 + 正文条 */}
      <g fill="#d9537f">
        <rect x="12" y="32.3" width="7" height="4" rx="1.3" />
        <rect x="12" y="38.3" width="7" height="4" rx="1.3" />
        <rect x="12" y="44.3" width="7" height="4" rx="1.3" />
      </g>
      <g fill="#c9b48a">
        <rect x="21" y="33.5" width="14" height="1.6" rx="0.8" />
        <rect x="21" y="39.5" width="12" height="1.6" rx="0.8" />
        <rect x="21" y="45.5" width="9.5" height="1.6" rx="0.8" />
      </g>
    </svg>
  )
}

function LyricFileIcon({ size }: { size: FilesNodeIconSize }) {
  return (
    <span
      class={`files-node-icon files-node-icon--${size} files-node-icon--lyric`}
      aria-hidden="true"
    >
      <LyricFileGlyph className="files-node-icon__glyph files-node-icon__glyph--file" />
    </span>
  )
}

/** Word 文档：折角纸页 + 釉面 W 徽章 + 右侧正文条（参考微软识别性，拟物加厚） */
function DocxFileGlyph({ className }: { className: string }) {
  const rawId = useId()
  const uid = rawId.replace(/[^a-zA-Z0-9_-]/g, '')
  const paperGrad = `docx-paper-${uid}`
  const foldGrad = `docx-fold-${uid}`
  const badgeGrad = `docx-badge-${uid}`
  const badgeGloss = `docx-badge-gloss-${uid}`
  const lineGrad = `docx-line-${uid}`

  return (
    <svg
      class={className}
      viewBox="4 2 38 58"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={paperGrad} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#ffffff" />
          <stop offset="55%" stop-color="#faf7f2" />
          <stop offset="100%" stop-color="#ebe4d8" />
        </linearGradient>
        <linearGradient id={foldGrad} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#f5efe6" />
          <stop offset="100%" stop-color="#cfc4b0" />
        </linearGradient>
        <linearGradient id={badgeGrad} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#4d8fd4" />
          <stop offset="45%" stop-color="#2b579a" />
          <stop offset="100%" stop-color="#1a3d72" />
        </linearGradient>
        <linearGradient id={badgeGloss} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="rgba(255,255,255,0.65)" />
          <stop offset="100%" stop-color="rgba(255,255,255,0)" />
        </linearGradient>
        <linearGradient id={lineGrad} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#c8c0b4" />
          <stop offset="100%" stop-color="#a89a88" />
        </linearGradient>
      </defs>

      <ellipse cx="24" cy="56.5" rx="14" ry="2.2" fill="rgba(40, 25, 8, 0.2)" />

      {/* 纸页主体 */}
      <path
        fill={`url(#${paperGrad})`}
        stroke="#a89880"
        stroke-width="1.1"
        d="M9 4h18l13 13v35c0 2.2-1.8 4-4 4H9c-2.2 0-4-1.8-4-4V8c0-2.2 1.8-4 4-4z"
      />
      {/* 右下侧沿：轻微厚度，不做整页叠底 */}
      <path
        fill="#d8d0c4"
        d="M38.8 49.2c-1.3 1.3-3.1 2.1-5.1 2.1H9c-2.2 0-4-1.8-4-4v1.2c0 2.2 1.8 4 4 4h24.7c2.2 0 4-1.8 4-4v-3.1H38.8z"
        opacity="0.55"
      />
      <path
        fill="#fff"
        opacity="0.55"
        d="M9.8 5.3H26l11.5 11.5V51c0 1.3-1.1 2.4-2.4 2.4H9.8c-1.3 0-2.4-1.1-2.4-2.4V7.7c0-1.3 1.1-2.4 2.4-2.4z"
      />

      {/* 正文条（右侧，浮雕感） */}
      <rect x="22.5" y="22" width="12.5" height="1.5" rx="0.75" fill={`url(#${lineGrad})`} />
      <rect x="22.5" y="26.2" width="12.5" height="1.5" rx="0.75" fill={`url(#${lineGrad})`} />
      <rect x="22.5" y="30.4" width="12.5" height="1.5" rx="0.75" fill={`url(#${lineGrad})`} />
      <rect x="22.5" y="34.6" width="10.5" height="1.5" rx="0.75" fill={`url(#${lineGrad})`} opacity="0.9" />
      <rect x="22.5" y="38.8" width="11.5" height="1.5" rx="0.75" fill={`url(#${lineGrad})`} opacity="0.85" />

      {/* W 徽章（以中心 17.8, 33.8 放大 2 倍，略向左） */}
      <g transform="translate(-7.5 0) translate(17.8 33.8) scale(2) translate(-17.8 -33.8)">
        {/* W 徽章厚度 */}
        <rect
          x="11.8"
          y="27.8"
          width="13.6"
          height="13.6"
          rx="2.4"
          fill="#143258"
          transform="translate(0.9 0.9)"
          opacity="0.75"
        />

        {/* W 徽章正面 */}
        <rect x="11" y="27" width="13.6" height="13.6" rx="2.4" fill={`url(#${badgeGrad})`} />
        <rect x="11" y="27" width="13.6" height="6.2" rx="2.4" fill={`url(#${badgeGloss})`} />
        <path
          fill="none"
          stroke="rgba(255,255,255,0.55)"
          stroke-width="0.9"
          stroke-linecap="round"
          d="M12.2 28.3h11.2"
        />
        <path fill="rgba(0,0,0,0.18)" d="M11 39.2h13.6v1.4H11z" />

        {/* W 字：阴影 → 高光 → 本体 */}
        <text
          x="17.8"
          y="34.2"
          text-anchor="middle"
          dominant-baseline="central"
          font-family="Georgia, 'Times New Roman', serif"
          font-size="11.5"
          font-weight="700"
          fill="#0f2848"
          opacity="0.45"
        >
          W
        </text>
        <text
          x="17.45"
          y="33.75"
          text-anchor="middle"
          dominant-baseline="central"
          font-family="Georgia, 'Times New Roman', serif"
          font-size="11.5"
          font-weight="700"
          fill="rgba(255,255,255,0.55)"
        >
          W
        </text>
        <text
          x="17.8"
          y="33.95"
          text-anchor="middle"
          dominant-baseline="central"
          font-family="Georgia, 'Times New Roman', serif"
          font-size="11.5"
          font-weight="700"
          fill="#ffffff"
        >
          W
        </text>
      </g>

      {/* 折角（盖住右上，带下沿阴影） */}
      <path
        fill={`url(#${foldGrad})`}
        stroke="#a89880"
        stroke-width="1"
        d="M27 4.2v11.2c0 1.1.9 2 2 2H40L27 4.2z"
      />
      <path fill="rgba(255,255,255,0.35)" d="M27.4 4.6 L38.2 15.2 L27.4 15.2 Z" />
      <path fill="rgba(60,45,25,0.12)" d="M27 15.2h13v0.8H27z" />
    </svg>
  )
}

function DocxFileIcon({ size }: { size: FilesNodeIconSize }) {
  return (
    <span
      class={`files-node-icon files-node-icon--${size} files-node-icon--docx`}
      aria-hidden="true"
    >
      <DocxFileGlyph className="files-node-icon__glyph files-node-icon__glyph--file" />
    </span>
  )
}

/** 压缩包：折角页中间一条拉链 + 底部拉片（不读文件内容） */
function ArchiveFileGlyph({ className }: { className: string }) {
  return (
    <svg
      class={className}
      viewBox="4 2 38 58"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <ellipse cx="24" cy="56.5" rx="14" ry="2.2" fill="rgba(40, 25, 8, 0.18)" />
      <path
        fill="#f4f1ec"
        stroke="#8a837c"
        stroke-width="1.2"
        d="M9 4h18l13 13v35c0 2.2-1.8 4-4 4H9c-2.2 0-4-1.8-4-4V8c0-2.2 1.8-4 4-4z"
      />
      <path
        fill="#faf8f5"
        d="M9.8 5.3H26l11.5 11.5V51c0 1.3-1.1 2.4-2.4 2.4H9.8c-1.3 0-2.4-1.1-2.4-2.4V7.7c0-1.3 1.1-2.4 2.4-2.4z"
      />
      <path
        fill="#d9d4cd"
        stroke="#8a837c"
        stroke-width="1"
        d="M27 4.2v11.2c0 1.1.9 2 2 2H40L27 4.2z"
      />
      {/* 拉链带 */}
      <rect x="21.2" y="19.2" width="5.6" height="24.6" rx="1.1" fill="#c8c2ba" />
      <path
        fill="none"
        stroke="#57534e"
        stroke-width="0.95"
        stroke-linecap="round"
        d="M24 20 V42.4"
      />
      {/* 拉链齿：左右成对，块面够大以便列表尺寸仍可辨 */}
      <g fill="#44403c">
        <rect x="20.3" y="21" width="3.7" height="1.7" rx="0.35" />
        <rect x="24" y="21" width="3.7" height="1.7" rx="0.35" />
        <rect x="20.3" y="24.4" width="3.7" height="1.7" rx="0.35" />
        <rect x="24" y="24.4" width="3.7" height="1.7" rx="0.35" />
        <rect x="20.3" y="27.8" width="3.7" height="1.7" rx="0.35" />
        <rect x="24" y="27.8" width="3.7" height="1.7" rx="0.35" />
        <rect x="20.3" y="31.2" width="3.7" height="1.7" rx="0.35" />
        <rect x="24" y="31.2" width="3.7" height="1.7" rx="0.35" />
        <rect x="20.3" y="34.6" width="3.7" height="1.7" rx="0.35" />
        <rect x="24" y="34.6" width="3.7" height="1.7" rx="0.35" />
        <rect x="20.3" y="38" width="3.7" height="1.7" rx="0.35" />
        <rect x="24" y="38" width="3.7" height="1.7" rx="0.35" />
      </g>
      {/* 滑块 */}
      <rect
        x="20.4"
        y="40.4"
        width="7.2"
        height="5.4"
        rx="1.1"
        fill="#a8a29e"
        stroke="#44403c"
        stroke-width="0.75"
      />
      <path
        fill="none"
        stroke="rgba(255,255,255,0.45)"
        stroke-width="0.7"
        stroke-linecap="round"
        d="M21.6 41.6h4.8"
      />
      {/* 拉片 */}
      <path
        fill="none"
        stroke="#57534e"
        stroke-width="1.15"
        stroke-linecap="round"
        d="M24 45.8v3"
      />
      <rect
        x="21.4"
        y="48.2"
        width="5.2"
        height="3.4"
        rx="0.85"
        fill="#d6d3d1"
        stroke="#57534e"
        stroke-width="0.7"
      />
    </svg>
  )
}

function ArchiveFileIcon({ size }: { size: FilesNodeIconSize }) {
  return (
    <span
      class={`files-node-icon files-node-icon--${size} files-node-icon--archive`}
      aria-hidden="true"
    >
      <ArchiveFileGlyph className="files-node-icon__glyph files-node-icon__glyph--file" />
    </span>
  )
}

/**
 * ISO 光盘镜像：同心环 + 虹彩高光 + 中孔。
 * 圆形构图，独立 48×48 viewBox（不沿用折角纸模板）。
 */
function IsoDiscGlyph({ className }: { className: string }) {
  const rawId = useId()
  const uid = rawId.replace(/[^a-zA-Z0-9_-]/g, '')
  const faceGrad = `iso-face-${uid}`
  const rainbowGrad = `iso-rainbow-${uid}`
  return (
    <svg
      class={className}
      viewBox="0 0 48 48"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={faceGrad} cx="0.36" cy="0.3" r="0.9">
          <stop offset="0%" stop-color="#fbfcfe" />
          <stop offset="52%" stop-color="#dde4ec" />
          <stop offset="100%" stop-color="#a6b0bf" />
        </radialGradient>
        <linearGradient id={rainbowGrad} x1="0.05" y1="0.1" x2="0.95" y2="0.9">
          <stop offset="0%" stop-color="#7dd3fc" />
          <stop offset="34%" stop-color="#c4b5fd" />
          <stop offset="68%" stop-color="#fda4af" />
          <stop offset="100%" stop-color="#fcd34d" />
        </linearGradient>
      </defs>
      {/* 落地阴影 */}
      <ellipse cx="24" cy="44.6" rx="15.5" ry="2.1" fill="rgba(24, 32, 44, 0.22)" />
      {/* 盘体 */}
      <circle
        cx="24"
        cy="23.5"
        r="19.5"
        fill={`url(#${faceGrad})`}
        stroke="#8b94a3"
        stroke-width="1"
      />
      {/* 同心数据环 */}
      <circle cx="24" cy="23.5" r="16.8" fill="none" stroke="#c2cbd7" stroke-width="0.9" />
      <circle cx="24" cy="23.5" r="12.4" fill="none" stroke="#ccd4de" stroke-width="0.7" />
      {/* 虹彩高光环带（中孔外圈到数据区之间） */}
      <circle
        cx="24"
        cy="23.5"
        r="10.4"
        fill="none"
        stroke={`url(#${rainbowGrad})`}
        stroke-width="5.4"
        opacity="0.42"
      />
      {/* 斜向白色眩光 */}
      <ellipse
        cx="17.5"
        cy="14.5"
        rx="13"
        ry="6.2"
        transform="rotate(-32 17.5 14.5)"
        fill="rgba(255, 255, 255, 0.38)"
      />
      {/* 中孔 */}
      <circle cx="24" cy="23.5" r="5.4" fill="#f7f8fa" stroke="#8b94a3" stroke-width="0.95" />
      <path
        fill="none"
        stroke="rgba(139, 148, 163, 0.55)"
        stroke-width="1.1"
        stroke-linecap="round"
        d="M20.6 21.9a4.4 4.4 0 0 1 3.4 -1.75"
      />
    </svg>
  )
}

function IsoDiscIcon({ size }: { size: FilesNodeIconSize }) {
  return (
    <span
      class={`files-node-icon files-node-icon--${size} files-node-icon--iso-disc`}
      aria-hidden="true"
    >
      <IsoDiscGlyph className="files-node-icon__glyph files-node-icon__glyph--file" />
    </span>
  )
}

/** 3.5 寸盘：x 左右、y 近远（1 为近端）、z 上下。带一点透视，近大远小。 */
function projectHddPoint(x: number, y: number, z: number): [number, number] {
  const width = x - 0.5
  const depth = (y - 0.5) * 0.7
  const height = (z - 0.5) * 0.32
  const pitch = -0.68
  const yaw = 0.18
  const cosPitch = Math.cos(pitch)
  const sinPitch = Math.sin(pitch)
  const cosYaw = Math.cos(yaw)
  const sinYaw = Math.sin(yaw)
  const cameraX = width * cosYaw - depth * sinYaw
  const cameraY = width * sinYaw + depth * cosYaw
  const rotatedY = cameraY * cosPitch - height * sinPitch
  const rotatedZ = cameraY * sinPitch + height * cosPitch
  const perspective = 3.4 / (3.4 - rotatedY)
  return [24.5 + cameraX * 36 * perspective, 23 - rotatedZ * 36 * perspective]
}

function hddPoly(points: Array<[number, number]>, close = true): string {
  const body = points
    .map(([px, py], index) => `${index === 0 ? 'M' : 'L'}${px.toFixed(2)} ${py.toFixed(2)}`)
    .join(' ')
  return close ? `${body} Z` : body
}

function hddArcPoints(
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number,
  z: number,
  steps: number,
): Array<[number, number]> {
  return Array.from({ length: steps + 1 }, (_, index) => {
    const angle = startAngle + (endAngle - startAngle) * (index / steps)
    return projectHddPoint(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle), z)
  })
}

function hddCirclePoints(
  cx: number,
  cy: number,
  radius: number,
  z: number,
  steps = 28,
): Array<[number, number]> {
  return Array.from({ length: steps }, (_, index) => {
    const angle = (index / steps) * Math.PI * 2
    return projectHddPoint(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle), z)
  })
}

const HDD_CORNER = 0.055

function hddRoundRectPoints(z: number): Array<[number, number]> {
  const radius = HDD_CORNER
  return [
    ...hddArcPoints(radius, 1 - radius, radius, Math.PI, Math.PI / 2, z, 4),
    ...hddArcPoints(1 - radius, 1 - radius, radius, Math.PI / 2, 0, z, 4).slice(1),
    ...hddArcPoints(1 - radius, radius, radius, 0, -Math.PI / 2, z, 4).slice(1),
    ...hddArcPoints(radius, radius, radius, -Math.PI / 2, -Math.PI, z, 4).slice(1),
  ]
}

function hddFrontEdge(z: number, steps = 10): Array<[number, number]> {
  return Array.from({ length: steps + 1 }, (_, index) => {
    const t = index / steps
    return projectHddPoint(HDD_CORNER + (1 - 2 * HDD_CORNER) * t, 1, z)
  })
}

function hddRightEdge(z: number, steps = 10): Array<[number, number]> {
  return Array.from({ length: steps + 1 }, (_, index) => {
    const t = index / steps
    return projectHddPoint(1, 1 - HDD_CORNER - (1 - 2 * HDD_CORNER) * t, z)
  })
}

function hddQuad(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  z: number,
): Array<[number, number]> {
  return [
    projectHddPoint(x0, y0, z),
    projectHddPoint(x1, y0, z),
    projectHddPoint(x1, y1, z),
    projectHddPoint(x0, y1, z),
  ]
}

/**
 * 硬盘镜像：3.5 寸内置硬盘合盖，斜俯视一点透视。
 * 远端收窄、竖边向下汇聚；盘腔/压筋/螺丝画在顶面上。
 */
function HddDiscGlyph({ className }: { className: string }) {
  const rawId = useId()
  const uid = rawId.replace(/[^a-zA-Z0-9_-]/g, '')
  const lidGrad = `hdd-lid-${uid}`
  const lidFrontGrad = `hdd-lid-front-${uid}`
  const lidSideGrad = `hdd-lid-side-${uid}`
  const chassisFrontGrad = `hdd-chas-front-${uid}`
  const chassisSideGrad = `hdd-chas-side-${uid}`
  const wellGrad = `hdd-well-${uid}`
  const ridgeGrad = `hdd-ridge-${uid}`
  const screwGrad = `hdd-screw-${uid}`
  const sheenGrad = `hdd-sheen-${uid}`
  const lidClip = `hdd-lid-clip-${uid}`
  const lidTopZ = 1
  const lidBottomZ = 0.8
  const chassisBottomZ = 0
  const lidTop = hddRoundRectPoints(lidTopZ)
  const frontTop = hddFrontEdge(lidTopZ)
  const frontLid = hddFrontEdge(lidBottomZ)
  const frontChassis = hddFrontEdge(chassisBottomZ)
  const rightTop = hddRightEdge(lidTopZ)
  const rightLid = hddRightEdge(lidBottomZ)
  const rightChassis = hddRightEdge(chassisBottomZ)
  const screws: Array<[number, number]> = [
    [0.1, 0.88],
    [0.9, 0.88],
    [0.1, 0.5],
    [0.9, 0.5],
    [0.1, 0.12],
    [0.9, 0.12],
  ]
  const wellHighlight = hddArcPoints(0.5, 0.58, 0.168, 3.4, 4.4, lidTopZ, 8)
  const farHighlight = Array.from({ length: 8 }, (_, index) => {
    const t = index / 7
    return projectHddPoint(0.08 + 0.84 * t, 0.02, lidTopZ)
  })
  const frontHighlight = hddFrontEdge(lidTopZ, 8)
  return (
    <svg
      class={className}
      viewBox="0 0 48 48"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={lidGrad} x1="0.12" y1="0" x2="0.88" y2="1">
          <stop offset="0%" stop-color="#f5f7fa" />
          <stop offset="36%" stop-color="#d5dbe4" />
          <stop offset="100%" stop-color="#9aa3b0" />
        </linearGradient>
        <linearGradient id={lidFrontGrad} x1="0" y1="0" x2="0.2" y2="1">
          <stop offset="0%" stop-color="#d8dee6" />
          <stop offset="38%" stop-color="#b4bcc7" />
          <stop offset="100%" stop-color="#7e8794" />
        </linearGradient>
        <linearGradient id={lidSideGrad} x1="0" y1="0" x2="1" y2="0.2">
          <stop offset="0%" stop-color="#8b94a1" />
          <stop offset="100%" stop-color="#5c6572" />
        </linearGradient>
        <linearGradient id={chassisFrontGrad} x1="0" y1="0" x2="0.12" y2="1">
          <stop offset="0%" stop-color="#5a6270" />
          <stop offset="48%" stop-color="#3c4450" />
          <stop offset="100%" stop-color="#262c36" />
        </linearGradient>
        <linearGradient id={chassisSideGrad} x1="0" y1="0" x2="1" y2="0.2">
          <stop offset="0%" stop-color="#3a424c" />
          <stop offset="100%" stop-color="#1c222a" />
        </linearGradient>
        <radialGradient id={wellGrad} cx="0.34" cy="0.28" r="0.74">
          <stop offset="0%" stop-color="#c5ccd6" />
          <stop offset="52%" stop-color="#8e97a4" />
          <stop offset="100%" stop-color="#5e6774" />
        </radialGradient>
        <linearGradient id={ridgeGrad} x1="0.18" y1="0.15" x2="0.82" y2="0.9">
          <stop offset="0%" stop-color="#eef1f5" />
          <stop offset="48%" stop-color="#c5ccd5" />
          <stop offset="100%" stop-color="#7e8794" />
        </linearGradient>
        <radialGradient id={screwGrad} cx="0.32" cy="0.26" r="0.72">
          <stop offset="0%" stop-color="#f7f8fa" />
          <stop offset="52%" stop-color="#c5ccd5" />
          <stop offset="100%" stop-color="#7a8490" />
        </radialGradient>
        <radialGradient id={sheenGrad} cx="0.28" cy="0.18" r="0.7">
          <stop offset="0%" stop-color="rgba(255,255,255,0.4)" />
          <stop offset="58%" stop-color="rgba(255,255,255,0)" />
        </radialGradient>
        <clipPath id={lidClip}>
          <path d={hddPoly(lidTop)} />
        </clipPath>
      </defs>
      <ellipse cx="26.2" cy="44.4" rx="16.6" ry="2.1" fill="rgba(24, 32, 44, 0.24)" />
      <path d={hddPoly([...rightLid, ...rightChassis.slice().reverse()])} fill={`url(#${chassisSideGrad})`} />
      <path d={hddPoly([...rightTop, ...rightLid.slice().reverse()])} fill={`url(#${lidSideGrad})`} />
      <path
        d={hddPoly([...frontLid, ...frontChassis.slice().reverse()])}
        fill={`url(#${chassisFrontGrad})`}
      />
      <path d={hddPoly(hddQuad(0.03, 1.02, 0.13, 1.06, 0.08))} fill="#4a5260" />
      <path d={hddPoly(hddQuad(0.87, 1.02, 0.97, 1.06, 0.08))} fill="#4a5260" />
      <path
        d={hddPoly([
          projectHddPoint(0.22, 1, 0.72),
          projectHddPoint(0.78, 1, 0.72),
          projectHddPoint(0.78, 1, 0.12),
          projectHddPoint(0.22, 1, 0.12),
        ])}
        fill="#1a1f27"
      />
      {Array.from({ length: 7 }, (_, index) => {
        const t0 = 0.26 + index * 0.07
        const t1 = t0 + 0.028
        return (
          <path
            key={`fin-${index}`}
            d={hddPoly([
              projectHddPoint(t0, 1, 0.68),
              projectHddPoint(t1, 1, 0.68),
              projectHddPoint(t1, 1, 0.16),
              projectHddPoint(t0, 1, 0.16),
            ])}
            fill="#0b0f15"
          />
        )
      })}
      <path d={hddPoly([...frontTop, ...frontLid.slice().reverse()])} fill={`url(#${lidFrontGrad})`} />
      <path
        d={hddPoly(frontHighlight, false)}
        fill="none"
        stroke="rgba(255,255,255,0.55)"
        stroke-width="0.7"
        stroke-linecap="round"
      />
      <path
        d={hddPoly(lidTop)}
        fill={`url(#${lidGrad})`}
        stroke="#7a8490"
        stroke-width="0.75"
      />
      <g clip-path={`url(#${lidClip})`}>
        <path d={hddPoly(lidTop)} fill={`url(#${sheenGrad})`} />
        <path d={hddPoly(hddCirclePoints(0.5, 0.58, 0.205, lidTopZ))} fill={`url(#${wellGrad})`} />
        <path
          d={hddPoly(hddCirclePoints(0.52, 0.56, 0.188, lidTopZ))}
          fill="none"
          stroke="rgba(40,48,58,0.34)"
          stroke-width="0.85"
        />
        <path
          d={hddPoly(wellHighlight, false)}
          fill="none"
          stroke="rgba(255,255,255,0.32)"
          stroke-width="0.85"
          stroke-linecap="round"
        />
        <path
          d={hddPoly(hddCirclePoints(0.5, 0.58, 0.255, lidTopZ))}
          fill="none"
          stroke="rgba(70,78,90,0.28)"
          stroke-width="2.5"
        />
        <path
          d={hddPoly(hddCirclePoints(0.5, 0.58, 0.255, lidTopZ))}
          fill="none"
          stroke={`url(#${ridgeGrad})`}
          stroke-width="2.15"
        />
        <path
          d={hddPoly([projectHddPoint(0.6, 0.38, lidTopZ), projectHddPoint(0.64, 0.08, lidTopZ)], false)}
          fill="none"
          stroke="rgba(70,78,90,0.28)"
          stroke-width="2.5"
          stroke-linecap="round"
        />
        <path
          d={hddPoly([projectHddPoint(0.6, 0.38, lidTopZ), projectHddPoint(0.64, 0.08, lidTopZ)], false)}
          fill="none"
          stroke={`url(#${ridgeGrad})`}
          stroke-width="2.15"
          stroke-linecap="round"
        />
        <path
          d={hddPoly(hddQuad(0.73, 0.46, 0.84, 0.7, lidTopZ))}
          fill="#e4e8ee"
          stroke="#8b94a1"
          stroke-width="0.4"
        />
        <path d={hddPoly(hddQuad(0.755, 0.5, 0.815, 0.66, lidTopZ))} fill="#c5ccd6" />
        <path d={hddPoly(hddQuad(0.2, 0.06, 0.5, 0.165, lidTopZ))} fill="#1a1d22" />
        <path d={hddPoly(hddQuad(0.22, 0.085, 0.38, 0.11, lidTopZ))} fill="#d8dce3" />
        <path d={hddPoly(hddQuad(0.22, 0.12, 0.34, 0.14, lidTopZ))} fill="#9aa3ae" />
        <path
          d={hddPoly([
            projectHddPoint(0.42, 0.075, lidTopZ),
            projectHddPoint(0.465, 0.155, lidTopZ),
            projectHddPoint(0.375, 0.155, lidTopZ),
          ])}
          fill="#e8eaee"
        />
        {screws.map(([sx, sy]) => {
          const [cx, cy] = projectHddPoint(sx, sy, lidTopZ)
          return (
            <g key={`screw-${sx}-${sy}`}>
              <circle
                cx={cx}
                cy={cy}
                r="1.15"
                fill={`url(#${screwGrad})`}
                stroke="#6a7380"
                stroke-width="0.35"
              />
              <circle cx={cx - 0.28} cy={cy - 0.32} r="0.32" fill="rgba(255,255,255,0.74)" />
            </g>
          )
        })}
      </g>
      <path
        d={hddPoly(farHighlight, false)}
        fill="none"
        stroke="rgba(255,255,255,0.55)"
        stroke-width="0.9"
        stroke-linecap="round"
      />
    </svg>
  )
}

function HddFileIcon({ size }: { size: FilesNodeIconSize }) {
  return (
    <span
      class={`files-node-icon files-node-icon--${size} files-node-icon--hdd`}
      aria-hidden="true"
    >
      <HddDiscGlyph className="files-node-icon__glyph files-node-icon__glyph--file" />
    </span>
  )
}

/**
 * Windows 可执行文件：仿 Mac 上经典 EXE 图标——
 * 深色圆角瓷砖内嵌蓝色渐变卡片（上部亮条以横线分隔），
 * 右侧一条贯穿上下的拉链（安装包隐喻），滑块压在分隔线上，拉片垂下。
 */
function ExeExecutableGlyph({ className }: { className: string }) {
  const rawId = useId()
  const uid = rawId.replace(/[^a-zA-Z0-9_-]/g, '')
  const tileGrad = `exe-tile-${uid}`
  const faceGrad = `exe-face-${uid}`
  const glossGrad = `exe-gloss-${uid}`
  const metalGrad = `exe-metal-${uid}`
  const faceClip = `exe-face-clip-${uid}`
  // 蓝卡与拉链的关键坐标：卡片 x 8.5–39.5；拉链中轴靠右，给左下角 EXE 字留出空间
  const zipX = 33.1
  const teeth: number[] = []
  for (let y = 9.4; y <= 38.4; y += 2.64) teeth.push(y)

  return (
    <svg
      class={className}
      viewBox="0 0 48 48"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={tileGrad} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#4c4c54" />
          <stop offset="100%" stop-color="#212126" />
        </linearGradient>
        <linearGradient id={faceGrad} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#74bcf7" />
          <stop offset="45%" stop-color="#3a88dc" />
          <stop offset="100%" stop-color="#1460ae" />
        </linearGradient>
        <linearGradient id={glossGrad} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="rgba(255,255,255,0.5)" />
          <stop offset="100%" stop-color="rgba(255,255,255,0)" />
        </linearGradient>
        <linearGradient id={metalGrad} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#f4f6f9" />
          <stop offset="100%" stop-color="#96a0ab" />
        </linearGradient>
        <clipPath id={faceClip}>
          <rect x="8.5" y="8.5" width="31" height="31" rx="4.5" />
        </clipPath>
      </defs>

      {/* 落地阴影 */}
      <ellipse cx="24" cy="45.6" rx="15.5" ry="1.6" fill="rgba(15, 20, 30, 0.24)" />

      {/* 深色圆角瓷砖 */}
      <rect
        x="3.5"
        y="3.5"
        width="41"
        height="41"
        rx="9"
        fill={`url(#${tileGrad})`}
        stroke="rgba(10,10,14,0.6)"
        stroke-width="0.9"
      />
      <path
        fill="none"
        stroke="rgba(255,255,255,0.08)"
        stroke-width="0.9"
        stroke-linecap="round"
        d="M12.5 4.4h23"
      />

      {/* 蓝色渐变卡片 */}
      <rect
        x="8.5"
        y="8.5"
        width="31"
        height="31"
        rx="4.5"
        fill={`url(#${faceGrad})`}
        stroke="rgba(5,38,76,0.55)"
        stroke-width="0.9"
      />
      <g clip-path={`url(#${faceClip})`}>
        {/* 整面斜向釉光 */}
        <rect
          x="8.5"
          y="8.5"
          width="31"
          height="16"
          fill={`url(#${glossGrad})`}
          opacity="0.55"
        />
        {/* 上部亮条：略提亮，底缘横线 + 下缘窄阴影压出「标题栏」层次 */}
        <rect x="8.5" y="8.5" width="31" height="8.5" fill="rgba(255,255,255,0.14)" />
        <rect x="8.5" y="17" width="31" height="1.1" fill="rgba(9,42,82,0.16)" />
        <path
          fill="none"
          stroke="rgba(255,255,255,0.6)"
          stroke-width="0.85"
          stroke-linecap="round"
          d="M9.4 17h29.2"
        />

        {/* 拉链带两侧缝线 */}
        <path
          fill="none"
          stroke="rgba(8,40,78,0.3)"
          stroke-width="0.9"
          d={`M${zipX - 3.5} 8.5V39.5`}
        />
        <path
          fill="none"
          stroke="rgba(8,40,78,0.3)"
          stroke-width="0.9"
          d={`M${zipX + 3.5} 8.5V39.5`}
        />
        {/* 中轴合缝 */}
        <path
          fill="none"
          stroke="rgba(12,48,90,0.45)"
          stroke-width="0.8"
          d={`M${zipX} 8.5V39.5`}
        />
        {/* 拉链齿：左右成对咬合 */}
        <g fill="#d9dee5" stroke="rgba(66,76,88,0.55)" stroke-width="0.35">
          {teeth.flatMap((y) => [
            <rect key={`l-${y}`} x={zipX - 3.35} y={y} width="3.1" height="1.66" rx="0.38" />,
            <rect key={`r-${y}`} x={zipX + 0.25} y={y} width="3.1" height="1.66" rx="0.38" />,
          ])}
        </g>

        {/* 滑块主体（跨在亮条分隔线上） */}
        <rect
          x={zipX - 3.9}
          y="11.4"
          width="7.8"
          height="5.6"
          rx="1.6"
          fill={`url(#${metalGrad})`}
          stroke="#4d5661"
          stroke-width="0.7"
        />
        <rect
          x={zipX - 1.15}
          y="12.5"
          width="2.3"
          height="1.7"
          rx="0.5"
          fill="rgba(40,48,58,0.35)"
        />
        {/* 拉片：垂到主区，带穿孔 */}
        <rect
          x={zipX - 1.55}
          y="16.7"
          width="3.1"
          height="4.8"
          rx="1.35"
          fill={`url(#${metalGrad})`}
          stroke="#4d5661"
          stroke-width="0.6"
        />
        <ellipse cx={zipX} cy="20.1" rx="0.85" ry="1.3" fill="rgba(30,38,46,0.4)" />

        {/* 左下角 EXE 字：深衬 + 白面 */}
        <text
          x="11.2"
          y="35.9"
          font-family="ui-rounded, system-ui, -apple-system, 'Segoe UI', sans-serif"
          font-size="8.4"
          font-weight="800"
          letter-spacing="0.35"
          fill="rgba(7,32,64,0.4)"
        >
          EXE
        </text>
        <text
          x="11.2"
          y="35.4"
          font-family="ui-rounded, system-ui, -apple-system, 'Segoe UI', sans-serif"
          font-size="8.4"
          font-weight="800"
          letter-spacing="0.35"
          fill="#ffffff"
        >
          EXE
        </text>
      </g>
    </svg>
  )
}

function ExeFileIcon({ size }: { size: FilesNodeIconSize }) {
  return (
    <span
      class={`files-node-icon files-node-icon--${size} files-node-icon--exe`}
      aria-hidden="true"
    >
      <ExeExecutableGlyph className="files-node-icon__glyph files-node-icon__glyph--file" />
    </span>
  )
}

/** 「新建文件夹」等无节点场景的静态文件夹图标 */
export function FilesFolderTemplateIcon({ size = 'grid' }: { size?: FilesNodeIconSize }) {
  return (
    <span class={`files-node-icon files-node-icon--${size}`} aria-hidden="true">
      <FolderGlyph className="files-node-icon__glyph files-node-icon__glyph--folder" />
    </span>
  )
}

/** 「新建文本文件」等无节点场景的静态 TXT 图标 */
export function FilesTxtTemplateIcon({ size = 'grid' }: { size?: FilesNodeIconSize }) {
  return <TxtFileIcon nodeId="" byteSize={0} size={size} staticPreview="" />
}

export function FilesNodeIcon({
  node,
  size = 'grid',
}: {
  node: FilesNode
  size?: FilesNodeIconSize
}) {
  const [, setPrefsEpoch] = useState(0)

  useEffect(() => {
    const onPrefsChanged = () => setPrefsEpoch((value) => value + 1)
    window.addEventListener(FILE_OPEN_PREFS_CHANGED_EVENT, onPrefsChanged)
    return () => window.removeEventListener(FILE_OPEN_PREFS_CHANGED_EVENT, onPrefsChanged)
  }, [])

  if (node.kind === 'folder') {
    if (isApplicationsBundleRootNode(node)) {
      return <FilesAppBundleIcon node={node} size={size} />
    }
    if (isUserSpecialFolderNode(node)) {
      return (
        <span class={`files-node-icon files-node-icon--${size}`} aria-hidden="true">
          <SpecialUserFolderGlyph
            name={node.name as UserSpecialFolderName}
            className="files-node-icon__glyph files-node-icon__glyph--folder"
          />
        </span>
      )
    }
    return (
      <span class={`files-node-icon files-node-icon--${size}`} aria-hidden="true">
        <FolderGlyph className="files-node-icon__glyph files-node-icon__glyph--folder" />
      </span>
    )
  }

  if (node.name === '.DS_Store') {
    return <BlankFileMarkIcon size={size} mark="💩" />
  }

  const defaultApp = getDefaultFileOpenApp(node.name)
  const extension = fileNameExtension(node.name)
  const codeSpec = resolveCodeFileIconSpec(node.name)

  if (defaultApp === 'pages') {
    return <BlankFileMarkIcon size={size} mark="📄" />
  }

  if (codeSpec) {
    return (
      <CodeFileIcon extension={codeSpec.extension} label={codeSpec.label} size={size} />
    )
  }

  /** txt / html 等可选关联：用户选「始终用 Code」时切到 Code 卡片 */
  if (defaultApp === 'vscode' && extension) {
    return <CodeFileIcon extension={extension} size={size} />
  }

  if (defaultApp === 'textedit' || isTxtFilesNode(node)) {
    return <TxtFileIcon nodeId={node.id} byteSize={node.byteSize} size={size} />
  }

  if (defaultApp === 'browser' || isBrowserOpenExtension(extension)) {
    return (
      <BrowserFileIcon
        nodeId={node.id}
        byteSize={node.byteSize}
        size={size}
        extension={extension ?? 'html'}
      />
    )
  }

  if (isImageFileExtension(extension)) {
    return <ImageFileIcon size={size} />
  }

  if (isLyricFileExtension(extension)) {
    return <LyricFileIcon size={size} />
  }

  if (isMusicFileExtension(extension)) {
    return <MusicFileIcon size={size} />
  }

  if (isModel3dFileExtension(extension)) {
    return <Model3dFileIcon size={size} />
  }

  if (isDocxFileExtension(extension)) {
    return <DocxFileIcon size={size} />
  }

  if (extension === 'exe') {
    return <ExeFileIcon size={size} />
  }

  if (extension === 'iso') {
    return <IsoDiscIcon size={size} />
  }

  if (isDiskImageFileName(node.name)) {
    return <HddFileIcon size={size} />
  }

  if (resolveArchiveUtilityFormat(node.name)) {
    return <ArchiveFileIcon size={size} />
  }

  return <BlankFileMarkIcon size={size} mark="?" />
}
