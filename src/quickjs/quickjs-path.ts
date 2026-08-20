/** Node 风格 path.posix 子集（与 Instant VFS 正斜杠语义对齐）。 */

export type QuickJsPathParsed = {
  root: string
  dir: string
  base: string
  ext: string
  name: string
}

export type QuickJsPathApi = {
  sep: '/'
  delimiter: ':'
  basename: (path: string, suffix?: string) => string
  dirname: (path: string) => string
  extname: (path: string) => string
  format: (pathObject: Partial<QuickJsPathParsed>) => string
  isAbsolute: (path: string) => boolean
  join: (...paths: string[]) => string
  normalize: (path: string) => string
  parse: (path: string) => QuickJsPathParsed
  relative: (from: string, to: string) => string
  resolve: (...paths: string[]) => string
  posix: QuickJsPathApi
}

function toPathString(value: unknown, label: string): string {
  if (typeof value === 'string') {
    return value
  }
  if (
    value === undefined ||
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value)
  }
  throw new TypeError(`The "${label}" argument must be of type string. Received ${typeof value}`)
}

/** 折叠 `.` / `..`；绝对路径以 `/` 开头，相对路径不带前导 `/`。 */
function normalizeString(path: string, allowAboveRoot: boolean): string {
  const parts = path.split('/')
  const stack: string[] = []
  for (const part of parts) {
    if (!part || part === '.') {
      continue
    }
    if (part === '..') {
      if (stack.length > 0 && stack[stack.length - 1] !== '..') {
        stack.pop()
      } else if (allowAboveRoot) {
        stack.push('..')
      }
      continue
    }
    stack.push(part)
  }
  return stack.join('/')
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith('/')
}

export function createPosixPathApi(getCwd: () => string): QuickJsPathApi {
  const api = {} as QuickJsPathApi

  api.sep = '/'
  api.delimiter = ':'

  api.isAbsolute = (path) => isAbsolutePath(toPathString(path, 'path'))

  api.normalize = (pathInput) => {
    const path = toPathString(pathInput, 'path')
    if (path.length === 0) {
      return '.'
    }
    const absolute = isAbsolutePath(path)
    const trailingSlash = path.endsWith('/')
    let normalized = normalizeString(path, !absolute)
    if (normalized.length === 0) {
      normalized = absolute ? '/' : '.'
    } else if (absolute) {
      normalized = `/${normalized}`
    }
    if (trailingSlash && normalized !== '/') {
      normalized = `${normalized}/`
    }
    return normalized
  }

  api.join = (...paths) => {
    if (paths.length === 0) {
      return '.'
    }
    let joined = ''
    for (let i = 0; i < paths.length; i += 1) {
      const segment = toPathString(paths[i], 'paths')
      if (segment.length === 0) {
        continue
      }
      joined = joined.length === 0 ? segment : `${joined}/${segment}`
    }
    if (joined.length === 0) {
      return '.'
    }
    return api.normalize(joined)
  }

  api.resolve = (...paths) => {
    let resolvedPath = ''
    let resolvedAbsolute = false

    for (let i = paths.length - 1; i >= -1 && !resolvedAbsolute; i -= 1) {
      const path = i >= 0 ? toPathString(paths[i], 'paths') : getCwd()
      if (path.length === 0) {
        continue
      }
      resolvedPath = `${path}/${resolvedPath}`
      resolvedAbsolute = isAbsolutePath(path)
    }

    resolvedPath = normalizeString(resolvedPath, !resolvedAbsolute)
    if (resolvedAbsolute) {
      return resolvedPath.length > 0 ? `/${resolvedPath}` : '/'
    }
    return resolvedPath.length > 0 ? resolvedPath : '.'
  }

  api.dirname = (pathInput) => {
    const path = toPathString(pathInput, 'path')
    if (path.length === 0) {
      return '.'
    }
    const absolute = isAbsolutePath(path)
    const end = path.length - (path.endsWith('/') && path.length > 1 ? 1 : 0)
    const slice = path.slice(0, end)
    const lastSlash = slice.lastIndexOf('/')
    if (lastSlash === -1) {
      return absolute ? '/' : '.'
    }
    if (lastSlash === 0) {
      return '/'
    }
    return slice.slice(0, lastSlash)
  }

  api.basename = (pathInput, suffix) => {
    const path = toPathString(pathInput, 'path')
    let start = 0
    let end = path.length
    if (end > 1 && path.endsWith('/')) {
      end -= 1
    }
    const lastSlash = path.lastIndexOf('/', end - 1)
    if (lastSlash !== -1) {
      start = lastSlash + 1
    }
    let base = path.slice(start, end)
    if (suffix !== undefined) {
      const ext = toPathString(suffix, 'suffix')
      if (ext.length > 0 && base.endsWith(ext) && base !== ext) {
        base = base.slice(0, base.length - ext.length)
      }
    }
    return base
  }

  api.extname = (pathInput) => {
    const path = toPathString(pathInput, 'path')
    let startDot = -1
    let startPart = 0
    let end = -1
    let matchedSlash = true
    let preDotState = 0

    for (let i = path.length - 1; i >= 0; i -= 1) {
      const code = path.charCodeAt(i)
      if (code === 47 /* / */) {
        if (!matchedSlash) {
          startPart = i + 1
          break
        }
        continue
      }
      if (end === -1) {
        matchedSlash = false
        end = i + 1
      }
      if (code === 46 /* . */) {
        if (startDot === -1) {
          startDot = i
        } else if (preDotState !== 1) {
          preDotState = 1
        }
      } else if (startDot !== -1) {
        preDotState = -1
      }
    }

    if (
      startDot === -1 ||
      end === -1 ||
      preDotState === 0 ||
      (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)
    ) {
      return ''
    }
    return path.slice(startDot, end)
  }

  api.parse = (pathInput) => {
    const path = toPathString(pathInput, 'path')
    const absolute = isAbsolutePath(path)
    const root = absolute ? '/' : ''
    const base = api.basename(path)
    const dir = api.dirname(path)
    const ext = api.extname(base)
    const name = ext.length > 0 ? base.slice(0, base.length - ext.length) : base
    return {
      root,
      dir: dir === '.' && !absolute ? '' : dir,
      base,
      ext,
      name,
    }
  }

  api.format = (pathObject) => {
    if (pathObject === undefined || pathObject === null || typeof pathObject !== 'object') {
      throw new TypeError(
        `The "pathObject" argument must be of type object. Received ${typeof pathObject}`,
      )
    }
    const dir = pathObject.dir ?? pathObject.root ?? ''
    const base =
      pathObject.base ??
      `${pathObject.name ?? ''}${pathObject.ext ?? ''}`
    if (!dir) {
      return base
    }
    if (dir === pathObject.root) {
      return `${dir}${base}`
    }
    return `${dir}/${base}`
  }

  api.relative = (fromInput, toInput) => {
    const from = api.resolve(toPathString(fromInput, 'from'))
    const to = api.resolve(toPathString(toInput, 'to'))
    if (from === to) {
      return ''
    }

    const fromParts = from === '/' ? [] : from.slice(1).split('/')
    const toParts = to === '/' ? [] : to.slice(1).split('/')

    let common = 0
    const minLen = Math.min(fromParts.length, toParts.length)
    for (; common < minLen; common += 1) {
      if (fromParts[common] !== toParts[common]) {
        break
      }
    }

    const up = fromParts.length - common
    const result: string[] = []
    for (let i = 0; i < up; i += 1) {
      result.push('..')
    }
    for (let i = common; i < toParts.length; i += 1) {
      result.push(toParts[i]!)
    }
    return result.join('/')
  }

  api.posix = api
  return api
}
