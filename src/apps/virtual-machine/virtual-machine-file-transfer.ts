/**
 * 虚拟机文件传输服务（宿主侧会话驱动，todo/vm-remote-control 文件传输计划）。
 *
 * 双向统一「元数据先行，数据粘贴时才流」：
 *   XP→宿主：桥发 OFFER（XP 复制的文件清单）→ 本模块写进文件APP剪贴板
 *         （vm-files 条目）→ 用户在目标文件夹粘贴 → pullFileFromVm 逐块
 *         H2G REQ 向桥拉数据，落盘到粘贴目录。
 *   宿主→XP：文件APP复制/剪切 → pushFilesToVm 推元数据（PENDING，只有
 *         名字+大小）→ 桥挂 OLE 虚拟文件 → 用户在 XP 里 Ctrl+V → 桥的
 *         IStream::Read 触发 REQ 上行 → serveFileReq 按 filesReadBlobRange
 *         供块。桥报 DONE{ok} 后 cut 模式把源文件移进废纸篓（移动语义）。
 *
 * 后端注册：VM 应用持有运行时池与 agent 门面，displayedId 变化时注册/
 * 注销（虚拟机未运行时 requireAgent 抛错，UI 层转成提示）。同一时刻
 * 全局只允许一个会话在飞（信箱单向只有一个槽位），拉取与供块各自串行。
 *
 * 本模块无 React 依赖；会话状态是模块级单例（与 files-clipboard 同款），
 * 纯逻辑部分（会话推进）由 VM 应用把 handleGuestFileEvent 接到上行消息。
 */

import {
  filesReadBlobRange,
  filesStat,
  filesTrash,
} from '../files/files-api.ts'
import {
  setFilesClipboard,
  type VmClipboardFile,
} from '../files/files-clipboard.ts'
import type { VmAgentController } from './virtual-machine-agent.ts'
import type { VmGuestFileEvent } from './virtual-machine-protocol.ts'

/** 与 ivm-shm.ts IVM_FILE_MAX_CHUNK 一致：单块拉取上限。 */
const FILE_CHUNK_BYTES = 32724
/** 信箱忙时的重试（VM 运行时 15ms 快轮询会尽快腾出槽位）。 */
const RETRY_ATTEMPTS = 10
const RETRY_DELAY_MS = 200
/** 等一块 DATA 的上限（桥侧 5s 超时会先报错）。 */
const DATA_WAIT_TIMEOUT_MS = 15_000

type VmFileTransferBackend = {
  agent: VmAgentController | null
}

let backend: VmFileTransferBackend = { agent: null }

/**
 * VM 应用在 displayedId 变化 / 卸载时调用：agent=null 表示当前没有可用虚拟机。
 */
export function registerVmFileTransferBackend(agent: VmAgentController | null): void {
  backend.agent = agent
}

function requireAgent(context: string): VmAgentController {
  const agent = backend.agent
  if (!agent) {
    throw new Error(`虚拟机未运行，无法${context}`)
  }
  return agent
}

let nextSession = 1
function newSessionId(): number {
  const id = (nextSession = (nextSession + 1) % 0x7fffffff)
  return id
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 信箱忙重试包装（filePending/fileReq/fileChunk/fileDone 都返回 boolean）。 */
async function callWithRetry(fn: () => Promise<boolean>): Promise<boolean> {
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    if (await fn()) {
      return true
    }
    await sleep(RETRY_DELAY_MS)
  }
  return false
}

// #region XP → 宿主：拉取（文件APP粘贴时驱动）

type DataWaiter = {
  session: number
  offset: number
  resolve: (data: { bytes: Uint8Array; end: boolean }) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

let dataWaiter: DataWaiter | null = null

function waitForData(session: number, offset: number): Promise<{ bytes: Uint8Array; end: boolean }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      dataWaiter = null
      reject(new Error('等待虚拟机数据超时（桥无响应）'))
    }, DATA_WAIT_TIMEOUT_MS)
    dataWaiter = { session, offset, resolve, reject, timer }
  })
}

/**
 * 从 XP 拉一个文件到宿主：onChunk 逐块回调（调用方接 filesOpenStreamWrite）。
 * 串行拉取——同一时刻只允许一个会话（信箱单槽位）。
 */
export async function pullFileFromVm(
  xpPath: string,
  size: number,
  onChunk: (chunk: Uint8Array) => Promise<void> | void,
): Promise<void> {
  const agent = requireAgent('从虚拟机导入文件')
  const session = newSessionId()
  try {
    let offset = 0
    while (offset < size) {
      const length = Math.min(FILE_CHUNK_BYTES, size - offset)
      const first = offset === 0
      const sent = await callWithRetry(() =>
        agent.fileReq(session, first, first ? xpPath : null, offset, length),
      )
      if (!sent) {
        throw new Error('虚拟机信箱忙：无法请求数据（请重试）')
      }
      const data = await waitForData(session, offset)
      await onChunk(data.bytes)
      offset += data.bytes.length
      if (data.end || data.bytes.length === 0) {
        break
      }
    }
    await callWithRetry(() => agent.fileDone(session, 'ok'))
  } finally {
    if (dataWaiter?.session === session) {
      clearTimeout(dataWaiter.timer)
      dataWaiter = null
    }
  }
}

// #endregion

// #region 宿主 → XP：推元数据 + 按桥的 REQ 供块

type PushFile = {
  /** 提供给 XP 的文件名（descriptor cFileName / REQ 回程键）。 */
  name: string
  /** 宿主侧绝对路径（供块时 filesReadBlobRange 用）。 */
  hostPath: string
  size: number
}

/** 预读窗跨度：一次存储读 + 一次跨页推送，摊薄每块的固定开销。 */
const WINDOW_BYTES = 4 * 1024 * 1024

type PushedWindow = {
  name: string
  base: number
  len: number
}

type PushSession = {
  session: number
  mode: 'copy' | 'cut'
  files: PushFile[]
  /** 桥当前在拉的下标（REQ start 帧带名字切换）。 */
  currentFile: number
  /** 已推给运行时页的预读窗（REQ 命中即页内直供，宿主只推进不供块）。 */
  windows: PushedWindow[]
  /** 已排队/在推的窗基址（name@base），防重复推。 */
  queuedWindows: Set<string>
  /** 窗推送串行链（OPFS 读 + 跨页推送不并发）。 */
  windowQueue: Promise<void>
}

let pushSession: PushSession | null = null

/**
 * 推送会话落盘：XP 侧的「待粘贴」挂在桥的内存里，不随宿主刷新消失；
 * 供块会话原来只存在页面内存里，刷新一次就丢——用户复制后刷新页面
 * （或复制在前、刷新在后），粘贴必然超时报「无法读取」。落盘一份，
 * REQ 上来发现会话不在了就按记录重建。
 */
const PUSH_SESSION_STORAGE_KEY = 'vm-file-push-session'

function savePushSession(session: PushSession): void {
  try {
    localStorage.setItem(
      PUSH_SESSION_STORAGE_KEY,
      JSON.stringify({ session: session.session, mode: session.mode, files: session.files }),
    )
  } catch {
    // 存不上就算了：最坏情况是刷新后这次粘贴不能续，报错重推即可
  }
}

function loadPushSession(sessionId: number): PushSession | null {
  try {
    const raw = localStorage.getItem(PUSH_SESSION_STORAGE_KEY)
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw) as {
      session?: unknown
      mode?: unknown
      files?: unknown
    }
    if (
      parsed.session !== sessionId ||
      (parsed.mode !== 'copy' && parsed.mode !== 'cut') ||
      !Array.isArray(parsed.files)
    ) {
      return null
    }
    const files: PushFile[] = []
    for (const item of parsed.files) {
      const record = item as Record<string, unknown>
      if (
        typeof record !== 'object' ||
        record === null ||
        typeof record.name !== 'string' ||
        typeof record.hostPath !== 'string' ||
        typeof record.size !== 'number'
      ) {
        return null
      }
      files.push({ name: record.name, hostPath: record.hostPath, size: record.size })
    }
    if (files.length === 0) {
      return null
    }
    return {
      session: sessionId,
      mode: parsed.mode,
      files,
      currentFile: 0,
      windows: [],
      queuedWindows: new Set(),
      windowQueue: Promise.resolve(),
    }
  } catch {
    return null
  }
}

function forgetPushSession(): void {
  try {
    localStorage.removeItem(PUSH_SESSION_STORAGE_KEY)
  } catch {
    // 忽略
  }
}

/** 文件APP复制/剪切后调用：把元数据推给桥（几百字节，无数据传输）。 */
export async function pushFilesToVm(hostPaths: string[], mode: 'copy' | 'cut'): Promise<void> {
  const agent = requireAgent('发送文件到虚拟机')
  const files: PushFile[] = []
  for (const hostPath of hostPaths) {
    const stat = await filesStat(hostPath)
    if (!stat || stat.kind !== 'file') {
      throw new Error(`无法发送「${hostPath}」：不是常规文件`)
    }
    files.push({ name: stat.name, hostPath: stat.path, size: stat.byteSize })
  }
  const session = newSessionId()
  const sent = await callWithRetry(() =>
    agent.filePending(
      session,
      mode,
      files.map((f) => ({ path: f.name, size: f.size })),
    ),
  )
  if (!sent) {
    throw new Error('虚拟机信箱忙：无法推送文件清单（请重试）')
  }
  // 上会话的预读窗按文件名缓存，同名文件若中途改过会推脏数据：开新会话前清掉。
  await agent.fileWindowsClear().catch(() => false)
  pushSession = {
    session,
    mode,
    files,
    currentFile: 0,
    windows: [],
    queuedWindows: new Set(),
    windowQueue: Promise.resolve(),
  }
  savePushSession(pushSession)
}

/** 宿主剪贴板变化（新复制/清空）时作废 XP 侧的待粘贴清单。 */
export async function clearPendingOffer(): Promise<void> {
  if (!pushSession) {
    return
  }
  pushSession = null
  forgetPushSession()
  const agent = backend.agent
  if (agent) {
    await callWithRetry(() => agent.fileClear())
    void agent.fileWindowsClear().catch(() => false)
  }
}

/**
 * 读一个预读窗推给运行时页（OPFS 一次大读 + 一次跨页推送）。排队串行执行；
 * 窗已推过/在推则跳过。失败只记日志：REQ 再来会走兜底重新推。
 */
function queueWindowPush(
  session: PushSession,
  agent: VmAgentController,
  file: PushFile,
  base: number,
): void {
  const key = `${file.name}@${base}`
  if (base >= file.size || session.queuedWindows.has(key)) {
    return
  }
  if (session.windows.some((w) => w.name === file.name && w.base === base)) {
    return
  }
  session.queuedWindows.add(key)
  session.windowQueue = session.windowQueue
    .then(async () => {
      const len = Math.min(WINDOW_BYTES, file.size - base)
      const blob = await readSourceBlob(file.hostPath, base, len)
      const bytes = await blob.arrayBuffer()
      const pushed = await agent.fileWindow(session.session, file.name, base, bytes)
      if (pushed) {
        session.windows.push({ name: file.name, base, len: bytes.byteLength })
        if (session.windows.length > 4) {
          session.windows.shift()
        }
      }
    })
    .catch((error) => {
      console.warn(`[vm-file] 宿主: 预读窗推送失败 ${file.name}@${base}`, error)
    })
    .finally(() => {
      session.queuedWindows.delete(key)
    })
}

/** 供块/预读窗共用的文件读取入口（单测注入；生产即 filesReadBlobRange）。 */
let readSourceBlob: (path: string, start: number, length: number) => Promise<Blob> = filesReadBlobRange

/**
 * 仅供单测：替换文件源、直设推送会话（pushFilesToVm 依赖 OPFS 门面）。
 * 传 null 恢复生产读取入口 / 清空会话。
 */
export function fileTransferTestHooks(hooks: {
  readSource?: typeof readSourceBlob
  pushSession?: PushSession | null
}): void {
  if (hooks.readSource) {
    readSourceBlob = hooks.readSource
  }
  if (hooks.pushSession !== undefined) {
    pushSession = hooks.pushSession
  }
}

/** 桥 REQ 上行：命中预读窗只推进消费位置；未命中读一个大窗、推窗并就地供块。
 * 导出仅供单测（全链路模拟）。 */
export async function serveFileReq(event: Extract<VmGuestFileEvent, { kind: 'req' }>): Promise<void> {
  const agent = backend.agent
  if (!agent) {
    return
  }
  let session = pushSession
  if (!session || session.session !== event.session) {
    const restored = loadPushSession(event.session)
    if (restored) {
      pushSession = restored
      session = restored
      console.info(`[vm-file] 宿主: 会话从持久化记录恢复 session=${event.session}`)
      void agent.fileWindowsClear().catch(() => false)
    }
  }
  if (!session || session.session !== event.session) {
    console.info(`[vm-file] 宿主: 忽略过期 REQ session=${event.session}`)
    return
  }
  if (event.start) {
    if (!event.path) {
      pushSession = null
      await callWithRetry(() => agent.fileDone(event.session, 'error'))
      return
    }
    const index = session.files.findIndex((f) => f.name === event.path)
    if (index < 0) {
      console.warn(`[vm-file] 宿主: REQ 请求了清单外的文件 ${JSON.stringify(event.path)}`)
      pushSession = null
      await callWithRetry(() => agent.fileDone(event.session, 'error'))
      return
    }
    session.currentFile = index
  }
  const file = session.files[session.currentFile]
  if (event.offset >= file.size) {
    // 桥要的字节超出实际文件（源文件中途变小）：报错收场
    pushSession = null
    await callWithRetry(() => agent.fileDone(event.session, 'error'))
    return
  }
  const window = session.windows.find(
    (w) =>
      w.name === file.name &&
      event.offset >= w.base &&
      event.offset + event.length <= w.base + w.len,
  )
  if (window) {
    // 运行时页窗内直供中。只负责让窗链保持领先一格。
    const chainEnd = session.windows
      .filter((w) => w.name === file.name)
      .reduce((max, w) => Math.max(max, w.base + w.len), 0)
    if (chainEnd < file.size && event.offset + WINDOW_BYTES >= chainEnd) {
      queueWindowPush(session, agent, file, chainEnd)
    }
    return
  }
  // 未命中（会话起点/跨窗沿）：按窗跨度读一大块——先供本块（桥正等着），
  // 再把这块推成窗，后续 REQ 就由运行时页直供；同时排队下一窗。
  const base = event.offset
  const length = Math.min(event.length, file.size - event.offset)
  const slabLen = Math.min(WINDOW_BYTES, file.size - base)
  const blob = await readSourceBlob(file.hostPath, base, slabLen)
  const slabBytes = new Uint8Array(await blob.arrayBuffer())
  const sent = await callWithRetry(() =>
    agent.fileChunk(
      event.session,
      event.offset,
      slabBytes.slice(0, length).buffer,
      base + length >= file.size,
    ),
  )
  if (!sent) {
    console.warn(`[vm-file] 宿主: fileChunk 持续被拒 session=${event.session} offset=${event.offset}`)
  }
  const pushed = await agent.fileWindow(session.session, file.name, base, slabBytes.buffer)
  if (pushed) {
    session.windows.push({ name: file.name, base, len: slabBytes.byteLength })
    if (session.windows.length > 4) {
      session.windows.shift()
    }
  }
  if (base + slabLen < file.size) {
    queueWindowPush(session, agent, file, base + slabLen)
  }
}

// #endregion

// #region 上行事件分派（VM 应用把 onGuestFileEvent 接到这里）

type OfferListener = (files: VmClipboardFile[]) => void

const offerListeners = new Set<OfferListener>()

/** VM 应用订阅：收到 XP 文件清单时给用户提示（「可在文件APP粘贴」）。 */
export function subscribeVmFileOffers(listener: OfferListener): () => void {
  offerListeners.add(listener)
  return () => offerListeners.delete(listener)
}

function basenameOfXpPath(path: string): string {
  const normalized = path.replace(/[\\/]+$/, '')
  const index = Math.max(normalized.lastIndexOf('\\'), normalized.lastIndexOf('/'))
  return index >= 0 ? normalized.slice(index + 1) : normalized
}

/**
 * 运行时上行文件事件入口。VM 应用按机器过滤后转发到这里；错误都就地
 * 消化（传输失败体现在等待方/日志，不打断 VM 应用）。
 */
export function handleVmFileEvent(event: VmGuestFileEvent): void {
  switch (event.kind) {
    case 'offer': {
      const files: VmClipboardFile[] = event.files.map((f) => ({
        name: basenameOfXpPath(f.path),
        path: f.path,
        size: f.size,
      }))
      setFilesClipboard({ kind: 'vm-files', files })
      for (const listener of offerListeners) {
        listener(files)
      }
      break
    }
    case 'data': {
      const waiter = dataWaiter
      if (waiter && waiter.session === event.session && waiter.offset === event.offset) {
        clearTimeout(waiter.timer)
        dataWaiter = null
        waiter.resolve({ bytes: event.bytes, end: event.end })
      }
      break
    }
    case 'req': {
      void serveFileReq(event).catch((error) => {
        console.error('[vm-file] 宿主: 供块失败', error)
      })
      break
    }
    case 'done': {
      const session = pushSession
      if (!session || session.session !== event.session) {
        break
      }
      pushSession = null
      forgetPushSession()
      const agent = backend.agent
      if (agent) {
        void agent.fileWindowsClear().catch(() => false)
      }
      if (event.result === 'ok' && session.mode === 'cut') {
        // 剪切语义：粘贴成功后源文件进废纸篓（移动）
        void (async () => {
          for (const file of session.files) {
            try {
              await filesTrash(file.hostPath)
            } catch (error) {
              console.warn(`[vm-file] 宿主: 剪切源删除失败 ${file.hostPath}`, error)
            }
          }
        })()
      }
      break
    }
  }
}

// #endregion
