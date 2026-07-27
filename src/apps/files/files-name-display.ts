import { isAppBundleName } from '../../os/app-catalog.ts'
import {
  fileNameExtension,
  getDefaultFileOpenApp,
} from '../../os/file-open-registry.ts'
import { VSCODE_OPEN_EXTENSIONS } from '../vscode/vscode-tabs.ts'
import {
  isBrowserOpenExtension,
  isDocxFileExtension,
  isImageFileExtension,
  isModel3dFileExtension,
} from './files-node-icon.tsx'

const NAME_DISPLAY_STORAGE_KEY = 'files.nameDisplay'

/** 文件名后缀显示：全部 / 仅未知 / 全部隐藏 */
export type FilesNameDisplayMode = 'all' | 'unknown' | 'none'

export const FILES_NAME_DISPLAY_OPTIONS: ReadonlyArray<{
  id: FilesNameDisplayMode
  label: string
}> = [
  { id: 'all', label: '显示全部后缀名' },
  { id: 'unknown', label: '显示未知的文件后缀名' },
  { id: 'none', label: '不显示任何后缀名' },
]

const VSCODE_OPEN_EXTENSION_SET = new Set<string>(VSCODE_OPEN_EXTENSIONS)

export function readFilesNameDisplayMode(): FilesNameDisplayMode {
  try {
    const raw = localStorage.getItem(NAME_DISPLAY_STORAGE_KEY)
    if (raw === 'all' || raw === 'unknown' || raw === 'none') return raw
  } catch {
    // ignore
  }
  return 'unknown'
}

export function writeFilesNameDisplayMode(mode: FilesNameDisplayMode): void {
  try {
    localStorage.setItem(NAME_DISPLAY_STORAGE_KEY, mode)
  } catch {
    // ignore
  }
}

function stripFileExtension(fileName: string): string {
  const base = fileName.trim()
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) return base
  return base.slice(0, dot)
}

/** 系统能识别用途/图标的后缀（含 .app）；无后缀不算「未知」 */
export function isKnownFilesNameExtension(fileName: string): boolean {
  if (isAppBundleName(fileName)) return true
  const extension = fileNameExtension(fileName)
  if (!extension) return false
  if (getDefaultFileOpenApp(fileName)) return true
  if (
    isBrowserOpenExtension(extension) ||
    isImageFileExtension(extension) ||
    isModel3dFileExtension(extension) ||
    isDocxFileExtension(extension)
  ) {
    return true
  }
  return VSCODE_OPEN_EXTENSION_SET.has(extension)
}

export function formatFilesDisplayName(
  fileName: string,
  mode: FilesNameDisplayMode,
): string {
  if (mode === 'all') return fileName
  const extension = fileNameExtension(fileName)
  if (!extension && !isAppBundleName(fileName)) return fileName

  if (mode === 'none') {
    return stripFileExtension(fileName)
  }

  // unknown：隐藏已知后缀，保留未知后缀
  if (isKnownFilesNameExtension(fileName)) {
    return stripFileExtension(fileName)
  }
  return fileName
}
