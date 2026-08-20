import { joinFilesAbsolutePath, normalizeFilesNodeName } from '../files/files-path.ts'
import { fileNameExtension } from '../../os/file-open-registry.ts'
import { sanitizeSaveFileName } from '../../window/system-save-path.ts'
import { proxiedFetch } from '../../os/proxy-server-api.ts'
import {
  filesMkdir,
  filesOpenStreamWrite,
  filesStat,
} from '../files/files-api.ts'

export const CHROMO_SAVE_PAGE_MAX_RESOURCE_BYTES = 8 * 1024 * 1024
export const CHROMO_SAVE_PAGE_MAX_TOTAL_BYTES = 64 * 1024 * 1024

export type ChromoPageResource = {
  url: string
  original?: string
}

export type ChromoPageSerializeResult = {
  title: string
  url: string
  html: string
  resources: ChromoPageResource[]
}

export type ChromoSavePageSummary = {
  htmlPath: string
  filesDir?: string
  saved: number
  skipped: number
  failed: number
}

const FORBIDDEN_NAME = /[/\\:\u0000-\u001f\u007f]/g

export function suggestedSaveNameFromUrl(url: string, fallback: string, defaultExtension?: string): string {
  let raw = fallback
  try {
    const parsed = new URL(url)
    const last = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '')
    if (last) {
      raw = last
    }
  } catch {
    // keep fallback
  }
  return sanitizeSaveFileName(raw, defaultExtension)
}

export function sanitizePageFileBaseName(title: string, fallback = 'page'): string {
  let name = title.trim().replace(FORBIDDEN_NAME, '_').replace(/\s+/g, ' ')
  name = name.replace(/\.+$/g, '').trim()
  if (!name) {
    name = fallback
  }
  if (name.length > 80) {
    name = name.slice(0, 80).trim()
  }
  try {
    return normalizeFilesNodeName(name)
  } catch {
    return fallback
  }
}

export function resourceFileNameFromUrl(url: string, used: Set<string>): string {
  let base = 'asset.bin'
  try {
    const parsed = new URL(url, 'https://example.invalid')
    const last = parsed.pathname.split('/').filter(Boolean).pop() || ''
    const decoded = decodeURIComponent(last)
    if (decoded) {
      base = decoded.replace(/[^\w.\-+()]+/g, '_')
    }
  } catch {
    // keep default
  }

  if (!base || base === '.' || base === '..') {
    base = 'asset.bin'
  }
  if (!fileNameExtension(base)) {
    base = `${base}.bin`
  }

  let candidate = base
  let n = 2
  while (used.has(candidate.toLowerCase())) {
    const dot = base.lastIndexOf('.')
    const stem = dot > 0 ? base.slice(0, dot) : base
    const ext = dot > 0 ? base.slice(dot) : ''
    candidate = `${stem}-${n}${ext}`
    n += 1
  }
  used.add(candidate.toLowerCase())
  return candidate
}

export function rewriteHtmlResourceUrls(
  html: string,
  mapping: ReadonlyArray<{ url: string; relative: string; original?: string }>,
): string {
  const tokens: Array<{ from: string; to: string }> = []
  const seenFrom = new Set<string>()
  const add = (from: string | undefined, to: string) => {
    if (!from || seenFrom.has(from)) return
    seenFrom.add(from)
    tokens.push({ from, to })
  }
  for (const item of mapping) {
    add(item.url, item.relative)
    if (item.original && item.original !== item.url) {
      add(item.original, item.relative)
    }
  }
  tokens.sort((a, b) => b.from.length - a.from.length)

  let out = html
  const placeholders: Array<{ token: string; to: string }> = []
  for (let i = 0; i < tokens.length; i++) {
    const item = tokens[i]!
    if (!out.includes(item.from)) continue
    const token = `\u0000CHROMORES${i}\u0000`
    out = out.split(item.from).join(token)
    placeholders.push({ token, to: item.to })
  }
  for (const item of placeholders) {
    out = out.split(item.token).join(item.to)
  }
  return out
}

export function canAcceptChromoSaveResource(
  byteLength: number,
  totalBytes: number,
  maxResource = CHROMO_SAVE_PAGE_MAX_RESOURCE_BYTES,
  maxTotal = CHROMO_SAVE_PAGE_MAX_TOTAL_BYTES,
): boolean {
  return byteLength <= maxResource && totalBytes + byteLength <= maxTotal
}

export function parsePageSerializeResult(value: unknown): ChromoPageSerializeResult {
  if (!value || typeof value !== 'object') {
    throw new Error('无法读取页面 HTML')
  }
  const record = value as Record<string, unknown>
  const html = typeof record.html === 'string' ? record.html : ''
  if (!html.trim()) {
    throw new Error('页面 HTML 为空')
  }
  const resources = Array.isArray(record.resources)
    ? record.resources
        .map(parsePageResource)
        .filter((item): item is ChromoPageResource => item !== undefined)
    : []
  return {
    title: typeof record.title === 'string' ? record.title : '',
    url: typeof record.url === 'string' ? record.url : '',
    html,
    resources: uniqueResources(resources),
  }
}

function parsePageResource(item: unknown): ChromoPageResource | undefined {
  if (typeof item === 'string') {
    const url = item.trim()
    return url ? { url } : undefined
  }
  if (!item || typeof item !== 'object') {
    return undefined
  }
  const record = item as Record<string, unknown>
  const url = typeof record.url === 'string' ? record.url.trim() : ''
  if (!url) {
    return undefined
  }
  const original =
    typeof record.original === 'string' && record.original.trim() && record.original.trim() !== url
      ? record.original.trim()
      : undefined
  return original ? { url, original } : { url }
}

function uniqueResources(resources: ChromoPageResource[]): ChromoPageResource[] {
  const seen = new Set<string>()
  const out: ChromoPageResource[] = []
  for (const resource of resources) {
    if (!resource.url || seen.has(resource.url)) continue
    seen.add(resource.url)
    out.push(resource)
  }
  return out
}

export const CHROMO_SERIALIZE_PAGE_SCRIPT = `(function () {
  var urls = [];
  var seen = {};

  function add(raw) {
    if (!raw) return;
    var original = String(raw);
    var abs = original;
    try { abs = new URL(raw, document.baseURI).href; } catch (e) {}
    if (!abs || seen[abs]) return;
    seen[abs] = 1;
    urls.push({ url: abs, original: original === abs ? undefined : original });
  }

  function collectFromElement(el) {
    if (!el || el.nodeType !== 1) return;
    var tag = el.tagName;
    if (tag === 'IMG' || tag === 'SCRIPT' || tag === 'SOURCE' || tag === 'VIDEO' || tag === 'AUDIO' || tag === 'TRACK' || tag === 'EMBED' || tag === 'IFRAME') {
      add(el.getAttribute('src'));
      add(el.getAttribute('data-src'));
      add(el.currentSrc);
    }
    if (tag === 'LINK') {
      var rel = String(el.getAttribute('rel') || '').toLowerCase();
      if (rel.indexOf('stylesheet') !== -1 || rel === 'icon' || rel === 'shortcut icon' || rel === 'apple-touch-icon') {
        add(el.getAttribute('href'));
      }
    }
    if (tag === 'IMAGE') {
      add(el.getAttribute('href') || el.getAttribute('xlink:href'));
    }
    var srcset = el.getAttribute('srcset');
    if (srcset) {
      String(srcset).split(',').forEach(function (part) {
        var piece = part.trim().split(/\\s+/)[0];
        add(piece);
      });
    }
    var poster = el.getAttribute('poster');
    if (poster) add(poster);
    var style = el.getAttribute('style');
    if (style) {
      var re = /url\\((['"]?)([^'")]+)\\1\\)/gi;
      var m;
      while ((m = re.exec(style))) add(m[2]);
    }
  }

  var all = document.querySelectorAll('*');
  for (var i = 0; i < all.length; i++) collectFromElement(all[i]);

  try {
    var sheets = document.styleSheets;
    for (var s = 0; s < sheets.length; s++) {
      var sheet = sheets[s];
      try {
        if (sheet.href) add(sheet.href);
        var rules = sheet.cssRules;
        if (!rules) continue;
        for (var r = 0; r < rules.length; r++) {
          var css = String(rules[r].cssText || '');
          var re2 = /url\\((['"]?)([^'")]+)\\1\\)/gi;
          var m2;
          while ((m2 = re2.exec(css))) add(m2[2]);
        }
      } catch (err) {}
    }
  } catch (err2) {}

  var html = '';
  try {
    html = '<!DOCTYPE html>\\n' + document.documentElement.outerHTML;
  } catch (err3) {
    html = document.documentElement ? document.documentElement.outerHTML : '';
  }

  return {
    title: document.title || '',
    url: String(location.href || ''),
    html: html,
    resources: urls
  };
})()`

function parentDir(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const index = trimmed.lastIndexOf('/')
  return index <= 0 ? '/' : trimmed.slice(0, index)
}

function replaceFileName(path: string, name: string): string {
  return joinFilesAbsolutePath(parentDir(path), name)
}

export async function writeUniqueFile(
  path: string,
  bytes: Uint8Array,
  mimeType?: string,
): Promise<string> {
  const writer = await filesOpenStreamWrite(path, { nameMode: 'unique-suffix' })
  try {
    await writer.write(bytes)
    const node = await writer.close()
    void mimeType
    return replaceFileName(path, node.name)
  } catch (error) {
    await writer.abort().catch(() => undefined)
    throw error
  }
}

async function ensureFolder(path: string): Promise<string> {
  const existing = await filesStat(path)
  if (!existing) {
    const created = await filesMkdir(path)
    return created.path
  }
  if (existing.kind !== 'folder') {
    throw new Error(`无法创建资源目录：${path} 已存在且不是文件夹`)
  }
  return existing.path
}

export async function saveSerializedPageToPath(
  htmlPath: string,
  serialized: ChromoPageSerializeResult,
  fetchResource: (url: string) => Promise<Uint8Array> = fetchResourceBytes,
): Promise<ChromoSavePageSummary> {
  const used = new Set<string>()
  const mapping: Array<{ url: string; original?: string; relative: string; fileName: string }> = []
  let totalBytes = 0
  let skipped = 0
  let failed = 0
  const bodies = new Map<string, Uint8Array>()

  for (const resource of serialized.resources) {
    const url = resource.url
    if (url.startsWith('javascript:') || url.startsWith('data:text/html')) {
      skipped += 1
      continue
    }
    try {
      const bytes = await fetchResource(url)
      if (!canAcceptChromoSaveResource(bytes.byteLength, totalBytes)) {
        skipped += 1
        continue
      }
      const fileName = resourceFileNameFromUrl(url, used)
      bodies.set(fileName, bytes)
      totalBytes += bytes.byteLength
      mapping.push({ url, original: resource.original, relative: '', fileName })
    } catch {
      failed += 1
    }
  }

  const htmlBytes = new TextEncoder().encode(serialized.html)
  const writtenHtmlPath = await writeUniqueFile(htmlPath, htmlBytes, 'text/html')
  const htmlName = writtenHtmlPath.slice(writtenHtmlPath.lastIndexOf('/') + 1)
  const base = htmlName.replace(/\.html?$/i, '') || 'page'
  const folderHint = joinFilesAbsolutePath(parentDir(writtenHtmlPath), `${base}_files`)

  if (mapping.length === 0) {
    return { htmlPath: writtenHtmlPath, saved: 0, skipped, failed }
  }

  const filesDir = await ensureFolder(folderHint)
  const folderName = filesDir.slice(filesDir.lastIndexOf('/') + 1)
  const rewrittenMapping = mapping.map((item) => ({
    url: item.url,
    original: item.original,
    relative: `${folderName}/${item.fileName}`,
  }))
  const rewrittenHtml = rewriteHtmlResourceUrls(serialized.html, rewrittenMapping)
  const htmlWriter = await filesOpenStreamWrite(writtenHtmlPath)
  try {
    await htmlWriter.write(new TextEncoder().encode(rewrittenHtml))
    await htmlWriter.close()
  } catch (error) {
    await htmlWriter.abort().catch(() => undefined)
    throw error
  }

  let saved = 0
  for (const item of mapping) {
    const bytes = bodies.get(item.fileName)
    if (!bytes) continue
    try {
      await writeUniqueFile(joinFilesAbsolutePath(filesDir, item.fileName), bytes)
      saved += 1
    } catch {
      failed += 1
    }
  }

  return { htmlPath: writtenHtmlPath, filesDir, saved, skipped, failed }
}

async function fetchResourceBytes(url: string): Promise<Uint8Array> {
  if (url.startsWith('data:')) {
    return dataUrlToBytes(url)
  }
  const response = await proxiedFetch(url)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  const buffer = await response.arrayBuffer()
  return new Uint8Array(buffer)
}

function dataUrlToBytes(url: string): Uint8Array {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(url)
  if (!match) {
    throw new Error('无效的 data URL')
  }
  const payload = match[3] ?? ''
  if (match[2]) {
    const binary = atob(payload)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  }
  return new TextEncoder().encode(decodeURIComponent(payload))
}

export async function saveImageUrlToPath(
  destPath: string,
  imageUrl: string,
  evalInPage?: (code: string) => Promise<unknown>,
): Promise<string> {
  if (imageUrl.startsWith('blob:') || imageUrl.startsWith('data:')) {
    if (imageUrl.startsWith('data:')) {
      const bytes = dataUrlToBytes(imageUrl)
      return writeUniqueFile(destPath, bytes)
    }
    if (!evalInPage) {
      throw new Error('无法读取页内 blob 图片')
    }
    const value = await evalInPage(buildReadImageEval(imageUrl))
    if (!value || typeof value !== 'object') {
      throw new Error('无法读取图片数据')
    }
    const record = value as { ok?: boolean; base64?: string; error?: string }
    if (!record.ok || typeof record.base64 !== 'string') {
      throw new Error(record.error || '无法读取图片数据')
    }
    const binary = atob(record.base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return writeUniqueFile(destPath, bytes)
  }

  const bytes = await fetchResourceBytes(imageUrl)
  return writeUniqueFile(destPath, bytes)
}

function buildReadImageEval(url: string): string {
  return `(function () {
    var url = ${JSON.stringify(url)};
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.arrayBuffer();
    }).then(function (buf) {
      var bytes = new Uint8Array(buf);
      var bin = '';
      for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return { ok: true, base64: btoa(bin) };
    }).catch(function (err) {
      return { ok: false, error: err && err.message ? String(err.message) : String(err) };
    });
  })()`
}

export function formatSavePageSummary(summary: ChromoSavePageSummary): string {
  const parts = [`已保存 ${summary.htmlPath}`]
  if (summary.filesDir) {
    parts.push(`资源目录 ${summary.filesDir}（${summary.saved} 个文件）`)
  }
  if (summary.skipped > 0) {
    parts.push(`跳过 ${summary.skipped} 个过大或受限资源`)
  }
  if (summary.failed > 0) {
    parts.push(`${summary.failed} 个资源下载失败，已保留原地址`)
  }
  return parts.join('。')
}
