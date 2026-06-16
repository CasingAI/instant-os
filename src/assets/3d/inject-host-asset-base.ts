/** Blob URL + sandbox 无 allow-same-origin 时，文档 base 落在 blob 上，根路径无法解析；注入宿主 origin 作 base。 */
export function injectHostAssetBase(html: string, origin: string): string {
  if (!html.trim() || !origin) {
    return html
  }

  const baseTag = `<base href="${origin}/">`

  if (/<head[\s>]/i.test(html)) {
    return html.replace(/<head(\s[^>]*)?>/i, (match) => `${match}\n${baseTag}`)
  }

  if (/<html[\s>]/i.test(html)) {
    return html.replace(/<html(\s[^>]*)?>/i, (match) => `${match}\n<head>${baseTag}</head>`)
  }

  return `<head>${baseTag}</head>\n${html}`
}
