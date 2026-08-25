/**
 * 版本文件夹按目录加载（第一期硬约束）。
 *
 * 一个版本文件夹就是网站根：入口 index.html 与页内相对引用（同目录脚本 / 样式 / 图片 /
 * 子目录文件）必须在这棵树里解析成功，且解析不得逃出该版本文件夹。桌面与 iCode 预览
 * 共用这一套：把树内资源重写为 data: URL、注入 fetch/XHR/DOM 资源映射 shim，再交给
 * 现有嵌套页加载（同源写入或 Blob 地址都成立）。无入口 → 空白页（不算崩溃）。
 *
 * 纯函数实现（不依赖 DOM），可单测。
 */

const SITE_DATA_URL_MAX_BYTES = 64 * 1024 * 1024

/** data: URL 映射表里单个文件的上限（避免动态映射重复内联超大文件） */
const FETCH_MAP_MAX_BYTES = 1024 * 1024

export function siteMimeForPath(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html'
  if (lower.endsWith('.css')) return 'text/css'
  if (lower.endsWith('.js') || lower.endsWith('.mjs')) return 'text/javascript'
  if (lower.endsWith('.json')) return 'application/json'
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.avif')) return 'image/avif'
  if (lower.endsWith('.bmp')) return 'image/bmp'
  if (lower.endsWith('.ico')) return 'image/x-icon'
  if (lower.endsWith('.woff')) return 'font/woff'
  if (lower.endsWith('.woff2')) return 'font/woff2'
  if (lower.endsWith('.ttf')) return 'font/ttf'
  if (lower.endsWith('.otf')) return 'font/otf'
  if (lower.endsWith('.mp3')) return 'audio/mpeg'
  if (lower.endsWith('.wav')) return 'audio/wav'
  if (lower.endsWith('.ogg')) return 'audio/ogg'
  if (lower.endsWith('.mp4')) return 'video/mp4'
  if (lower.endsWith('.webm')) return 'video/webm'
  if (lower.endsWith('.txt')) return 'text/plain'
  if (lower.endsWith('.xml')) return 'application/xml'
  if (lower.endsWith('.pdf')) return 'application/pdf'
  return 'application/octet-stream'
}

/** 规格化树内路径：处理 `.`/`..`；越出树根（逃逸）返回 undefined */
export function normalizeSitePath(segments: readonly string[]): string | undefined {
  const stack: string[] = []
  for (const segment of segments) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (stack.length === 0) return undefined
      stack.pop()
      continue
    }
    stack.push(segment)
  }
  return stack.join('/')
}

/**
 * 相对某文件解析引用。rootRelative（`/x`）从树根解析；其余相对引用文件所在目录。
 * 返回规格化树内路径；逃逸 / 无效返回 undefined。
 */
export function resolveSiteRef(referrerPath: string, rawRef: string): string | undefined {
  if (isExternalUrl(rawRef)) return undefined
  const cleaned = rawRef.split('#')[0]!.split('?')[0]!
  if (!cleaned) return undefined
  const base =
    cleaned.startsWith('/')
      ? []
      : referrerPath.split('/').slice(0, -1)
  return normalizeSitePath([...base, ...cleaned.split('/')])
}

function isExternalUrl(rawRef: string): boolean {
  return (
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(rawRef) ||
    rawRef.startsWith('//') ||
    rawRef.startsWith('#')
  )
}

function toDataUrl(bytes: Uint8Array, path: string): string {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return `data:${siteMimeForPath(path)};base64,${btoa(binary)}`
}

const HTML_URL_ATTRIBUTES: Record<string, readonly string[]> = {
  script: ['src'],
  img: ['src', 'srcset', 'data-src'],
  source: ['src', 'srcset'],
  video: ['src', 'poster'],
  audio: ['src'],
  iframe: ['src'],
  embed: ['src'],
  track: ['src'],
  input: ['src'],
  use: ['href'],
  image: ['href', 'xlink:href'],
  link: ['href'],
  a: ['href'],
  area: ['href'],
}

function buildFetchMapShimScript(
  fetchMap: Record<string, string>,
  entryPath: string,
): string {
  const payload = JSON.stringify({ dir: dirnameOf(entryPath), files: fetchMap })
  return `<script data-instant-site-shim="1">(function(){
'use strict';
var SITE = ${payload};
function dirname(p){var i=p.lastIndexOf('/');return i<=0?'':p.slice(0,i);}
function norm(parts){var s=[];for(var i=0;i<parts.length;i++){var p=parts[i];if(!p||p==='.')continue;if(p==='..'){if(s.length===0)return null;s.pop();continue;}s.push(p);}return s.join('/');}
function lookupPath(path){if(!path)return null;var v=SITE.files[path];return v||null;}
function resolveUrl(url){
  if(typeof url!=='string'||!url)return null;
  if(/^[a-zA-Z][a-zA-Z0-9+.\\-]*:/.test(url))return null;
  if(url.indexOf('//')===0)return null;
  if(url.charAt(0)==='#')return null;
  var clean=url.split('#')[0].split('?')[0];
  if(!clean)return null;
  var p;
  if(clean.charAt(0)==='/'){p=norm(clean.split('/'));}
  else{p=norm(SITE.dir?SITE.dir.split('/').concat(clean.split('/')):clean.split('/'));}
  return p?lookupPath(p):null;
}
function resolveSrcset(value){
  return value.split(',').map(function(candidate){
    var parts=candidate.trim().split(/\\s+/);
    if(parts.length===0||!parts[0])return candidate;
    var hit=resolveUrl(parts[0]);
    if(hit)parts[0]=hit;
    return parts.join(' ');
  }).join(', ');
}
function patchElement(el){
  if(!el||el.nodeType!==1)return;
  var tag=el.tagName&&el.tagName.toLowerCase();
  if(!tag)return;
  var attrs=tag==='img'?['src','srcset','data-src']:(tag==='source'?['src','srcset']:(tag==='video'?['src','poster']:((tag==='script'||tag==='iframe'||tag==='audio'||tag==='embed'||tag==='track'||tag==='input'||tag==='use')?['src']:((tag==='image'||tag==='link')?['href']:null))));
  if(!attrs)return;
  for(var i=0;i<attrs.length;i++){
    var name=attrs[i];
    var value=el.getAttribute(name);
    if(!value||value.indexOf('data:')===0)continue;
    if(name==='srcset'){el.setAttribute(name,resolveSrcset(value));continue;}
    var hit=resolveUrl(value);
    if(hit)el.setAttribute(name,hit);
  }
}
var origFetch=window.fetch?window.fetch.bind(window):null;
if(origFetch){
  window.fetch=function(input,init){
    var url=typeof input==='string'?input:(input&&input.url)?input.url:'';
    var hit=resolveUrl(url);
    if(hit)return origFetch(hit,init);
    return origFetch(input,init);
  };
}
var origOpen=XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open=function(method,url){
  var hit=resolveUrl(typeof url==='string'?url:String(url));
  if(hit)arguments[1]=hit;
  return origOpen.apply(this,arguments);
};
var observer=new MutationObserver(function(records){
  for(var i=0;i<records.length;i++){
    var record=records[i];
    if(record.type==='attributes'){patchElement(record.target);continue;}
    for(var j=0;j<record.addedNodes.length;j++){
      var node=record.addedNodes[j];
      patchElement(node);
      if(node.querySelectorAll){try{var list=node.querySelectorAll('[src],[href],[srcset],[poster]');for(var k=0;k<list.length;k++)patchElement(list[k]);}catch(e){}}
    }
  }
});
observer.observe(document,{'childList':true,'subtree':true,attributes:true,attributeFilter:['src','href','srcset','poster','data-src']});
(function sweepExisting(){
  try{var list=document.querySelectorAll('[src],[href],[srcset],[poster]');for(var k=0;k<list.length;k++)patchElement(list[k]);}catch(e){}
})();
})();</script>`
}

function dirnameOf(path: string): string {
  const index = path.lastIndexOf('/')
  return index <= 0 ? '' : path.slice(0, index)
}

type RewriteContext = {
  resources: Map<string, Uint8Array>
  processedPages: Map<string, string>
  fetchMap: Record<string, string>
  /** 覆盖资源查找（工程树 CSS 内联用；优先于 resources） */
  resolveOverride?: (path: string | undefined) => Uint8Array | undefined
}

function cssUrlReplacement(referrerPath: string, rawRef: string, context: RewriteContext): string | undefined {
  if (isExternalUrl(rawRef)) return undefined
  const resolved = resolveSiteRef(referrerPath, rawRef)
  if (resolved === undefined) return undefined
  const bytes = context.resolveOverride?.(resolved) ?? context.resources.get(resolved)
  if (bytes === undefined) return undefined
  return toDataUrl(bytes, resolved)
}

/** 重写 CSS 文本里的 url(...) 与 @import（相对该 CSS 文件解析） */
function rewriteCssText(css: string, referrerPath: string, context: RewriteContext): string {
  let output = css.replace(
    /url\(\s*(['"]?)([^'")]+)\1\s*\)/g,
    (match, _quote: string, rawRef: string) => {
      const hit = cssUrlReplacement(referrerPath, rawRef.trim(), context)
      return hit ? `url('${hit}')` : match
    },
  )
  output = output.replace(
    /@import\s+(?:url\(\s*)?(['"])([^'"]+)\1/g,
    (match, _quote: string, rawRef: string) => {
      const hit = cssUrlReplacement(referrerPath, rawRef.trim(), context)
      return hit ? `@import url('${hit}')` : match
    },
  )
  return output
}

/** 工程树（第四期）CSS 资源内联：把 url()/@import 按资源表解析为 data: URL */
export function inlineCssAssetRefs(params: {
  css: string
  referrerPath: string
  resolveBytes: (path: string | undefined) => Uint8Array | undefined
}): string {
  return rewriteCssText(params.css, params.referrerPath, {
    resources: new Map(),
    processedPages: new Map(),
    fetchMap: {},
    resolveOverride: params.resolveBytes,
  } as RewriteContext)
}

function rewriteSrcset(
  value: string,
  referrerPath: string,
  context: RewriteContext,
): string {
  return value
    .split(',')
    .map((candidate) => {
      const parts = candidate.trim().split(/\s+/)
      if (parts.length === 0 || !parts[0]) return candidate
      const hit = cssUrlReplacement(referrerPath, parts[0]!, context)
      if (hit) parts[0] = hit
      return parts.join(' ')
    })
    .join(', ')
}

function processPage(
  pagePath: string,
  html: string,
  context: RewriteContext,
  depth: number,
): string {
  const cached = context.processedPages.get(pagePath)
  if (cached !== undefined) return cached

  let rewritten = html.replace(
    /<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^"'>])*)>/g,
    (match, rawTag: string, rawAttrs: string) => {
      const tag = rawTag.toLowerCase()
      const urlAttrs = HTML_URL_ATTRIBUTES[tag]
      if (!urlAttrs && !/\sstyle=/i.test(rawAttrs)) return match
      let attrs = rawAttrs
      if (urlAttrs) {
        for (const attr of urlAttrs) {
          attrs = rewriteAttrInTag(attrs, tag, attr, pagePath, context)
        }
      }
      if (tag !== 'a' && tag !== 'area') {
        attrs = rewriteStyleAttrInTag(attrs, pagePath, context)
      }
      return `<${rawTag}${attrs}>`
    },
  )

  // <style> 块内的 url() / @import
  rewritten = rewritten.replace(
    /<style([^>]*)>([\s\S]*?)<\/style>/gi,
    (_match, attrs: string, body: string) => `<style${attrs}>${rewriteCssText(body, pagePath, context)}</style>`,
  )

  // shim 注入到 <head> 最前（早于一切资源加载与脚本执行）
  const shim = buildFetchMapShimScript(context.fetchMap, pagePath)
  if (/<head[^>]*>/i.test(rewritten)) {
    rewritten = rewritten.replace(/<head[^>]*>/i, (head) => `${head}${shim}`)
  } else if (/<html[^>]*>/i.test(rewritten)) {
    rewritten = rewritten.replace(/<html[^>]*>/i, (html) => `${html}<head>${shim}</head>`)
  } else {
    rewritten = `${shim}${rewritten}`
  }

  context.processedPages.set(pagePath, rewritten)
  void depth
  return rewritten
}

function rewriteAttrInTag(
  attrs: string,
  tag: string,
  attr: string,
  pagePath: string,
  context: RewriteContext,
): string {
  const patterns = [
    new RegExp(`\\s${attr}=(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'gi'),
  ]
  let output = attrs
  for (const pattern of patterns) {
    output = output.replace(pattern, (match, dq: string | undefined, sq: string | undefined, bare: string | undefined) => {
      const value = dq ?? sq ?? bare ?? ''
      if (!value || isExternalUrl(value)) return match
      if (attr === 'srcset') {
        return ` ${attr}="${rewriteSrcset(value, pagePath, context)}"`
      }
      const resolved = resolveSiteRef(pagePath, value)
      if (resolved === undefined) return match
      const bytes = context.resources.get(resolved)
      if (bytes === undefined) return match

      // 链接到树内其它页面：递归处理后以 data: URL 导航
      const lower = resolved.toLowerCase()
      if (
        (tag === 'a' || tag === 'area' || tag === 'iframe') &&
        (lower.endsWith('.html') || lower.endsWith('.htm'))
      ) {
        const pageHtml = processPage(resolved, decodeUtf8(bytes), context, 1)
        return ` ${attr}="${toDataUrl(new TextEncoder().encode(pageHtml), resolved)}"`
      }
      // link rel=stylesheet：重写 CSS 内部引用后作为内联样式表提供
      if (tag === 'link' && lower.endsWith('.css')) {
        const css = rewriteCssText(decodeUtf8(bytes), resolved, context)
        return ` ${attr}="${toDataUrl(new TextEncoder().encode(css), resolved)}"`
      }
      return ` ${attr}="${toDataUrl(bytes, resolved)}"`
    })
  }
  return output
}

function rewriteStyleAttrInTag(
  attrs: string,
  pagePath: string,
  context: RewriteContext,
): string {
  return attrs.replace(
    /\sstyle=(?:"([^"]*)"|'([^']*)')/gi,
    (match, dq: string | undefined, sq: string | undefined) => {
      const value = dq ?? sq ?? ''
      const rewritten = rewriteCssText(value, pagePath, context)
      return rewritten === value ? match : ` style="${rewritten.replace(/"/g, '&quot;')}"`
    },
  )
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

/**
 * 把一棵版本树收成一份可交给嵌套页加载的入口 HTML。
 * 返回 undefined 表示没有入口（调用方显示空白页，不算崩溃）。
 */
export function buildSiteDocument(params: {
  entryPath?: string
  resources: Map<string, Uint8Array>
}): string | undefined {
  const entryPath = params.entryPath ?? 'index.html'
  const entryBytes = params.resources.get(entryPath)
  if (entryBytes === undefined) return undefined
  if (entryBytes.byteLength > SITE_DATA_URL_MAX_BYTES) return undefined

  const fetchMap: Record<string, string> = {}
  for (const [path, bytes] of params.resources) {
    if (bytes.byteLength > FETCH_MAP_MAX_BYTES) continue
    if (path.toLowerCase().endsWith('.html') || path.toLowerCase().endsWith('.htm')) continue
    fetchMap[path] = toDataUrl(bytes, path)
  }

  const context: RewriteContext = {
    resources: params.resources,
    processedPages: new Map(),
    fetchMap,
  }
  return processPage(entryPath, decodeUtf8(entryBytes), context, 0)
}

/** 无入口时的空白页（桥仍可注入，不算崩溃） */
export const EMPTY_SITE_DOCUMENT =
  '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body></body></html>'
