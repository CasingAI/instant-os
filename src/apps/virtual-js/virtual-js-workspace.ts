import {
  filesCreateText,
  filesMkdir,
  filesReadText,
  filesStat,
  filesWriteText,
} from '../files/files-api.ts'

/** Virtual JS 演示多文件项目目录（落在默认 workspaceRoot `/user` 下）。 */
export const VIRTUAL_JS_DEMO_DIR = '/user/virtual-js-demo'
export const VIRTUAL_JS_DEMO_ENTRY = `${VIRTUAL_JS_DEMO_DIR}/main.js`
export const VIRTUAL_JS_DEMO_LIB = `${VIRTUAL_JS_DEMO_DIR}/lib.js`

const DEMO_LIB_SOURCE = `export function greet(name) {
  return 'hello, ' + name
}
`

const DEMO_MAIN_SOURCE = `import { greet } from './lib.js'

const message = greet('workspace')
console.log(message)
console.log('entry ok')
export default message
`

export function virtualJsFileBasename(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const slash = trimmed.lastIndexOf('/')
  if (slash < 0) {
    return trimmed
  }
  return trimmed.slice(slash + 1) || trimmed
}

async function ensureDirectory(path: string): Promise<void> {
  const existing = await filesStat(path)
  if (existing !== undefined) {
    if (existing.kind !== 'folder') {
      throw new Error(`路径已存在且不是文件夹: ${path}`)
    }
    return
  }
  await filesMkdir(path)
}

async function writeTextCreateOrOverwrite(path: string, text: string): Promise<void> {
  const existing = await filesStat(path)
  if (existing === undefined) {
    await filesCreateText(path, text)
    return
  }
  if (existing.kind !== 'file') {
    throw new Error(`路径已存在且不是文件: ${path}`)
  }
  await filesWriteText(path, text)
}

/**
 * 写入（或覆盖）演示入口与相对依赖，返回入口绝对路径。
 * 供「打开演示入口」一键体验 L1.13 多文件相对 import。
 */
export async function seedVirtualJsDemoProject(): Promise<string> {
  await ensureDirectory(VIRTUAL_JS_DEMO_DIR)
  await writeTextCreateOrOverwrite(VIRTUAL_JS_DEMO_LIB, DEMO_LIB_SOURCE)
  await writeTextCreateOrOverwrite(VIRTUAL_JS_DEMO_ENTRY, DEMO_MAIN_SOURCE)
  return VIRTUAL_JS_DEMO_ENTRY
}

export async function readVirtualJsWorkspaceFile(path: string): Promise<string> {
  return filesReadText(path)
}

export async function saveVirtualJsWorkspaceFile(path: string, text: string): Promise<void> {
  const existing = await filesStat(path)
  if (existing === undefined) {
    await filesCreateText(path, text)
    return
  }
  if (existing.kind !== 'file') {
    throw new Error(`不能保存到非文件路径: ${path}`)
  }
  await filesWriteText(path, text)
}
