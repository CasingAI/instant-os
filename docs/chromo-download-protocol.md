# Chromo 下载协议

Instant OS 侧用 `proxiedFetch` 拉流写入 `/user/Downloads`。virtual-chromo（仓库外）只负责识别「这是下载」并上报元数据，**不传文件体**。`blob:` 仍由 iframe 读字节。

Worker 未升级时：管理页、右键「保存链接」、网络面板「保存到下载」仍可用；页内 `<a download>` / `Content-Disposition: attachment` 不会自动拦截。

## 职责划分

| 角色 | 做什么 | 不做什么 |
|------|--------|----------|
| Worker / inject.js | 识别下载意图；`VC_DOWNLOAD` 元数据；`VC_CLICK.download` | 不 `postMessage` http(s) 文件体；不把附件当文档导航 |
| Instant OS | 快照 Cookie；经代理拉流；写入 VFS；管理页与通知 | 不在 iframe 里 `fetch` http(s) 附件 |
| iframe | 仅 `blob:`（`evalInPage(fetch)` 分块读） | 不处理 `data:`（系统解码） |

## Instant OS → 代理：Cookie / Referer

浏览器禁止页面 `fetch()` 设置 `Cookie` / `Referer`。Instant OS **不得**把这两个名字放进 `Headers`。

改走自定义头，由 Worker 还原成上游请求头（与 SW 贴 Cookie 同一类通道）：

| Instant OS 请求头 | Worker 还原为上游 |
|-------------------|-------------------|
| `X-VC-Cookie` | `Cookie` |
| `X-VC-Referer` | `Referer` |

Worker 必须：

1. 从 Instant OS 来源的 CORS relay 请求读取上述两头。
2. 写到对 origin 的请求上。
3. **不要**把 `X-VC-*` 原样转给 origin。
4. 不要把 `Cookie` / `Referer` 当作禁止头丢掉之后又没有还原。

`X-VC-Cookie` 值为标准 Cookie 串：`name=value; name2=value2`。匹配规则与 `CookieJar.query` 一致（domain / path / secure / hostOnly），Instant OS 还会丢掉 `expires <= now`。本期不做 SameSite（跨站附件可能多带 Strict cookie）。

下载响应的 `Set-Cookie` **不**回写虚拟罐。

## Viewer → Instant OS

### `VC_CLICK`

现有字段外增加：

```ts
download?: boolean | string
```

- `true` 或 `""`：这是带 `download` 属性的链接，文件名从 URL / Disposition 推断。
- 非空字符串：`download` 属性值，作为建议文件名。

Instant OS 见到此字段会**取消** 150ms 整页 `VC_NAVIGATE`，并启动系统下载。随后若再来一条同 URL 的 `VC_DOWNLOAD`，在短窗口内去重。

### `VC_DOWNLOAD`（仅元数据）

```ts
{
  id: string
  url: string
  filename?: string
  mime?: string
  referrer?: string
  reason: 'content-disposition' | 'download-attr' | 'opaque-navigation' | 'blob' | 'data'
}
```

Worker 必须：

- 识别：`Content-Disposition: attachment`、`<a download>`、顶层导航到非 HTML opaque 类型、`blob:` / `data:` 下载。
- **不要**把该 URL 当文档：禁止随后对该次动作发 `VC_NAVIGATED` / `VC_LOAD_FAILED`。
- **不发 chunk。**

`blob:` URL 不得让 Instant OS 走 `normalizePageUrl`（会掉到 example.com）。Instant OS 在 iframe 内 `evalInPage(fetch)` 分块读字节。

`data:` 由 Instant OS 直接解码。

### 不再需要

`VC_DOWNLOAD_ACCEPT` / `VC_DOWNLOAD_CHUNK` / `VC_DOWNLOAD_FETCH` 这类文件体协议。不要实现。

## 导航策略

对下载意图：

1. 取消 150ms 延迟整页导航。
2. 不要 `VC_NAVIGATE` 该 URL。
3. 同 URL 的 `VC_LOCATION` 在下载开始后的短窗口内忽略（防止附件当页打开）。

右键「保存链接」不经过 Worker，Instant OS 直接拉流。
