/**
 * 虚拟机文件传输服务（宿主侧会话驱动，todo/vm-remote-control 文件传输计划）。
 *
 * 双向统一「元数据先行，数据粘贴时才流」：
 *   XP→宿主：桥发 OFFER（XP 复制的文件清单）→ 本模块写进文件APP剪贴板
 *         （vm-files 条目）→ 用户在目标文件夹粘贴 → pullFileFromVm 逐块
 *         H2G REQ 向桥拉数据，落盘到粘贴目录。
 *   宿主→XP：文件APP复制/剪切 → pushFilesToVm 推元数据（PENDING，只有
 *         名字+大小）→ 桥在 XP 侧挂一个空 CF_HDROP 占位；用户在 XP 里
 *         真正粘贴（不是右键探询）后桥自己当复制引擎写盘。复制可多次粘贴，
 *         供块会话一直留到宿主剪贴板换成别的；剪切成功才 DONE{ok} 删源。
 *
 * 后端注册：VM 应用持有运行时池与 agent 门面，displayedId 变化时注册/
 * 注销（虚拟机未运行时 requireAgent 抛错，UI 层转成提示）。同一时刻
 * 全局只允许一个会话在飞（信箱单向只有一个槽位），拉取与供块各自串行。
 *
 * 本模块无 React 依赖；会话状态是模块级单例（与 files-clipboard 同款），
 * 纯逻辑部分（会话推进）由 VM 应用把 handleGuestFileEvent 接到上行消息。
 */

import {
  filesCopy,
  filesCreateBinary,
  filesList,
  filesMkdir,
  filesReadBlobRange,
  filesRemove,
  filesStat,
  filesTrash,
  type FilesApiEntry,
} from '../files/files-api.ts'
import { joinFilesAbsolutePath } from '../files/files-path.ts'
import {
  setFilesClipboard,
  type VmClipboardFile,
  type VmStagingFile,
} from '../files/files-clipboard.ts'
import type { VmAgentController } from './virtual-machine-agent.ts'
import type { VmGuestFileEvent } from './virtual-machine-protocol.ts'

/** 与桥 MAX_NAME_CHARS 一致（含结尾 NUL）：单个描述符名字最大字符数。 */
const MAX_PUSH_NAME_CHARS = 260
/** 与 ivm-shm.ts IVM_FILE_MAX_CHUNK 一致：单块拉取上限。 */
const FILE_CHUNK_BYTES = 32724
/** 与桥 PENDING 帧头一致：sub+count+mode+session 共 16 字节。 */
const PENDING_FRAME_HEADER_BYTES = 16
/** PENDING 帧里 entries 区可用字节上限。 */
const PENDING_FRAME_ENTRIES_BYTES = FILE_CHUNK_BYTES - PENDING_FRAME_HEADER_BYTES
/** 等一块 DATA 的上限（桥侧 5s 超时会先报错）。 */
const DATA_WAIT_TIMEOUT_MS = 15_000
/** 信箱忙时的重试（VM 运行时 15ms 快轮询会尽快腾出槽位）。 */
const RETRY_ATTEMPTS = 10
const RETRY_DELAY_MS = 200

/** 宿主→XP 单条目在 PENDING 帧里占用的字节数（u64 size + utf16z name）。 */
function pendingEntryBytes(name: string): number {
  return 8 + 2 * (name.length + 1)
}

/** 把文件清单按 PENDING 帧 entries 区上限分片；短名字一片可装约 300 条。 */
function chunkPendingFiles(files: readonly PushFile[]): PushFile[][] {
  const chunks: PushFile[][] = []
  let current: PushFile[] = []
  let currentBytes = 0
  for (const file of files) {
    const eBytes = pendingEntryBytes(file.name)
    if (currentBytes + eBytes > PENDING_FRAME_ENTRIES_BYTES && current.length > 0) {
      chunks.push(current)
      current = []
      currentBytes = 0
    }
    current.push(file)
    currentBytes += eBytes
  }
  if (current.length > 0) {
    chunks.push(current)
  }
  return chunks
}

type VmFileTransferBackend = {
  agent: VmAgentController | null
}

let backend: VmFileTransferBackend = { agent: null }

/**
 * 测试注入入口（单测替掉，生产为 files-api 真实实现）。
 */
let statSource: (path: string) => Promise<FilesApiEntry | undefined> = filesStat
let listSource: (path: string) => Promise<FilesApiEntry[]> = filesList
let readBlobSource: (path: string, start: number, length: number) => Promise<Blob> =
  filesReadBlobRange
let trashSource: (path: string) => Promise<FilesApiEntry> = filesTrash

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
  /** 提供给 XP 的相对路径（可含 /；目录以 / 结尾，size=0）。 */
  name: string
  /** 宿主侧绝对路径（供块时 readSourceBlob 用）。 */
  hostPath: string
  size: number
  /** 目录条目（桥创建目录时不需要宿主供块）。 */
  isDir: boolean
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
  /** 剪切模式下的原始源路径（移动语义）。 */
  cutSourcePaths?: string[]
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
      JSON.stringify({
        session: session.session,
        mode: session.mode,
        files: session.files,
        cutSourcePaths: session.cutSourcePaths,
      }),
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
      cutSourcePaths?: unknown
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
        typeof record.size !== 'number' ||
        typeof record.isDir !== 'boolean'
      ) {
        return null
      }
      files.push({
        name: record.name,
        hostPath: record.hostPath,
        size: record.size,
        isDir: record.isDir,
      })
    }
    if (files.length === 0) {
      return null
    }
    const cutSourcePaths = Array.isArray(parsed.cutSourcePaths)
      ? parsed.cutSourcePaths.filter((p): p is string => typeof p === 'string')
      : undefined
    return {
      session: sessionId,
      mode: parsed.mode,
      files,
      currentFile: 0,
      windows: [],
      queuedWindows: new Set(),
      windowQueue: Promise.resolve(),
      cutSourcePaths,
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

/**
 * 递归展开文件树为 PENDING 清单条目。
 * 目录条目：name 以 / 结尾，size=0；文件条目：name 不含尾 /，size=byteSize。
 * 顺序保证父目录出现在子项之前（深度优先）。
 *
 * relativePrefix 表示当前节点所在目录的相对路径前缀（顶层为 ''；进入子
 * 目录时以 / 结尾），因此当前文件 name = prefix + basename，当前目录
 * name = prefix + basename + '/'。
 */
async function expandPushTree(
  hostPath: string,
  relativePrefix: string,
  out: PushFile[],
): Promise<void> {
  const stat = await statSource(hostPath)
  if (!stat) {
    console.warn(`[vm-file] 宿主: 跳过无法 stat 的推送路径 ${hostPath}`)
    return
  }
  if (stat.kind === 'file') {
    const name = `${relativePrefix}${stat.name}`
    if (name.length > MAX_PUSH_NAME_CHARS - 1) {
      throw new Error(`名字太长，无法发送「${hostPath}」`)
    }
    out.push({ name, hostPath: stat.path, size: stat.byteSize, isDir: false })
    return
  }
  if (stat.kind === 'folder') {
    const folderName = `${relativePrefix}${stat.name}/`
    out.push({ name: folderName, hostPath: stat.path, size: 0, isDir: true })
    const children = await listSource(stat.path)
    for (const child of children) {
      await expandPushTree(child.path, folderName, out)
    }
    return
  }
  console.warn(`[vm-file] 宿主: 跳过非常规条目 ${hostPath}`)
}

/** 无条件作废 XP 侧待粘贴清单。推送失败、用户清空等场景都要用它。 */
async function clearXpPending(): Promise<void> {
  pushSession = null
  forgetPushSession()
  const agent = backend.agent
  if (agent) {
    await callWithRetry(() => agent.fileClear())
    void agent.fileWindowsClear().catch(() => false)
  }
}

// #region 剪贴板文件桥 v9：SMB staging（宿主→XP 复制走共享根，粘贴时 XP 经 SMB 自取）

/** 共享根下正向 staging 目录（每批一个子目录，新的复制会整目录重建）。 */
const VM_CLIP_STAGING_DIR = '.clipboard'
/** 共享根下反向 staging 目录（XP 复制后桥拷入；宿主粘贴成功后删批次）。 */
export const VM_CLIP_STAGING_OUT_DIR = '.clipboard-out'

/** 剪贴板桥 staging 依赖的共享文件夹目标（根 = VFS 绝对路径；drive = 客机盘符）。 */
export type VmClipSharedTarget = { root: string; drive: string }

let clipSharedTarget: VmClipSharedTarget | null = null

/**
 * VM 应用随共享文件夹配置变化调用（root 为空串/共享关闭传 null）。
 * 与 agent 注册分开：注销 agent 的 effect 每次依赖变化都会跑，不能把
 * 目标配置一起清掉。
 */
export function registerVmClipSharedTarget(target: VmClipSharedTarget | null): void {
  clipSharedTarget = target && target.root ? target : null
}

/** Files APP 粘贴 vm-staging 时读（null = 共享文件夹不可用）。 */
export function getVmClipSharedTarget(): VmClipSharedTarget | null {
  return clipSharedTarget
}

/** 测试注入：替换 staging 拷贝/清理所用的文件原语。 */
let stagingCopySource: (source: string, destDir: string) => Promise<FilesApiEntry> = filesCopy
let stagingMkdirSource: (path: string) => Promise<FilesApiEntry> = filesMkdir
let stagingRemoveSource: (path: string) => Promise<void> = filesRemove
let stagingWriteBinarySource: (path: string, bytes: ArrayBuffer) => Promise<FilesApiEntry> =
  filesCreateBinary

/** 宿主侧 staging 里的当前批次（测试断言用）。 */
export function peekVmClipBatchId(): string | undefined {
  return clipBatchId
}

let clipBatchId: string | undefined

/** manifest 编码：UTF-16LE + BOM，行 = 首行 mode、其余每行一个顶层名字。 */
function encodeClipManifest(mode: 'copy' | 'cut', names: readonly string[]): ArrayBuffer {
  const lines = [mode, ...names]
  let units = 1
  for (const line of lines) {
    units += line.length + 1
  }
  const bytes = new Uint8Array(units * 2)
  const view = new DataView(bytes.buffer)
  bytes[0] = 0xff
  bytes[1] = 0xfe
  let offset = 1
  for (const line of lines) {
    for (let i = 0; i < line.length; i += 1) {
      view.setUint16(offset * 2, line.charCodeAt(i), true)
      offset += 1
    }
    view.setUint16(offset * 2, 0x000a, true) // '\n'
    offset += 1
  }
  return bytes.buffer
}

/** 删掉上一批 staging（幂等：不存在就算了）。 */
async function clearClipStagingDir(root: string): Promise<void> {
  try {
    await stagingRemoveSource(joinFilesAbsolutePath(root, VM_CLIP_STAGING_DIR))
  } catch {
    // 首次复制/目录不在：正常路径
  }
}

/**
 * 文件APP复制/剪切后调用（v9 SMB staging 路径）：把选中项拷进共享根
 * `.clipboard/<batch>/`，写 manifest（UTF-16LE），再给桥发一条 op=3 短通知；
 * XP 里粘贴时 Explorer 拿 CF_HDROP 真路径自己经 SMB 枚举读取，宿主零参与。
 * 字节只在本机 VFS 内拷贝，不过信箱、不走网络。
 */
export async function pushClipStagingToVm(
  hostPaths: readonly string[],
  mode: 'copy' | 'cut',
): Promise<void> {
  const agent = requireAgent('发送文件到虚拟机')
  const target = clipSharedTarget
  if (!target) {
    throw new Error('共享文件夹未开启，无法发送到虚拟机')
  }
  const batch = `b${Date.now().toString(36)}${Math.floor(Math.random() * 46656).toString(36)}`
  const stagingRoot = joinFilesAbsolutePath(target.root, VM_CLIP_STAGING_DIR)
  const batchDir = joinFilesAbsolutePath(stagingRoot, batch)

  // 新复制语义上替换 XP 剪贴板：上一批整个删掉（XP 未粘贴就被覆盖，与
  // 系统剪贴板行为一致），也顺便回收旧字节。
  await clearClipStagingDir(target.root)
  await stagingMkdirSource(stagingRoot)
  await stagingMkdirSource(batchDir)

  const names: string[] = []
  try {
    for (const hostPath of hostPaths) {
      const copied = await stagingCopySource(hostPath, batchDir)
      names.push(copied.name)
    }
    if (names.length === 0) {
      await stagingRemoveSource(batchDir).catch(() => undefined)
      return
    }
    await stagingWriteBinarySource(
      joinFilesAbsolutePath(batchDir, 'manifest.txt'),
      encodeClipManifest(mode, names),
    )
  } catch (error) {
    // 半批 staging 留着会误导 XP 粘贴：整目录撤掉再抛
    await stagingRemoveSource(stagingRoot).catch(() => undefined)
    throw error
  }

  clipBatchId = batch
  const manifestGuestPath = `${target.drive}:\\${VM_CLIP_STAGING_DIR}\\${batch}\\manifest.txt`
  const sent = await callWithRetry(() => agent.clipManifest(manifestGuestPath))
  if (!sent) {
    throw new Error('虚拟机信箱忙：无法通知剪贴板清单（请重试）')
  }
}

/** VM 停止 / 共享文件夹关闭时调用：两个 staging 目录一并回收。
 * explicitRoot 给「目标已注销成 null 但还要清现场」的调用方用。 */
export async function clearVmClipStaging(explicitRoot?: string): Promise<void> {
  const root = explicitRoot ?? clipSharedTarget?.root
  if (!root) {
    return
  }
  clipBatchId = undefined
  await clearClipStagingDir(root)
  try {
    await stagingRemoveSource(joinFilesAbsolutePath(root, VM_CLIP_STAGING_OUT_DIR))
  } catch {
    // 目录不在：正常
  }
}

/**
 * vm-staging 粘贴：从共享根 staging 把一个文件/目录 VFS 拷到目标目录。
 * 由 Files APP 粘贴流程逐项调用（冲突决策在调用方）。
 */
export async function copyVmClipStagingFile(
  file: VmStagingFile,
  destDirPath: string,
  nameMode: 'exact' | 'unique-suffix',
): Promise<FilesApiEntry> {
  const target = clipSharedTarget
  if (!target) {
    throw new Error('共享文件夹未开启，无法粘贴虚拟机文件')
  }
  const source = joinFilesAbsolutePath(target.root, ...file.relPath.split('/').filter(Boolean))
  void nameMode
  // filesCopy 自带同名加后缀；replace 语义由调用方先删目标腾原名
  return stagingCopySource(source, destDirPath)
}

/** 粘贴完成后回收一个反向批次目录。 */
export async function cleanupVmClipBatch(batchId: string): Promise<void> {
  const target = clipSharedTarget
  if (!target) {
    return
  }
  try {
    await stagingRemoveSource(
      joinFilesAbsolutePath(target.root, VM_CLIP_STAGING_OUT_DIR, batchId),
    )
  } catch {
    // 批次不在：正常
  }
}

// #endregion

/** 文件APP复制/剪切后调用：把元数据推给桥（只有名字+大小，无数据传输）。 */
export async function pushFilesToVm(hostPaths: string[], mode: 'copy' | 'cut'): Promise<void> {
  const agent = requireAgent('发送文件到虚拟机')
  try {
    const files: PushFile[] = []
    const cutSourcePaths: string[] = []
    for (const hostPath of hostPaths) {
      const before = files.length
      await expandPushTree(hostPath, '', files)
      if (files.length > before) {
        // 记录顶层真实路径（cut 模式移动语义用）
        const stat = await statSource(hostPath)
        if (stat) {
          cutSourcePaths.push(stat.path)
        }
      }
    }
    if (files.length === 0) {
      await clearXpPending()
      return
    }

    const session = newSessionId()
    const chunks = chunkPendingFiles(files)
    for (const chunk of chunks) {
      const sent = await callWithRetry(() =>
        agent.filePending(
          session,
          mode,
          chunk.map((f) => ({ path: f.name, size: f.size })),
        ),
      )
      if (!sent) {
        throw new Error('虚拟机信箱忙：无法推送文件清单（请重试）')
      }
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
      cutSourcePaths: cutSourcePaths.length > 0 ? cutSourcePaths : undefined,
    }
    savePushSession(pushSession)
  } catch (error) {
    await clearXpPending().catch(() => {
      // 清理旧清单失败不应掩盖原始错误
    })
    throw error
  }
}

/** 宿主剪贴板变化（新复制/清空）时作废 XP 侧的待粘贴清单。 */
export async function clearPendingOffer(): Promise<void> {
  await clearXpPending()
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
let readSourceBlob: (path: string, start: number, length: number) => Promise<Blob> =
  filesReadBlobRange

/**
 * 仅供单测：替换文件源、目录枚举、会话状态（pushFilesToVm 依赖 OPFS 门面）。
 * 传 null 恢复生产入口 / 清空会话。
 */
export function fileTransferTestHooks(hooks: {
  readSource?: typeof readSourceBlob
  statSource?: typeof statSource
  listSource?: typeof listSource
  readBlobSource?: typeof readBlobSource
  trashSource?: typeof trashSource
  pushSession?: PushSession | null
  stagingCopy?: typeof stagingCopySource
  stagingMkdir?: typeof stagingMkdirSource
  stagingRemove?: typeof stagingRemoveSource
  stagingWriteBinary?: typeof stagingWriteBinarySource
}): void {
  if (hooks.readSource) {
    readSourceBlob = hooks.readSource
  }
  if (hooks.statSource) {
    statSource = hooks.statSource
  }
  if (hooks.listSource) {
    listSource = hooks.listSource
  }
  if (hooks.readBlobSource) {
    readBlobSource = hooks.readBlobSource
  }
  if (hooks.trashSource) {
    trashSource = hooks.trashSource
  }
  if (hooks.pushSession !== undefined) {
    pushSession = hooks.pushSession
  }
  if (hooks.stagingCopy) {
    stagingCopySource = hooks.stagingCopy
  }
  if (hooks.stagingMkdir) {
    stagingMkdirSource = hooks.stagingMkdir
  }
  if (hooks.stagingRemove) {
    stagingRemoveSource = hooks.stagingRemove
  }
  if (hooks.stagingWriteBinary) {
    stagingWriteBinarySource = hooks.stagingWriteBinary
  }
}

/** 仅供单测：看供块会话还在不在。 */
export function peekVmPushSessionId(): number | undefined {
  return pushSession?.session
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
      // v9 桥：path 是共享根相对路径（/.clipboard-out/<batch>/…），粘贴直读
      // staging；旧桥：path 是 XP 绝对路径，走信箱逐块拉取。
      if (event.files.every((f) => f.path.startsWith(`/${VM_CLIP_STAGING_OUT_DIR}/`))) {
        const staged: VmStagingFile[] = event.files.map((f) => ({
          name: basenameOfXpPath(f.path),
          relPath: f.path,
          size: f.size,
        }))
        setFilesClipboard({ kind: 'vm-staging', files: staged })
        for (const listener of offerListeners) {
          listener(staged.map((f) => ({ name: f.name, path: f.relPath, size: f.size })))
        }
        break
      }
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
      /* 失败/取消：供块会话留下，用户可以再贴。复制成功也不拆（可再贴到别处）。
       * 只有剪切成功才收口并删源。 */
      if (event.result !== 'ok' || session.mode !== 'cut') {
        break
      }
      pushSession = null
      forgetPushSession()
      const agent = backend.agent
      if (agent) {
        void agent.fileWindowsClear().catch(() => false)
      }
      const cutSourcePaths = session.cutSourcePaths
      if (cutSourcePaths) {
        void (async () => {
          for (const path of cutSourcePaths) {
            try {
              await trashSource(path)
            } catch (error) {
              console.warn(`[vm-file] 宿主: 剪切源删除失败 ${path}`, error)
            }
          }
        })()
      }
      break
    }
  }
}

// #endregion
