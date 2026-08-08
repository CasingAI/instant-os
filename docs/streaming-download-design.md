# 终端流式下载设计（Streaming Download）

> 目标：让 AI 在终端里能把网上的大文件**边下边存**到虚拟文件系统，内存占用与文件大小解耦，并在下载过程中按大小上限提前拦截、保留撤销能力。
>
> 状态：**Phase 1-2 已完成，Phase 3 待实施**。本文记录设计与决策，实现已落地。
>
> 已定决策：**不加新壳层命令**，走客侧流式 API（`fetch` 带 `body` 流 + `fs.createWriteStream` 真增量写），与 Node 生态习惯一致、可组合。

---

## 1. 背景与现状

AI 操作真终端（instant-shell / QuickJS）下载 URL 二进制的现有链路：

```
fetch(url)                 → 宿主一次 response.arrayBuffer()，整段入宿主内存
                           → 整段拷贝进客侧 Buffer（hostBytesToGuestBuffer）
fs.writeFile(path, buf)    → 整块回传宿主
                           → 存储层 COW 整块写入 IndexedDB
```

**问题**

1. **内存 O(文件大小)**，且同一时刻存在 2~3 份完整副本（`quickjs-fetch.ts:211-232` 的 arrayBuffer + 拷贝 + 客侧 Buffer）。4 GiB 上限的文件峰值内存可达数 GiB。
2. **大小上限下载完才校验**：`readResponseBodyLimited`（`quickjs-fetch.ts:211-219`）先 `arrayBuffer()` 再比对 `maxFileBytes`，超限会整段白下载。
3. **无进度、无中断**：下载期间用户看不到任何进度，无法提前取消。
4. **`fs.createWriteStream` 是假流**：客侧 chunk 全攒在宿主内存，`close()` 才合并整块写盘（`quickjs-fs.ts:467-509`）；`fs.appendFile` 也是读-合并-全写（`quickjs-fs-vfs.ts:393-447`）。

**勘察确认的事实（现状依据）**

| 项 | 现状 | 依据 |
|----|------|------|
| 宿主 fetch 响应体 | `proxiedFetch` 返回**未消费 body** 的真实 `Response`，`response.body` 是 ReadableStream | `src/os/proxy-server-api.ts:119-183` |
| 网络层是否已可流式 | **恒可流式**：浏览器 `fetch().body` 按到达顺序增量投递，与服务器/代理是否缓冲无关。对端缓冲只影响首字节时机与对端自身内存（§7），不影响我们分块读 | 浏览器 Fetch 规范保证 |
| 内部卷（`/user` `/dev` `/tmp`）存储 | IDB 单条整块 blob 记录 `{ id, bytes, refCount }`，无部分写 | `src/apps/files/files-storage.ts:55,467-726` |
| COW 语义 | 写 = 整块新 blob；shared（refCount>1）时换新 id 并递减旧引用，否则原地替换 | `files-storage.ts:660-726` |
| 配额 | 写前按整文件 `assertCapacity`，全局 `byte-total` 上限 4 GiB | `files-storage.ts:390`、`src/os/device-data-storage.ts:5` |
| 挂载卷（`/mount`） | 走 File System Access API，`createWritable()` 的 `writable.write(chunk)` **原生支持分块写** | `src/apps/files/files-location-mount.ts:412-425` |
| 客侧 fetch Response | 只有 `arrayBuffer()/text()/json()/bytes()`，**无 `body` 流** | `src/quickjs/quickjs-fetch.ts:272-339` |
| 客侧 fs | 已有 `createReadStream / createWriteStream` API 面，但宿主侧是假流（攒块合并写） | `src/quickjs/quickjs-fs.ts:454-509,583-690` |
| 撤销（受控模式 journal） | 每 path 首次改动前存 before blob，回合结束产出 ChangeSet；`added` 不存 before | `src/terminal/terminal-changeset-journal.ts:63-199` |
| 文件读取 | 读仍是整文件读入（有 `maxFileBytes` 单文件上限） | `files-storage.ts:446` |

---

## 2. 目标与非目标

**目标**

- **边下边存**：写入按 chunk 落盘，峰值内存 O(chunk) 而非 O(file)。
- **下载中增量拦截**：超 `maxFileBytes` 提前终止并清理，不白下载。
- **能力完整**：保留只读卷门禁、配额核算、受控模式撤销/ChangeSet、代理指标。
- **API 自然、可组合**：不加新命令。AI 用 Node 习惯写法——
  `await pipeline(fetch(url).body, fs.createWriteStream(dest))`；
  下载后的处理（读、解压、grep）可自由组合。

**非目标（本期不做）**

- 断点续传 / 下载队列管理。
- 读取路径的性能（整读仍有上限与内存峰值，属另一项优化）。
- 代理服务器（Cloudflare Worker，即 virtual-chromo Worker）的代码在仓库外，不在本期改造范围；仅记录其缓冲行为对收益与成功率的影响。

---

## 3. 总体架构

三层改动，存储层是地基、客侧流式 API 是上层：

```
┌─ 网络层（改动小）──────────────────────────────┐
│ proxiedFetch → 分块喂给客侧 ReadableStream       │
│ （保留代理指标；content-length 仅作预估）        │
└──────────────────────────────┬───────────────────┘
                               │ chunk 流
┌─ 客侧流式 API（改动中，核心新增）─────────────┐
│ fetch.Response.body = ReadableStream            │
│ fs.createWriteStream 宿主侧真增量落盘           │
└──────────────────────────────┬───────────────────┘
                               │ chunk 写
┌─ 存储层（核心，改动大）────────────────────────┐
│ 分块 blob 记录（IDB 内部卷）                    │
│ 复用原生流式写（/mount 挂载卷）                 │
└──────────────────────────────────────────────────┘
```

数据流：

```
客侧: const res = await fetch(url)          // Response.body = ReadableStream
      await pipeline(res.body, fs.createWriteStream(dest))
宿主: res.body 逐 chunk 递入客侧流 → createWriteStream 逐 chunk
      → 每 chunk：配额增量预占 → 增量写盘 → （可选）进度回调
      → close：finalize（节点 blobId 切换 / 引用计数整理）
      → 失败/取消/超限：清理已写 chunk，恢复原状
```

---

## 4. 设计决策

### D1 · 网络层：复用 `proxiedFetch`，分块喂客侧

- `proxiedFetch` 已返回未消费的 `Response`（`proxy-server-api.ts:148-164`），**不改**。
- 宿主侧改为 `response.body.getReader()` 循环读 chunk（默认 64 KiB），逐块递入客侧 ReadableStream，不再 `arrayBuffer()` 整段。
- `quickjs-fetch.ts` 的 `injectFetch` 改造：响应到达后**先返回一个带 `body` 流的 Response 壳**，宿主在客侧消费 `body` 时才真正拉取并分块传输（拉取时机可推迟到 pipe 时）。
- 代理指标：`downloadBytes` 目前取 `content-length`（`proxy-server-api.ts:104-113`，不读 body 是对的）；流式下载时改为**按实际累计字节**记录，可选新增 `streamed: true` 标记。
- **读流不依赖对端行为**：`response.body` 恒为 ReadableStream，浏览器按到达顺序增量投递——无论代理服务器（Cloudflare Worker）是流式转发还是整段缓冲，我们的分块读实现都一样，**不做分支、不做降级**。

### D2 · 存储层（核心）：分块 blob 记录

**为什么现有 IDB 模型不行**：`FILES_BLOBS_STORE` 的 value 是整块 ArrayBuffer，IDB `put` 是整条替换，没有"往文件中间/末尾接着写一段"的原语。`appendFile` 的读-合并-全写是 O(n) 且每步内存 O(n)。

**方案**：把 blob 内容从"单条整块记录"改为"元数据 + 分块记录"：

```
现状
  FILES_BLOBS_STORE   { id, bytes: ArrayBuffer, refCount }

目标
  FILES_BLOBS_STORE   { id, refCount, byteSize, chunkCount }        // 仅元数据
  FILES_CHUNKS_STORE  { blobId, chunkIndex, bytes }                 // keyPath ['blobId','chunkIndex']
```

- **流式写 = 逐块 `put` chunk**：每个 chunk 独立事务（或按批提交），每次只写 O(chunk)。
- **finalize（close）**：写入节点记录的 `blobId` 指向新 blob 元数据；COW 引用计数在 finalize 时整理（shared → 换新 id + 递减旧 blob；非 shared → 删旧 blob），复用现有 `writeFileContentCow` 的引用逻辑（`files-storage.ts:660-726`）。
- **读取**：先读 blob 元数据，chunkCount=1 且走旧格式时兼容旧数据；新格式按 chunkIndex 顺序读出拼接。
- **迁移**：**惰性迁移**，不一次性重写。旧 blob 记录没有 chunk 记录 → 按旧格式读；首次整块改写时自然转为新格式。避免大库全量迁移。
- **配额**：chunk 落盘时按 chunk 字节增量更新 `byte-total`（流式开始前只预占少量元数据额度）；abort/失败时回退已占额度。

**挂载卷**：`/mount` 复用 File System Access API 的 `FileSystemWritableFileStream`（`files-location-mount.ts:412-425` 现为一次性 `write(bytes)` + `close()`，改为逐 chunk `write()`）。挂载卷**不需要**分块 blob 记录，天然流式。

### D3 · 客侧流式 API（主路径，不加新命令）

**3a · `Response.body`（ReadableStream）**

- 客侧 `fetch` 的 `Response` 增加 `body` 属性，类型为 ReadableStream。
- QuickJS 需要最小可用的 **ReadableStream 客侧实现**：`getReader()` / `read()` / `cancel()`，足够支撑 `pipeline`（`stream` 模块已注入，见 `quickjs-fs.ts:59`）。
- 宿主侧 `injectFetch` 的响应壳与客侧流之间是"拉取式"桥：客侧 `read()` 一次，宿主从 `response.body.getReader()` 取一块递入；客侧不读则宿主不拉（背压天然成立）。
- 现有的 `arrayBuffer()/text()/json()/bytes()` 行为不变（内部经 body 流消费一次，`bodyUsed` 语义保留）。

**3b · `fs.createWriteStream` 真增量落盘**

- 宿主侧 `openWrite/writeChunk/closeWrite`（`quickjs-fs.ts:454-509`）从"攒 chunk → close 合并整块写"改为**每 chunk 调存储层流式写基元增量落盘**。
- `maxFileBytes` 在写流打开时确定，`writeChunk` 每块累计并提前拦截（`quickjs-fs.ts:475-481` 现有检查保留，但不再等 close）。
- 受控模式：写流打开时 `noteWrite(destPath)` 一次（`added` 或 `modified` + before blob），ChangeSet 只有一条 entry，撤销天然可用（`terminal-changeset-journal.ts:117-124`）。
- 失败/取消：`destroy()`/`abort()` 调存储层 abort（清理已写 chunk、回退配额、回滚到初始状态）。

**3c · 组合示例（AI 视角）**

```js
const { pipeline } = require('stream')
const res = await fetch('https://example.com/big.bin')
if (!res.ok) throw new Error(`HTTP ${res.status}`)
await pipeline(res.body, fs.createWriteStream('/user/downloads/big.bin'))
```

下载后继续自由组合：`fs.createReadStream(...)` 读、`instant.grep` 搜、解压等。

### D4 · 语义层：配额 / 撤销 / 中断

| 关注点 | 设计 |
|--------|------|
| 配额 | chunk 级增量预占与回退；`assertCapacity` 保持为最终硬约束 |
| 撤销 | 单次逻辑写 = journal 单条 entry；`before` 仍是整文件（原文件已存在，代价可接受） |
| 中断 | `ReadableStream.cancel()` / `WriteStream.destroy()` → 停止读取 → 清理已写 chunk + 回退配额 + 回滚到初始状态 |
| 超限 | 写流中实时累计，超 `maxFileBytes` 立即终止（`ERR_FS_FILE_TOO_LARGE`），不留残留 |
| 只读卷 | 沿用现有写入门禁（`/system` `/models` 拒绝） |
| 大小写/权限 | 复用路径解析、父目录存在校验、命名规范（同 `writeFile`） |

---

## 5. 接口签名（草案）

**存储层**（`files-api.ts` / `files-vfs.ts` / `files-storage.ts` 新增；内部基元，供 fs 桥接消费）：

```ts
// 流式写：打开 → 逐块写 → 关闭
export async function filesOpenStreamWrite(path: string): Promise<FilesStreamWriter>
// FilesStreamWriter = {
//   write(chunk: Uint8Array): Promise<void>   // 每块增量落盘 + 配额预占
//   close(): Promise<FilesApiEntry>           // finalize：COW 引用整理、节点 blobId 切换
//   abort(): Promise<void>                    // 取消：清已写 chunk、回退配额
// }
```

**客侧暴露（沿用已有全局，不加新 API）**：

- `Response.body: ReadableStream`（`quickjs-fetch.ts` 客侧实现）
- `fs.createWriteStream`（已有）行为升级：宿主侧真增量落盘

---

## 6. 实施计划（分阶段 + 验收）

### Phase 0 · 行为确认（半天，非阻塞）
- 确认浏览器侧 `response.body` 流式读**恒可用、不依赖对端**：小文件 + 大文件各验证一遍分块读。
- 观察代理服务器（Cloudflare Worker）对大文件的首字节延迟与能否完整拉回：记录其是否缓冲、是否有大小限制（如 Cloudflare Worker 内存上限）。
- **验收**：流式读实现**不因代理服务器行为分叉**；其缓冲结论仅用于文档化说明"下载与写盘的重叠度"与超大文件成功率。

### Phase 1 · 存储层基元（核心工作量，与 API 无关）
- 新增 `FILES_CHUNKS_STORE` 与 blob 元数据改造；惰性迁移；读路径兼容新旧格式。
- 挂载卷流式写复用 FSA `writable.write(chunk)`。
- `filesOpenStreamWrite` / `write` / `close` / `abort` + 配额增量 + journal 单条。
- **验收**：
  - 用测试直调存储基元，逐块写 200 MiB，峰值内存 < 几十 MiB（对比现状可量化）。
  - 超 `maxFileBytes` 提前失败且不留残留。
  - 受控模式下撤销一次流式写完整回滚。
  - `/user` 与 `/mount` 均通过。

### Phase 2 · 客侧流式 API（主路径）
> **状态：已完成（2026-08-08 更新）**
> 阻塞项已解除：`docs/quickjs-stream-double-free-bug.md` 的根因（asyncify 构建中 `*Sync`
> 在 job/宿主回调里挂起穿越 raw export，drain 重入破坏 asyncify 状态）已在
> `quickjs-async-bridge.ts` 修复（挂起感知 job 泵 + 挂起感知 callFunction + drain/宿主任务
> 异步化串行化），回归全绿。
>
> **已落地：**
> - 宿主侧 `fsHostOpenStreamWrite`（`quickjs-fs-vfs.ts`，含 journal 单条）、WriteStream
>   宿主侧改真增量落盘（`openWrite/writeChunk/closeWrite/abort`，abort 覆盖 open 未完成窗口）、
>   客侧 `_write` 异步化 + `destroy`→abort。
> - QuickJS 客侧 ReadableStream 最小实现（`getReader/read/cancel`）+ `.pipe()` 桥接
>   （兼容 Node stream `pipeline`）。
> - `injectFetch` 改为"响应壳 + 拉取式 body 流"：`Response.body` 返回 ReadableStream，
>   宿主侧按 chunk 增量读取并逐块递入客侧，`maxFileBytes` 按累计字节实时拦截。
> - `arrayBuffer()/text()/json()/bytes()` 流式消费回归不破；`bodyUsed` 语义正确。
> - 验收通过：`pipeline(fetch(url).body, fs.createWriteStream(dest))` 全链路冒烟
>   （`quickjs-fetch-stream.smoke-test.ts`），reader.read() 逐块正确，cancel 清理无残留。

### Phase 3 · 体验与指标
- 终端内下载进度展示（写流进度 → upsert_output_block 进度条，复用现有 live block 机制）。
- 代理指标累计字节与实际 streamed 标记；任务管理器面板可视化。
- **验收**：下载中大文件可见实时进度；指标页显示真实传输量。

---

## 7. 风险与开放问题

| # | 风险 / 问题 | 影响 | 应对 |
|---|-------------|------|------|
| 1 | 代理服务器（Cloudflare Worker）若整段缓冲（`await arrayBuffer()` 后返回）：其自身内存 O(file)，超大文件可能直接 OOM 失败；首字节延迟到整段下载完，失去"下载与写盘重叠"收益 | 超大文件可能整体失败（代理侧约束，非我们读取侧）；重叠收益打折 | 我们的读取侧**恒走 `response.body` 流式、不做分支**；代理服务器行为只影响文档化说明与超大文件成功率 |
| 2 | `FILES_CHUNKS_STORE` 改造波及面广：创建/读/COW/删除/子树删除/复制/批量 upsert/配额都要过一遍 | 回归风险 | 分批改 + 现有 `files-storage-cow.test.ts`、`files-system-vfs.test.ts` 全量跑；每步独立提交 |
| 3 | QuickJS 客侧 ReadableStream 实现成本（在**主路径**上，不可绕开） | 阶段 2 是硬骨头 | 只做最小语义（getReader/read/cancel），先满足 pipeline；复杂流操作后续迭代 |
| 4 | 流式中断可能残留孤儿 chunk | 数据不一致、占配额 | `abort()` 清理 + 启动时孤儿回收 **已实现**（`files-storage.ts: sweepOrphanChunksOnce`，首次打开 DB 后扫无 blob 记录的 chunk 并删除；有单测） |
| 5 | 大文件 `before` blob 是整文件副本 | 覆盖已有大文件时撤销代价高 | 维持现状（原文件已存在，不新增内存峰值）；文档化 |
| 6 | 无 Content-Length 的响应（chunked）无法预估总大小 | 进度无 total、配额只能按需扣 | 进度 total 可缺省；配额按实际累计 |

---

## 8. 兼容性与回滚

- **数据兼容**：旧 blob 记录惰性迁移，旧数据无需重写即可读；写路径自然过渡。
- **API 兼容**：**不加任何新全局**。`Response.body` 是新增属性（不破坏现有方法）；`createWriteStream` 是已有 API 的行为升级；`arrayBuffer()/text()` 语义保持。
- **回滚**：阶段间独立提交。Phase 1 若存储改造出问题，可回退到旧 blob 格式（读路径双格式并存，写路径切回旧实现）；Phase 2 失败不影响 Phase 1。
- **测试**：在既有 `files-storage-cow.test.ts` / `files-system-vfs.test.ts` / `terminal-controlled.smoke-test.ts` 基础上新增流式用例。

---

## 附：关键代码位置速查

| 层 | 文件 | 关注点 |
|----|------|--------|
| 网络 | `src/quickjs/quickjs-fetch.ts:211-232` | 现为整段 arrayBuffer，须改响应壳 + body 流 |
| 网络 | `src/os/proxy-server-api.ts:119-183` | proxiedFetch 已可流式，保持不动 |
| 客侧 | `src/quickjs/quickjs-fs.ts:454-509` | WriteStream 宿主侧假流 → 真增量落盘 |
| 客侧 | `src/quickjs/quickjs-fs.ts:583-690` | guest stream 模块（Readable/Writable），pipeline 基础 |
| 存储 | `src/apps/files/files-storage.ts:55,467-726` | blob 记录模型与 COW，核心改造点 |
| 存储 | `src/apps/files/files-location-mount.ts:412-425` | 挂载卷原生流式写 |
| 撤销 | `src/terminal/terminal-changeset-journal.ts:63-199` | 单条逻辑写兼容点 |
| 文档 | `src/terminal/instant-shell/instant-shell-prompt.ts:11` | 能力说明需同步更新（fetch → body 流 + createWriteStream） |
