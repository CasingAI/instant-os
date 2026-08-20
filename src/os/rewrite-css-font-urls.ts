/** 把 CSS 里的 `/fonts/...` 改写成宿主绝对 URL，供跨 origin iframe 拉取。 */
export function rewriteCssFontUrls(css: string, hostOrigin: string): string {
  const origin = hostOrigin.replace(/\/+$/, '')
  return css.replace(/url\((['"]?)(\/fonts\/[^'")]+)\1\)/g, (_all, quote: string, path: string) => {
    const q = quote || "'"
    return `url(${q}${origin}${path}${q})`
  })
}
