import {
  joinFilesAbsolutePath,
  normalizeFilesNodeName,
  parseFilesAbsolutePath,
} from '../apps/files/files-path.ts'
import { fileNameExtension, normalizeFileExtension } from '../os/file-open-registry.ts'

const FORBIDDEN = /[/\\:\u0000-\u001f\u007f]/g

function fallbackUntitled(extension?: string): string {
  return extension ? `untitled.${extension}` : 'untitled'
}

/** 对话框「存储」用的文件名：去掉非法字符，缺后缀时补上 defaultExtension。 */
export function sanitizeSaveFileName(raw: string, defaultExtension?: string): string {
  const fallbackExt = defaultExtension ? normalizeFileExtension(defaultExtension) : ''
  let name = raw.trim().replace(FORBIDDEN, '_').replace(/^\.+/g, '')
  if (!name) {
    return fallbackUntitled(fallbackExt || undefined)
  }

  try {
    name = normalizeFilesNodeName(name)
  } catch {
    return fallbackUntitled(fallbackExt || undefined)
  }

  if (fallbackExt && !fileNameExtension(name)) {
    name = `${name}.${fallbackExt}`
    try {
      name = normalizeFilesNodeName(name)
    } catch {
      return fallbackUntitled(fallbackExt)
    }
  }

  return name
}

export function joinSaveFilePath(folderPath: string, fileName: string): string {
  const folder = folderPath.trim().replace(/\/+$/, '') || '/'
  if (!parseFilesAbsolutePath(folder)) {
    throw new Error('无效的文件夹路径')
  }
  return joinFilesAbsolutePath(folder, fileName)
}

/** 对话框「存储」只拼路径，不创建文件。 */
export function buildSaveDialogPath(
  folderPath: string,
  fileName: string,
  defaultExtension?: string,
): string {
  return joinSaveFilePath(folderPath, sanitizeSaveFileName(fileName, defaultExtension))
}

function parentFolderPath(absolutePath: string, lastSegment: string): string {
  const suffix = `/${lastSegment}`
  if (absolutePath.endsWith(suffix)) {
    return absolutePath.slice(0, -suffix.length)
  }
  return absolutePath
}

/**
 * 把 initialPath 拆成「目录提示 + 可选文件名」。
 * 最后一段带扩展名时当作文件名，否则整段都是目录。
 */
export function splitSuggestedSavePath(path: string): { folderHint: string; fileName?: string } {
  const trimmed = path.trim().replace(/\/+$/, '') || '/'
  const parsed = parseFilesAbsolutePath(trimmed)
  if (!parsed || parsed.segments.length === 0) {
    return { folderHint: trimmed }
  }

  const last = parsed.segments[parsed.segments.length - 1]
  if (!last || !fileNameExtension(last)) {
    return { folderHint: trimmed }
  }

  return {
    folderHint: parentFolderPath(trimmed, last),
    fileName: last,
  }
}
