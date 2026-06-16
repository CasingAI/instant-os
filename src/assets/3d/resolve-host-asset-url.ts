/** 将 /vendor、/assets 等根路径转为宿主页面绝对 URL（Blob 隔离 iframe 内 import map 与资源加载需要）。 */
export function resolveHostAssetUrl(path: string): string {
  if (!path.startsWith('/')) {
    throw new Error(`resolveHostAssetUrl expects root-relative path, got: ${path}`)
  }

  return `${window.location.origin}${path}`
}

export function getHostAssetOrigin(): string {
  return window.location.origin
}
