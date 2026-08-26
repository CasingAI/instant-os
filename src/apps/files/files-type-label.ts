import { fileNameExtension } from '../../os/file-open-registry.ts'
import { MUSIC_AUDIO_EXTENSIONS, MUSIC_LYRICS_EXTENSIONS } from '../music/music-storage.ts'
import { VSCODE_OPEN_EXTENSIONS } from '../vscode/vscode-open-extensions.ts'
import { isDiskImageFileName } from './files-disk-image-name.ts'
import type { FilesNodeKind } from './files-types.ts'

/** 应用包目录后缀（与 os/app-catalog 的 APP_BUNDLE_SUFFIX 一致） */
const APP_BUNDLE_SUFFIX = '.app'

const IMAGE_TYPE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'ico',
  'bmp',
  'tif',
  'tiff',
  'heic',
  'svg',
])
const AUDIO_TYPE_EXTENSIONS = new Set<string>(MUSIC_AUDIO_EXTENSIONS)
const LYRIC_TYPE_EXTENSIONS = new Set<string>(MUSIC_LYRICS_EXTENSIONS)
const VIDEO_TYPE_EXTENSIONS = new Set(['mp4', 'mov', 'webm', 'm4v', 'mkv', 'avi'])
const MODEL3D_TYPE_EXTENSIONS = new Set(['gltf', 'glb'])
const ARCHIVE_TYPE_EXTENSIONS = new Set(['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar'])
const WEBPAGE_TYPE_EXTENSIONS = new Set(['html', 'htm', 'xhtml'])
const MARKDOWN_TYPE_EXTENSIONS = new Set(['md', 'markdown', 'mdx'])
const DOCUMENT_TYPE_EXTENSIONS = new Set(['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv'])
const SOURCE_TYPE_EXTENSIONS = new Set<string>(VSCODE_OPEN_EXTENSIONS)

/**
 * 文件列表「类型」列标签：按节点种类与文件名归类为中文类别。
 * 纯函数，不依赖节点其余字段；无后缀或未识别返回「文件」。
 */
export function filesTypeLabel(kind: FilesNodeKind, name: string): string {
  if (kind === 'folder') {
    return name.endsWith(APP_BUNDLE_SUFFIX) ? '应用程序' : '文件夹'
  }
  if (kind === 'symlink') return '符号链接'
  if (isDiskImageFileName(name)) return '虚拟硬盘'

  const extension = fileNameExtension(name)
  if (extension === undefined) return '文件'
  if (IMAGE_TYPE_EXTENSIONS.has(extension)) return '图片'
  if (LYRIC_TYPE_EXTENSIONS.has(extension)) return '歌词'
  if (AUDIO_TYPE_EXTENSIONS.has(extension)) return '音频'
  if (VIDEO_TYPE_EXTENSIONS.has(extension)) return '视频'
  if (MODEL3D_TYPE_EXTENSIONS.has(extension)) return '3D 模型'
  if (extension === 'exe') return '可执行文件'
  if (ARCHIVE_TYPE_EXTENSIONS.has(extension)) return '压缩包'
  if (WEBPAGE_TYPE_EXTENSIONS.has(extension)) return '网页'
  if (extension === 'txt') return '文本'
  if (MARKDOWN_TYPE_EXTENSIONS.has(extension)) return 'Markdown'
  if (extension === 'pages') return '文稿'
  if (DOCUMENT_TYPE_EXTENSIONS.has(extension)) return '文档'
  if (SOURCE_TYPE_EXTENSIONS.has(extension)) return '源代码'
  return '文件'
}
