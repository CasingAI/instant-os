import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition, MenuItemSubItem } from '../../os/menu-bar-types.ts'
import { useOs, useWindowCloseHandler, useWindowForceCloseHandler } from '../../os/os-context.tsx'
import { recordSystemDebugTimeline } from '../../os/system-debug-log.ts'
import { releaseDiskImagePath } from '../files/files-disk-image-occupancy.ts'
import { Button } from '../../ui/button.tsx'
import { useHud } from '../../ui/hud.tsx'
import { SegmentedControl } from '../../ui/segmented-control.tsx'
import { useAppNarrowLayout } from '../../ui/use-app-narrow-layout.ts'
import { useSystemOpenDialog } from '../../window/system-open-dialog.tsx'
import { useWindowModal } from '../../window/window-modal-context.tsx'
import {
  formatVmBackendLabel,
  getVmBackend,
  vmPowerUnavailableMessage,
} from './virtual-machine-backends.ts'
import {
  defaultVirtualMachineSettings,
  deviceAcceptExtensions,
  devicePickTitle,
  formatVmDiskWriteModeLabel,
  formatVmDisplayModeLabel,
  formatVmMemoryLabel,
  isSharedFolderActive,
  settingsFromRecord,
} from './virtual-machine-config.ts'
import {
  claimVirtualMachineDiskImageOccupancy,
  isRemovableMediumInserted,
  mountVirtualMachineRemovableMedia,
  releaseVirtualMachineRemovableMedia,
  shouldSkipRemovableMediaPick,
  slotOfDevice,
  virtualMachineHasBootMedia,
  vmMountedDiskSlots,
  type VmRemovableMediaMount,
} from './virtual-machine-disks.ts'
import { listVmDiskStreamIds } from './virtual-machine-disk-stream-metrics.ts'
import { getVirtualMachineDiskFlushProgress } from './virtual-machine-disk-stream-host.ts'
import {
  createVmFlushProgressTracker,
  VM_FLUSH_STALL_THRESHOLD_MS,
  type VmFlushProgress,
  type VmFlushStage,
} from './virtual-machine-flush-progress.ts'
import { openDiskUtilityFirstAid } from '../disk-utility/disk-utility-route-open.ts'
import { setWebdavSharedRoot } from './virtual-machine-webdav-host.ts'
import { VirtualMachineActivity } from './virtual-machine-activity.tsx'
import { VirtualMachineInspectorOverlay } from './virtual-machine-inspector-overlay.tsx'
import {
  createVmClipboardSyncState,
  normalizeGuestClipboardText,
  normalizeHostClipboardTextForGuest,
  onGuestClipboardReceived,
  onHostClipboardChanged,
} from './virtual-machine-clipboard.ts'
import { postVirtualMachineDiskWriteFailedNotification } from './virtual-machine-disk-write-notification.ts'
import {
  handleVmFileEvent,
  registerVmFileTransferBackend,
  subscribeVmFileOffers,
} from './virtual-machine-file-transfer.ts'
import { postOsNotification } from '../../os/os-notifications.ts'
import { vmAgentFor } from './virtual-machine-agent.ts'
import type {
  InstantVmNativeKeyMessage,
  VmGuestFileEvent,
} from './virtual-machine-protocol.ts'
import { VmRuntimeSurface } from './virtual-machine-runtime-surface.tsx'
import {
  DISK_IMAGE_INCOMPLETE_HINT,
  FORCED_OFF_UNFLUSHED_HINT,
  pickDisplayedMachineId,
  useVirtualMachineRuntimePool,
} from './virtual-machine-runtime.ts'
import {
  buildKeyboardSequence,
  VM_COMBO_KEY_PRESETS,
  VM_FUNCTION_KEY_PRESETS,
  type VmSendKeyPreset,
} from './virtual-machine-send-keys.ts'
import {
  compileVmKeyMappings,
  isVmImeKeyEvent,
  VmKeyboardTranslator,
} from './virtual-machine-keymap.ts'
import { getVmRuntimeOrigin } from './virtual-machine-runtime-config.ts'
import { VirtualMachineSettingsDialog } from './virtual-machine-settings-dialog.tsx'
import {
  addVirtualMachine,
  moveVirtualMachine,
  nextVirtualMachineName,
  readVirtualMachineStore,
  removeVirtualMachine,
  setLastSelectedVirtualMachine,
  setVirtualMachineDiskWriteLoss,
  subscribeVirtualMachineStore,
  updateVirtualMachine,
} from './virtual-machine-store.ts'
import type {
  VirtualMachineRecord,
  VirtualMachineSettings,
  VmStorageDevice,
} from './virtual-machine-types.ts'
import { totalUnflushedDiskBytes, shouldGuardVmUnload, vmDiskWriteLossText, formatVmDiskBytes } from './virtual-machine-disk-write-status.ts'
import { Progress } from '../../ui/progress.tsx'
import type { InstantVmStatsSnapshot } from './virtual-machine-protocol.ts'
import {
  DEFAULT_VIRTUAL_MACHINE_DISK_WRITE_MODE,
  VM_DISPLAY_MODE_IDS,
  VM_OS_PRESET_AGENT_SUPPORTED,
  VM_SNAP_EDGE_PX_DEFAULT,
  type VmDisplayModeId,
} from './virtual-machine-types.ts'
import './virtual-machine.css'

const APP_ID = 'virtual-machine' as const
const THEME = '#3d5a80'
const POWER_HINT_MS = 4000
/** agent 探测周期：运行时控制面每 5s 下发一次 PING，宿主按同周期轮询 state()。 */
const VM_AGENT_POLL_MS = 5_000
/** PONG 年龄超过约 3 个 PING 周期视为失联（agent 挂了 hint 自动消失）。 */
const VM_AGENT_PONG_MAX_AGE_MS = 15_000
/** 现场验证时补发 PING，等一个串口往返的余量再重读 state。 */
const VM_AGENT_PONG_RECHECK_DELAY_MS = 300
/** 点关机遇状态灯 off 的现场验证上限；超过即按真失联处理。 */
const VM_AGENT_VERIFY_TIMEOUT_MS = 3_000

const SHARED_FOLDER_REG_KEY = 'HKLM\\SOFTWARE\\InstantVM\\SharedFolder'
/** 开机重推失败后的重试间隔/上限：EXEC 通道偶尔比 agent 状态灯翻正得晚。 */
const VM_SHARED_FOLDER_PUSH_RETRY_MS = 5_000
const VM_SHARED_FOLDER_PUSH_MAX_ATTEMPTS = 6

/** execResult 回执的读取：agentResult 包一层 {value}，运行时旧路径可能是裸值。 */
function execReceipt(result: unknown): { rc: number | null; timedOut: boolean; error?: string } {
  const wrapped = result as
    | { value?: { exitCode?: number; timedOut?: boolean; error?: string } }
    | { exitCode?: number; timedOut?: boolean; error?: string }
    | undefined
  const value =
    wrapped && typeof wrapped === 'object' && 'value' in wrapped
      ? (wrapped as { value?: { exitCode?: number; timedOut?: boolean; error?: string } }).value
      : (wrapped as { exitCode?: number; timedOut?: boolean; error?: string } | undefined)
  if (!value || typeof value !== 'object') {
    return { rc: null, timedOut: false }
  }
  return {
    rc: typeof value.exitCode === 'number' ? value.exitCode : null,
    timedOut: value.timedOut === true,
    error: typeof value.error === 'string' ? value.error : undefined,
  }
}

/**
 * 共享文件夹的客机配置（同步目录 + subst 引导 + Run 键注册），逐条经
 * execResult（SYSTEM 身份、等待退出码）下发；盘符由登录会话的 Run 键脚本
 * subst（EXEC 在 session 0 里 subst 用户看不见）。
 * 返回值 = 关键配置（SharedFolder 注册表组）是否全部确认落盘。
 *
 * 重入互斥：开机 effect 与保存设置可能并发触发推送，同一时刻全局只允许一个
 * 推送在飞；后来的调用记录最新参数、在当前完成后按最新参数补跑一次——直接
 * 复用旧参数 Promise 会把开关状态推错（如保存关闭时上一次开启推送还在飞）。
 */
let sharedFolderPushInFlight: Promise<boolean> | null = null
let sharedFolderPushQueued:
  | { enabled: boolean; run: (command: string) => Promise<unknown>; drive: string }
  | null = null

function pushSharedFolderGuestConfig(
  enabled: boolean,
  run: (command: string) => Promise<unknown>,
  drive = 'Z',
): Promise<boolean> {
  if (sharedFolderPushInFlight) {
    sharedFolderPushQueued = { enabled, run, drive }
    return sharedFolderPushInFlight.then(() => {
      const queued = sharedFolderPushQueued
      sharedFolderPushQueued = null
      return queued ? pushSharedFolderGuestConfig(queued.enabled, queued.run, queued.drive) : true
    })
  }
  sharedFolderPushInFlight = pushSharedFolderGuestConfigInner(enabled, run, drive).finally(() => {
    sharedFolderPushInFlight = null
  })
  return sharedFolderPushInFlight
}

async function pushSharedFolderGuestConfigInner(
  enabled: boolean,
  run: (command: string) => Promise<unknown>,
  drive = 'Z',
): Promise<boolean> {
  const driveValue = /^[A-Z]$/.test(drive) ? drive : 'Z'
  const runLogged = async (
    command: string,
  ): Promise<{ rc: number | null; timedOut: boolean; error?: string }> => {
    try {
      return execReceipt(await run(command))
    } catch (error) {
      return {
        rc: null,
        timedOut: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  let configOk = true
  const addSharedFolderValue = async (value: string, data: string) => {
    const receipt = await runLogged(`reg add ${SHARED_FOLDER_REG_KEY} ${value} ${data}`)
    if (receipt.rc !== 0 || receipt.error !== undefined) {
      configOk = false
    }
  }

  if (enabled) {
    // 共享文件夹：网上邻居的 WebDAV（宿主桥）为主通道，XP 的 dav 重定向器
    // 已验证可用（根/子目录 PROPFIND、GET 均通）。这里的同步 + subst 是盘符
    // 补充方案：文件内容由客机 msxml 走桥 HTTP 拉取（裸 IP 192.168.87.1，零
    // DNS），写入 C:\InstantShare；盘符由登录会话的 Run 键脚本 subst 出来。
    // 这里只做：清目录建目录、写引导脚本、连跑同步。同步脚本本体由桥下发
    // （__sync_script），引导脚本只有 8 行、可逐行 echo 写入。
    await runLogged('cmd /c if exist C:\\InstantShare rd /s /q C:\\InstantShare')
    await runLogged('cmd /c md C:\\InstantShare')
    // 8 行 echo 合并成一条命令（行内无 &/|/( 等需转义字符），省 7 次 EXEC
    // 往返；引导脚本只负责下载同步脚本本体并落盘。
    await runLogged(
      'cmd /c (echo Set x=CreateObject("MSXML2.ServerXMLHTTP")&echo Set s=CreateObject("ADODB.Stream")&echo x.Open "GET","http://192.168.87.1/__sync_script",False&echo x.Send&echo s.Open&echo s.Type=1&echo s.Write x.responseBody&echo s.SaveAs "C:\\Tools\\share-sync.vbs",2&echo s.Close)>C:\\Tools\\share-boot.vbs',
    )
    // 同步本体可能超出 15s EXEC 窗口（大目录），截断无害——每个文件原子落盘，
    // 连跑三次幂等续完；失败行都进日志。
    await runLogged('cmd /c cscript //nologo C:\\Tools\\share-boot.vbs')
    await runLogged(
      'cmd /c cscript //nologo C:\\Tools\\share-sync.vbs >> C:\\Tools\\share-sync-run.txt 2>&1',
    )
    await runLogged(
      'cmd /c cscript //nologo C:\\Tools\\share-sync.vbs >> C:\\Tools\\share-sync-run.txt 2>&1',
    )
    // 登录会话脚本（Run 键，下次登录执行）：Enabled=1 时建目录 + subst 盘符 +
    // 后台续同步；Enabled=0 时解除盘符。注意 subst/盘符映射是登录会话私有的，
    // EXEC 在 session 0 里 subst 用户看不见，必须走登录脚本。
    await runLogged('cmd /c echo @echo off>C:\\Tools\\share-start.bat')
    await runLogged(
      'cmd /c echo reg query HKLM\\SOFTWARE\\InstantVM\\SharedFolder /v Enabled ^| findstr 0x1 ^>nul ^|^| goto off>>C:\\Tools\\share-start.bat',
    )
    await runLogged('cmd /c echo if not exist C:\\InstantShare md C:\\InstantShare>>C:\\Tools\\share-start.bat')
    await runLogged(
      `cmd /c echo subst ${driveValue}: /d ^>nul 2^>^&1>>C:\\Tools\\share-start.bat`,
    )
    await runLogged(
      `cmd /c echo subst ${driveValue}: C:\\InstantShare>>C:\\Tools\\share-start.bat`,
    )
    await runLogged(
      'cmd /c echo start "" /b cscript //nologo C:\\Tools\\share-sync.vbs>>C:\\Tools\\share-start.bat',
    )
    await runLogged('cmd /c echo exit /b>>C:\\Tools\\share-start.bat')
    await runLogged('cmd /c echo :off>>C:\\Tools\\share-start.bat')
    await runLogged(
      `cmd /c echo subst ${driveValue}: /d ^>nul 2^>^&1>>C:\\Tools\\share-start.bat`,
    )
    await runLogged('cmd /c echo exit /b>>C:\\Tools\\share-start.bat')
    await runLogged(
      'cmd /c reg add HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run /v InstantShare /t REG_SZ /d C:\\Tools\\share-start.bat /f',
    )
  }

  // Enabled/Seq 必须显式 /t REG_DWORD：agent 按 DWORD 读（sf_reg_read_dword），
  // reg add 不带 /t 默认写 REG_SZ，agent 在 Seq 这道门就零动作退出。
  // Seq 放最后：它一变 agent 就动手，必须意味着前面全部就绪。
  await addSharedFolderValue('/v Url', '/d http://instant-vm-files.local/ /f')
  await addSharedFolderValue('/v Drive', `/d ${driveValue}: /f`)
  await addSharedFolderValue('/v Enabled', `/t REG_DWORD /d ${enabled ? 1 : 0} /f`)
  // Date.now() 超出 DWORD 范围（≈42.9 亿），取模截进 32 位；agent 只要求 Seq 变化。
  await addSharedFolderValue('/v Seq', `/t REG_DWORD /d ${Date.now() % 0x100000000} /f`)

  return configOk
}
/** 宿主剪贴板轮询周期（推给客机的方向）；客机→宿主由客机侧 150ms 轮询自发上行。 */
const VM_CLIPBOARD_SYNC_POLL_MS = 1_000
/** 页面失焦时浏览器拒绝读写剪贴板；连续失败到该秒数才提示（首次失败属预期）。 */
const VM_CLIPBOARD_READ_WARN_AFTER_FAILURES = 5
/** 客机文本补写重试上限（1s 一次）；页面持续失焦超过则放弃并提示。 */
const VM_CLIPBOARD_WRITE_MAX_ATTEMPTS = 30
/** 「关机」（XP 软关机）命令发出后，等客机断电的最大时限；超时安静解锁，不提示不指挥。 */
const GUEST_SHUTDOWN_TIMEOUT_MS = 90_000
const GUEST_SHUTDOWN_SENT_HINT = '正在关机（客机完成后自动断电并写入磁盘）…'
// 不保存档：断电后只是写缓存/再问要不要写入，等待期不预告「写入磁盘」。
const GUEST_SHUTDOWN_SENT_NO_WRITE_HINT = '正在关机（客机完成后自动断电）…'

const DISPLAY_MODE_SEGMENTS: readonly { id: VmDisplayModeId; label: string }[] =
  VM_DISPLAY_MODE_IDS.map((id) => ({
    id,
    label: formatVmDisplayModeLabel(id),
  }))

type SettingsSession =
  | { mode: 'create'; initial: VirtualMachineSettings }
  | { mode: 'edit'; id: string; initial: VirtualMachineSettings }

function formatMachineMeta(machine: VirtualMachineRecord): string {
  const memory = formatVmMemoryLabel(machine.memoryMb)
  // 默认的「保存硬盘改动」不标（列表会全是噪音）；「不保存」会改语义，值得在列表上标出来。
  if (machine.diskWriteMode === DEFAULT_VIRTUAL_MACHINE_DISK_WRITE_MODE) {
    return memory
  }
  return `${memory} · ${formatVmDiskWriteModeLabel(machine.diskWriteMode)}`
}

function formatStatus(machine: VirtualMachineRecord | undefined, running: boolean): string {
  if (!machine) {
    return '未选择'
  }
  return `${running ? '运行中' : '已停止'} · ${formatVmBackendLabel(machine.backend)}`
}

function isVmHostTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  if (target.isContentEditable) {
    return true
  }
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

type VirtualMachineListProps = {
  machines: VirtualMachineRecord[]
  selectedId: string | undefined
  runningIds: readonly string[]
  startingIds: readonly string[]
  /** 关机收尾落盘中的机器：状态点显示黄色「写入中」。 */
  flushingIds: readonly string[]
  onFocus: (machineId: string) => void
  onOpenSettings: (machineId: string) => void
  /** 松手落位：fromIndex 行移到 toIndex（钥匙串同款插入位语义）。 */
  onMove: (fromIndex: number, toIndex: number) => void
}

function VirtualMachineList({
  machines,
  selectedId,
  runningIds,
  startingIds,
  flushingIds,
  onFocus,
  onOpenSettings,
  onMove,
}: VirtualMachineListProps) {
  // 拖拽会话（钥匙串同款）：按住行首手柄立即起拖，被拖行半透明留在原地，
  // 目标插入位显示指示线，松手才 onMove 落盘；列表边缘自动滚动。
  const isDraggingRef = useRef(false)
  const preventClickRef = useRef(false)
  const dragIndexRef = useRef<number | undefined>(undefined)
  const itemRefs = useRef<Map<number, HTMLElement>>(new Map())
  const [dragIndex, setDragIndex] = useState<number | undefined>(undefined)
  const [overIndex, setOverIndex] = useState<number | undefined>(undefined)
  const [gripActiveIndex, setGripActiveIndex] = useState<number | undefined>(
    undefined,
  )

  const resolveHoverIndex = useCallback(
    (clientY: number): number => {
      for (let i = 0; i < machines.length; i++) {
        const el = itemRefs.current.get(i)
        if (!el) continue
        const rect = el.getBoundingClientRect()
        if (clientY < rect.top + rect.height / 2) {
          return i
        }
      }
      return Math.max(0, machines.length - 1)
    },
    [machines.length],
  )

  const finishReorder = useCallback(
    (fromIndex: number | undefined, toIndex: number | undefined) => {
      setDragIndex(undefined)
      setOverIndex(undefined)
      setGripActiveIndex(undefined)
      isDraggingRef.current = false
      dragIndexRef.current = undefined

      if (fromIndex === undefined || toIndex === undefined) return
      onMove(fromIndex, toIndex)
    },
    [onMove],
  )

  const handleGripPointerDown = useCallback(
    (index: number, event: PointerEvent) => {
      if (event.button !== 0) return

      event.preventDefault()
      event.stopPropagation()

      const grip = event.currentTarget as HTMLElement
      isDraggingRef.current = true
      preventClickRef.current = false
      dragIndexRef.current = index
      setDragIndex(index)
      setGripActiveIndex(index)
      grip.setPointerCapture(event.pointerId)

      const EDGE_PX = 48
      const MAX_SCROLL_STEP = 28
      let scrollRaf = 0
      let lastClientY = event.clientY

      const findScrollParent = (from: HTMLElement | null): HTMLElement | null => {
        let node: HTMLElement | null = from
        while (node) {
          const style = getComputedStyle(node)
          const overflowY = style.overflowY
          if (
            (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
            node.scrollHeight > node.clientHeight + 1
          ) {
            return node
          }
          node = node.parentElement
        }
        return null
      }
      const scrollParent = findScrollParent(grip)

      const tickAutoScroll = () => {
        scrollRaf = 0
        if (dragIndexRef.current === undefined || !scrollParent) return
        const rect = scrollParent.getBoundingClientRect()
        const y = lastClientY
        let delta = 0
        if (y < rect.top + EDGE_PX) {
          const t = Math.min(1, (rect.top + EDGE_PX - y) / EDGE_PX)
          delta = -Math.ceil(MAX_SCROLL_STEP * t)
        } else if (y > rect.bottom - EDGE_PX) {
          const t = Math.min(1, (y - (rect.bottom - EDGE_PX)) / EDGE_PX)
          delta = Math.ceil(MAX_SCROLL_STEP * t)
        }
        if (delta !== 0) {
          scrollParent.scrollTop += delta
          preventClickRef.current = true
          const nextOver = resolveHoverIndex(lastClientY)
          setOverIndex((prev) => (prev === nextOver ? prev : nextOver))
          scrollRaf = requestAnimationFrame(tickAutoScroll)
        }
      }

      const onPointerMove = (moveEvent: PointerEvent) => {
        if (dragIndexRef.current === undefined) return
        lastClientY = moveEvent.clientY
        const nextOver = resolveHoverIndex(moveEvent.clientY)
        setOverIndex((prev) => {
          if (prev !== nextOver) {
            preventClickRef.current = true
          }
          return nextOver
        })
        if (scrollParent && scrollRaf === 0) {
          const rect = scrollParent.getBoundingClientRect()
          const y = moveEvent.clientY
          if (y < rect.top + EDGE_PX || y > rect.bottom - EDGE_PX) {
            scrollRaf = requestAnimationFrame(tickAutoScroll)
          }
        }
      }

      const onPointerEnd = (endEvent: PointerEvent) => {
        if (scrollRaf) cancelAnimationFrame(scrollRaf)
        scrollRaf = 0
        grip.releasePointerCapture(endEvent.pointerId)
        grip.removeEventListener('pointermove', onPointerMove)
        grip.removeEventListener('pointerup', onPointerEnd)
        grip.removeEventListener('pointercancel', onPointerEnd)

        const fromIndex = dragIndexRef.current
        const toIndex =
          fromIndex === undefined
            ? undefined
            : resolveHoverIndex(endEvent.clientY)
        if (
          fromIndex !== undefined &&
          toIndex !== undefined &&
          fromIndex !== toIndex
        ) {
          preventClickRef.current = true
        }
        finishReorder(fromIndex, toIndex)
      }

      grip.addEventListener('pointermove', onPointerMove)
      grip.addEventListener('pointerup', onPointerEnd)
      grip.addEventListener('pointercancel', onPointerEnd)
    },
    [finishReorder, resolveHoverIndex],
  )

  const handleRowClick = useCallback(
    (machineId: string) => {
      if (isDraggingRef.current || preventClickRef.current) {
        preventClickRef.current = false
        return
      }
      onFocus(machineId)
    },
    [onFocus],
  )

  return (
    <ul
      class={`virtual-machine__list${
        dragIndex !== undefined ? ' virtual-machine__list--reordering' : ''
      }`}
    >
      {machines.map((machine, index) => {
        const active = machine.id === selectedId
        const running = runningIds.includes(machine.id)
        const starting = startingIds.includes(machine.id)
        const flushing = flushingIds.includes(machine.id)
        const statusClass = flushing
          ? 'virtual-machine__status-dot virtual-machine__status-dot--flushing'
          : starting
            ? 'virtual-machine__status-dot virtual-machine__status-dot--starting'
            : running
              ? 'virtual-machine__status-dot virtual-machine__status-dot--running'
              : 'virtual-machine__status-dot'
        const statusLabel = flushing
          ? '写入中'
          : starting
            ? '启动中'
            : running
              ? '运行中'
              : '已停止'
        return (
          <li
            key={machine.id}
            ref={(el) => {
              if (el) {
                itemRefs.current.set(index, el)
              } else {
                itemRefs.current.delete(index)
              }
            }}
            class={
              'virtual-machine__row-slot' +
              (index === overIndex ? ' virtual-machine__row-slot--over' : '')
            }
          >
            <button
              type="button"
              class={
                'virtual-machine__row' +
                (active ? ' virtual-machine__row--active' : '') +
                (index === dragIndex ? ' virtual-machine__row--dragging' : '')
              }
              aria-current={active ? 'true' : undefined}
              onClick={() => handleRowClick(machine.id)}
              onDblClick={() => onOpenSettings(machine.id)}
            >
              <span
                class={`virtual-machine__grip${
                  index === gripActiveIndex ? ' virtual-machine__grip--active' : ''
                }`}
                aria-hidden="true"
                onPointerDown={(e) => handleGripPointerDown(index, e)}
              >
                <span class="virtual-machine__grip-line" />
                <span class="virtual-machine__grip-line" />
                <span class="virtual-machine__grip-line" />
              </span>
              <span class="virtual-machine__row-body">
                <span class="virtual-machine__row-name">
                  {machine.name}
                  <span class={statusClass} aria-label={statusLabel} />
                </span>
                <span class="virtual-machine__row-meta">
                  {formatMachineMeta(machine)}
                  {machine.diskWriteLoss ? (
                    // 列表上一眼能看出这台机器的硬盘可能不完整。
                    <span
                      class="virtual-machine__row-loss"
                      title="上次运行有硬盘改动没能保存，硬盘文件可能不完整"
                    >
                      硬盘可能不完整
                    </span>
                  ) : null}
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function formatFlushSpeed(bytesPerSec: number | undefined): string {
  if (bytesPerSec === undefined || !Number.isFinite(bytesPerSec) || bytesPerSec <= 0) {
    return '—'
  }
  return `${formatVmDiskBytes(bytesPerSec)}/s`
}

function formatFlushEta(pendingBytes: number | undefined, speedBytesPerSec: number | undefined): string {
  if (
    pendingBytes === undefined ||
    speedBytesPerSec === undefined ||
    !Number.isFinite(speedBytesPerSec) ||
    speedBytesPerSec <= 0
  ) {
    return '—'
  }
  const seconds = pendingBytes / speedBytesPerSec
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '—'
  }
  if (seconds < 60) {
    return `约 ${Math.max(1, Math.round(seconds))} 秒`
  }
  const minutes = seconds / 60
  if (minutes < 60) {
    return `约 ${Math.round(minutes)} 分钟`
  }
  return `约 ${(minutes / 60).toFixed(1)} 小时`
}

/**
 * 断电后写盘硬控画面：客机画面整块盖住（不可操作、看不到最后一帧），
 * 只显示正在写入的进度。写不进去也继续显示，不弹窗打断；放弃是唯一出口，
 * 点了还要再过一道模态确认。
 */
function VirtualMachineFlushScreen({
  machineName,
  stage,
  totalBytes,
  pendingBytes,
  speedBytesPerSec,
  stalledMs,
  onAbandon,
}: {
  machineName: string | undefined
  stage: VmFlushStage | undefined
  totalBytes: number | undefined
  pendingBytes: number | undefined
  speedBytesPerSec: number | undefined
  stalledMs: number | undefined
  onAbandon: () => void
}) {
  const percent =
    totalBytes !== undefined && pendingBytes !== undefined && totalBytes > 0
      ? Math.max(0, Math.min(100, (1 - pendingBytes / totalBytes) * 100))
      : undefined
  // 阶段文案说清当前在干哪一段：先把客机改动收进缓存，再合并进硬盘文件。
  const stageTitle =
    stage === 'guest' ? '正在接收客机改动' : stage === 'host' ? '正在写入硬盘文件' : '正在写入'
  const stalled = stalledMs !== undefined && stalledMs >= VM_FLUSH_STALL_THRESHOLD_MS
  return (
    <div class="virtual-machine__flush-screen" role="alert" aria-live="assertive">
      <div class="virtual-machine__flush-card">
        <p class="virtual-machine__flush-title">{stageTitle}</p>
        {machineName ? <p class="virtual-machine__flush-subtitle">{machineName}</p> : null}
        <Progress
          percent={percent ?? 0}
          indeterminate={percent === undefined}
          status="active"
          ariaLabel="写入进度"
        />
        <dl class="virtual-machine__flush-meta">
          <div>
            <dt>总量</dt>
            <dd>{totalBytes !== undefined ? formatVmDiskBytes(totalBytes) : '—'}</dd>
          </div>
          <div>
            <dt>剩余</dt>
            <dd>{pendingBytes !== undefined ? formatVmDiskBytes(pendingBytes) : '—'}</dd>
          </div>
          <div>
            <dt>速度</dt>
            <dd>{formatFlushSpeed(speedBytesPerSec)}</dd>
          </div>
          <div>
            <dt>剩余时间</dt>
            <dd>{formatFlushEta(pendingBytes, speedBytesPerSec)}</dd>
          </div>
        </dl>
        <p class="virtual-machine__flush-note">
          完成前请勿关闭本窗口。{stalled ? '仍在写入（等待磁盘回应）。' : ''}
        </p>
        <div class="virtual-machine__flush-actions">
          <Button tone="danger" onClick={onAbandon}>
            放弃
          </Button>
        </div>
      </div>
    </div>
  )
}

export function VirtualMachineApp({ windowId }: { windowId?: string }) {
  const { activeWindowId, toggleFullscreen, windows } = useOs()
  const isActiveWindow = windowId === undefined || windowId === activeWindowId
  // 「视图 > 全屏」作用于本窗口；windowId 缺省时退回当前活动窗口。
  const ownWindowId = windowId ?? activeWindowId
  const vmWindowFullscreen =
    ownWindowId !== undefined &&
    windows.find((window) => window.id === ownWindowId)?.fullscreen === true
  const modal = useWindowModal()
  const hud = useHud()
  const skipDiskWriteLossPromptIdsRef = useRef(new Set<string>())
  const promptedDiskWriteLossKeyRef = useRef<string | undefined>(undefined)
  const runtimeOrigin = getVmRuntimeOrigin()
  const pool = useVirtualMachineRuntimePool(runtimeOrigin, {
    // 硬盘回写类警告升级为弹窗：右上角小字没人看，关键事件必须打断
    onDiskWriteIncomplete: () => {
      void modal.alert({
        title: '关机落盘未完成',
        message: DISK_IMAGE_INCOMPLETE_HINT,
        themeColor: THEME,
      })
    },
    onDiskWriteDirty: (_id, detail) => {
      void modal.alert({
        title: '关机写入不完整',
        message: `关机收尾时有 ${detail.discardedWrites} 条磁盘写入未能写入镜像，镜像可能不一致。建议重新开机让系统自检修复，修复前请勿直接使用或导出该镜像。`,
        themeColor: THEME,
      })
    },
    // 「镜像可能不完整」不能只在丢的那一刻弹一次：iframe 一销毁、标签页一关，这个事实
    // 就没了。写进机器记录，用户下次开机还能看见，直到他确认处理过。
    onDiskWriteLoss: (id, detail) => {
      skipDiskWriteLossPromptIdsRef.current.add(id)
      void setVirtualMachineDiskWriteLoss(id, { at: Date.now(), ...detail })
    },
    // 不保存档：断电后缓存落稳才走到这里。确认真的不保存才删缓存；
    // 关掉对话框/按 Esc 一律按「写入硬盘文件」处理，不替用户丢数据。
    onDiskCacheDecision: async (id) => {
      const machineName = machinesRef.current.find((machine) => machine.id === id)?.name
      const answer = await modal.choose({
        title: '写入硬盘文件？',
        message: `${
          machineName ? `「${machineName}」` : '这台虚拟机'
        }这次开机的改动还在缓存里。不保存会删掉缓存，硬盘文件保持原来的内容。`,
        options: [
          { key: 'discard', label: '不保存', tone: 'danger' },
          { key: 'merge', label: '写入硬盘文件', tone: 'primary' },
        ],
        themeColor: THEME,
      })
      return answer?.key === 'discard' ? 'discard' : 'merge'
    },
  })
  const [machines, setMachines] = useState<VirtualMachineRecord[]>([])
  // pool 的回调（弹窗决策）要读最新机器表，不能依赖渲染闭包。
  const machinesRef = useRef<VirtualMachineRecord[]>([])
  machinesRef.current = machines
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const [powerBusy, setPowerBusy] = useState(false)
  const [powerHint, setPowerHint] = useState<string | undefined>(undefined)
  /** 客机关机命令已发出、正等客机断电的时间点；null = 无待收口的关机。 */
  const guestShutdownAtRef = useRef<number | null>(null)
  /** 软关机进行中（命令已送达、客机尚未断电）。是 state 而非只读 ref：
   *  兜底解锁 effect 必须靠它触发重跑，否则 ref 赋值不会让 90 秒 setTimeout 被安排。 */
  const [awaitingGuestShutdown, setAwaitingGuestShutdown] = useState(false)
  const selected = useMemo(
    () => machines.find((machine) => machine.id === selectedId),
    [machines, selectedId],
  )
  // 启动中的机器 id：列表状态点橙色脉冲。
  const startingIds = useMemo(
    () =>
      pool.runningIds.filter((id) => {
        const snapshot = pool.snapshots.get(id)
        return snapshot !== undefined && !snapshot.ready
      }),
    [pool.runningIds, pool.snapshots],
  )
  const selectedRunning = Boolean(selected && pool.runningIds.includes(selected.id))
  // 运行时存活：true=已就绪；false=未响应；undefined=探测中。
  // 点开机之前 iframe 还不存在，没人能发 postMessage，只能由宿主发请求确认。
  const [runtimeAlive, setRuntimeAlive] = useState<boolean | undefined>(undefined)
  const runtimeAliveRef = useRef<boolean | undefined>(undefined)
  const [ready, setReady] = useState(false)
  const [settingsSession, setSettingsSession] = useState<SettingsSession | undefined>(undefined)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [guestKeyboardArmed, setGuestKeyboardArmed] = useState(false)
  const { hostRef: narrowHostRef } = useAppNarrowLayout()
  const keyboardSinkRef = useRef<HTMLDivElement>(null)
  const settingsOpenRef = useRef(false)
  const inspectorOpenRef = useRef(false)
  const stealFocusTokenRef = useRef(0)

  const applyStore = useCallback((next: VirtualMachineRecord[], preferredId?: string) => {
    setMachines(next)
    setSelectedId((current) => {
      if (current && next.some((machine) => machine.id === current)) {
        return current
      }
      // 没有有效选中时优先恢复「上一次选中的机器」（打开 App / 选中机器被删后的回落）。
      if (preferredId && next.some((machine) => machine.id === preferredId)) {
        return preferredId
      }
      return next[0]?.id
    })
    setReady(true)
  }, [])

  useEffect(() => {
    let cancelled = false
    const refresh = () => {
      void readVirtualMachineStore().then((store) => {
        if (!cancelled) {
          applyStore(store.machines, store.lastSelectedId)
        }
      })
    }
    refresh()
    const unsubscribe = subscribeVirtualMachineStore(refresh)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [applyStore])

  useEffect(() => {
    if (!powerHint || powerBusy) {
      return
    }
    const timer = window.setTimeout(() => setPowerHint(undefined), POWER_HINT_MS)
    return () => window.clearTimeout(timer)
  }, [powerBusy, powerHint])

  // 客机关机收口：命令已发出的状态下，runningIds 移除（onGuestPoweredOff →
  // 切电 → 写回落盘完成）即解锁；超时未断电则安静解锁——系统没关成用户自己
  // 看得见屏幕，不需要宿主提示原因或指挥下一步，按钮恢复可用即可。
  useEffect(() => {
    if (!selectedRunning) {
      guestShutdownAtRef.current = null
      setPowerBusy(false)
      setAwaitingGuestShutdown(false)
      setPowerHint(undefined)
      return
    }
    if (guestShutdownAtRef.current === null) {
      return
    }
    const timer = window.setTimeout(() => {
      guestShutdownAtRef.current = null
      setPowerBusy(false)
      setAwaitingGuestShutdown(false)
      // 不提示：用户自己会看到机器仍在运行。
      setPowerHint(undefined)
    }, GUEST_SHUTDOWN_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
    // awaitingGuestShutdown 必须在依赖里：它是唯一会因「发出关机命令」而变化的值，
    // 少了它这条超时兜底就永远不会被安排（powerBusy/ref 都不触发 effect 重跑）。
  }, [selectedRunning, awaitingGuestShutdown])

  // 运行时存活探测：未就绪期间每 2 秒重试，服务器慢启动也能自动恢复为可点；
  // 一旦就绪就停止重试（正常运行零后台流量），只在窗口聚焦时复查一次。
  const probeRuntimeAlive = useCallback(async (): Promise<boolean> => {
    if (!runtimeOrigin) {
      return false
    }
    try {
      await fetch(runtimeOrigin, {
        mode: 'no-cors',
        cache: 'no-store',
        signal: AbortSignal.timeout(4_000),
      })
      runtimeAliveRef.current = true
      setRuntimeAlive(true)
      return true
    } catch {
      runtimeAliveRef.current = false
      setRuntimeAlive(false)
      return false
    }
  }, [runtimeOrigin])

  useEffect(() => {
    runtimeAliveRef.current = undefined
    setRuntimeAlive(undefined)
    let cancelled = false
    let inFlight = false
    const probe = () => {
      if (inFlight) {
        return
      }
      inFlight = true
      void probeRuntimeAlive().finally(() => {
        inFlight = false
      })
    }
    probe()
    const interval = window.setInterval(() => {
      if (!cancelled && runtimeAliveRef.current !== true) {
        probe()
      }
    }, 2_000)
    const onFocus = () => probe()
    window.addEventListener('focus', onFocus)
    return () => {
      cancelled = true
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [probeRuntimeAlive])

  const selectedBackend = selected ? getVmBackend(selected.backend) : undefined
  const runningMachines = useMemo(
    () => machines.filter((machine) => pool.runningIds.includes(machine.id)),
    [machines, pool.runningIds],
  )
  // 只陈述事实的提示，不带「请启动」之类的操作指令；只在屏幕中央显示，不进顶部工具栏。
  const runtimeUnreachableHint = `虚拟机运行时未响应（${runtimeOrigin}）`
  const selectedHint = selected ? pool.hints.get(selected.id) : undefined
  const [agentLink, setAgentLink] = useState<'off' | 'command' | 'full'>('off')
  // 客机 agent 产品版本（PONG ver= 字段，状态灯展示用）：现场区分镜像里的
  // exe 是否支持某个协议特性（如 v5 起的吸附触发距离帧）。
  const [agentVersion, setAgentVersion] = useState<number | null>(null)
  // 吸附配置镜像：轮询定义在设置派生值之前，轮询周期里经 ref 读最新值顺带下发。
  const snapPushRef = useRef<{ enabled: boolean; edgePx: number }>({
    enabled: true,
    edgePx: VM_SNAP_EDGE_PX_DEFAULT,
  })

  // 现场连通验证：补一刀 PING，等一个串口往返的余量后重读 state，以新鲜的
  // lastPongAgeMs 为准。后台标签页节流会把 PING 拖过期，状态灯 off 里大量是
  // 这种假掉线；真断（agent 进程没了）不会有新 PONG，读数依旧过期。
  const verifyAgentAlive = useCallback(
    async (machineId: string): Promise<boolean> => {
      try {
        await pool.agentCommand(machineId, 'ping')
        await new Promise((resolve) => {
          window.setTimeout(resolve, VM_AGENT_PONG_RECHECK_DELAY_MS)
        })
        const state = (await pool.agentCommand(machineId, 'state')) as
          | { lastPongAgeMs?: number | null; shmBase?: number | null; agentVersion?: number | null }
          | undefined
        const commandOk =
          typeof state?.lastPongAgeMs === 'number' &&
          state.lastPongAgeMs < VM_AGENT_PONG_MAX_AGE_MS
        if (!document.hidden) {
          const mailboxOk = typeof state?.shmBase === 'number' && state.shmBase > 0
          setAgentLink(!commandOk ? 'off' : mailboxOk ? 'full' : 'command')
          setAgentVersion(typeof state?.agentVersion === 'number' ? state.agentVersion : null)
        }
        return commandOk
      } catch {
        return false
      }
    },
    [pool.agentCommand],
  )

  // agent 连通探测：轮询 __vm.state()。两条链独立判定——串口命令链看
  // lastPongAgeMs（PING→PONG），剪贴板信箱看 shmBase（SHM= 握手）；
  // 只亮命令链也要如实显示，否则信箱半通/全断会被误读成全通。
  useEffect(() => {
    setAgentLink('off')
    if (!selectedId || !selectedRunning) {
      return
    }
    let cancelled = false
    let timer = 0
    let checking = false
    // 隐藏期间 setTimeout 被浏览器节流，PING→PONG 读数必然失真，据其降级只会
    // 制造「切回来变未连接」的假象；读数照刷，状态只在可见时更新。
    const applyState = (
      state: {
        lastPongAgeMs?: number | null
        shmBase?: number | null
        agentVersion?: number | null
      } | undefined,
    ) => {
      if (cancelled || document.hidden) {
        return
      }
      const commandOk =
        typeof state?.lastPongAgeMs === 'number' &&
        state.lastPongAgeMs < VM_AGENT_PONG_MAX_AGE_MS
      const mailboxOk = typeof state?.shmBase === 'number' && state.shmBase > 0
      setAgentLink(!commandOk ? 'off' : mailboxOk ? 'full' : 'command')
      setAgentVersion(typeof state?.agentVersion === 'number' ? state.agentVersion : null)
    }
    const check = async () => {
      if (checking) {
        return
      }
      checking = true
      try {
        const state = (await pool.agentCommand(selectedId, 'state')) as
          | { lastPongAgeMs?: number | null; shmBase?: number | null; agentVersion?: number | null }
          | undefined
        const commandOk =
          typeof state?.lastPongAgeMs === 'number' &&
          state.lastPongAgeMs < VM_AGENT_PONG_MAX_AGE_MS
        if (commandOk) {
          // 顺带把窗口吸附配置推下去：agent 刚就绪或上一帧丢失（改设置时
          // agent 未就绪被吞）时，≤一个轮询周期自动收敛。帧幂等，每周期
          // 10 字节串口流量可忽略。
          void pool
            .agentCommand(selectedId, 'snap', [
              snapPushRef.current.enabled,
              snapPushRef.current.edgePx,
            ])
            .catch(() => {})
        }
        if (commandOk || document.hidden) {
          applyState(state)
        } else if (!cancelled) {
          // 可见却 pong 过期，多半是刚切回页面：现场补一刀尽快翻正，
          // 不必等下个轮询周期。
          await verifyAgentAlive(selectedId)
        }
      } catch {
        // state 调用本身挂了（运行时不可达）才算真失联；隐藏期间不降级。
        if (!cancelled && !document.hidden) {
          setAgentLink('off')
          setAgentVersion(null)
        }
      } finally {
        checking = false
      }
      if (!cancelled) {
        window.clearTimeout(timer)
        timer = window.setTimeout(() => {
          void check()
        }, VM_AGENT_POLL_MS)
      }
    }
    // 切回标签页/窗口聚焦立即复查并顺延下个周期：等 5s 定时器自然触发的话，
    // 用户头几秒的点关机会被过期状态误拦。
    const poke = () => {
      if (cancelled || checking) {
        return
      }
      window.clearTimeout(timer)
      void check()
    }
    const onVisible = () => {
      if (!document.hidden) {
        poke()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', poke)
    void check()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', poke)
    }
  }, [pool.agentCommand, selectedId, selectedRunning, verifyAgentAlive])

  const agentVersionSuffix = agentVersion !== null ? ` · agent v${agentVersion}` : ''
  const selectedFlushing =
    selectedId !== undefined && pool.flushingIds.includes(selectedId)
  const statusHint =
    selectedFlushing
      ? '正在写入虚拟磁盘，完成前请勿关闭页面…'
      : powerHint ??
        selectedHint ??
        (agentLink === 'full'
          ? `体验已增强${agentVersionSuffix}`
          : agentLink === 'command'
            ? `体验已增强${agentVersionSuffix} · 剪贴板信箱未就绪`
            : undefined)
  const hasSelection = selected !== undefined
  const settingsOpen = settingsSession !== undefined
  settingsOpenRef.current = settingsOpen
  inspectorOpenRef.current = inspectorOpen
  // 开机按钮只看运行时就绪状态：探测中 / 未响应都不可点。
  const canStart = Boolean(
    hasSelection &&
      !powerBusy &&
      !selectedRunning &&
      selectedBackend?.available &&
      Boolean(runtimeOrigin) &&
      runtimeAlive === true,
  )
  const canStop = Boolean(hasSelection && selectedRunning && !powerBusy && !selectedFlushing)
  const canReset = canStop
  // 电源动作按预设静态判定是否支持 Agent（优雅关机），不随心跳翻转：
  // Agent 瞬时失联时按钮不会变「断电」，点关机走现场验证护栏。
  const selectedAgentCapable = selected
    ? VM_OS_PRESET_AGENT_SUPPORTED[selected.osPreset]
    : true

  const showVmError = useCallback(
    (message: string, title = '虚拟机错误') => {
      void modal.alert({ title, message, themeColor: THEME })
    },
    [modal],
  )

  const displayedId = pickDisplayedMachineId(selected?.id, pool.runningIds)
  // 关机收尾落盘中的机器：整块屏幕换成「正在写入」硬控画面（客机不可见、不可操作），
  // 占用声明到写完才释放。
  const displayedFlushing = displayedId !== undefined && pool.flushingIds.includes(displayedId)
  // 软关机进行中（命令已送达、客机尚未断电）：整段窗口也要有覆盖层。
  // 这段可能持续一段时间（客机自己关机 + 差量合并进镜像），此前界面
  // 只有一行小字、按钮还被禁用，用户会误判为「没反应」而去找手动断电。
  const displayedShutdownPending =
    awaitingGuestShutdown && displayedId !== undefined && displayedId === selected?.id
  // 软关机等待期文案按档位说话：不保存档此时不能预告「会写入硬盘」。
  const displayedShutdownMode = selected?.diskWriteMode
  const [flushProgress, setFlushProgress] = useState<VmFlushProgress | undefined>(undefined)
  useEffect(() => {
    if (displayedId === undefined || !pool.flushingIds.includes(displayedId)) {
      setFlushProgress(undefined)
      return
    }
    let cancelled = false
    // 阶段感知跟踪器：drain 期看 VM 侧真实递减的 pendingBytes（宿主缓存等量增长，
    // 看宿主侧只会恒 0%），drain 完成后看宿主侧 merge 基准。基准在 tracker 里钉住，
    // 切到别的机器再切回由宿主层记录兜底，进度不会从 0 重新爬。
    const track = createVmFlushProgressTracker()
    const poll = () => {
      const { pendingBytes, totalBytes } = getVirtualMachineDiskFlushProgress(
        listVmDiskStreamIds(pool.startMessages.get(displayedId)),
      )
      const guestPendingBytes = pool.latestStats(displayedId)?.diskWrite?.pendingBytes
      if (cancelled) return
      setFlushProgress(
        track({
          nowMs: Date.now(),
          guestPendingBytes,
          hostPendingBytes: pendingBytes,
          hostTotalBytes: totalBytes,
        }),
      )
    }
    poll()
    const timer = window.setInterval(poll, 500)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [displayedId, pool.flushingIds, pool.startMessages, pool.latestStats])
  useEffect(() => {
    // 写盘硬控由全屏画面承担，不再叠一张「正在写入硬盘」的小卡片。
    if (displayedShutdownPending) {
      hud.show({
        mode: 'spinner',
        text: '正在关机',
        detail: displayedShutdownMode === 'none' ? '正在等待客机断电' : '完成后会写入硬盘',
      })
      return
    }
    hud.hide()
  }, [displayedShutdownPending, displayedShutdownMode, hud.show, hud.hide])
  // 所有在跑机器里尚未交给宿主差量层的在途字节。已经写入差量的部分关页面也不会丢。
  const unflushedDiskBytes = useMemo(() => {
    const snapshots: (InstantVmStatsSnapshot | undefined)[] = []
    for (const id of pool.runningIds) {
      snapshots.push(pool.snapshots.get(id)?.stats)
    }
    return totalUnflushedDiskBytes(snapshots)
  }, [pool.runningIds, pool.snapshots])
  // 关机合并或刷差量期间拦一下页面关闭：浏览器无法保证异步收尾完成，至少给用户反悔机会。
  // 软关机等待期同样要拦。运行期只拦尚未写入差量的在途批次。
  useEffect(() => {
    if (
      !shouldGuardVmUnload({
        flushing: pool.flushingIds.length > 0,
        awaitingGuestShutdown,
        unflushedBytes: unflushedDiskBytes,
      })
    ) {
      return
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [pool.flushingIds, awaitingGuestShutdown, unflushedDiskBytes])
  // 窗口被关闭/强制结束时组件直接卸载：把还在跑的机器收口（丢未写完、释放占用），
  // 否则占用声明悬空，别的窗口永远开不了同一块盘。收口是异步的，卸载后照跑。
  const poolRef = useRef(pool)
  poolRef.current = pool
  const runningIdsForCleanupRef = useRef<readonly string[]>([])
  runningIdsForCleanupRef.current = pool.runningIds
  useEffect(
    () => () => {
      for (const id of runningIdsForCleanupRef.current) {
        void poolRef.current.forceStop(id)
      }
    },
    [],
  )
  // 正常关闭前回答系统能否结束：写盘硬控中回答「不能结束」（画面已经是
  // 「正在写入」，默认不再叠一句）；其余情况回答「结束」——关窗直接卸载，
  // 上面已有的 cleanup effect 会把运行中的机器 forceStop 收口，无需在此等待。
  useWindowCloseHandler(windowId, async () => {
    if (pool.flushingIds.length > 0) return 'cannot-finish'
    return 'finish'
  })
  // 强制结束 = 与硬控「放弃」同类：关窗动画开始前先丢掉每台在跑机器未写完的
  // 改动（不保存档也不再弹「写入硬盘文件？」）。fire-and-forget；卸载 cleanup
  // 的 forceStop 只按档位收口（正常关窗不丢缓存），abandon 标记在这里先打上。
  useWindowForceCloseHandler(windowId, () => {
    for (const id of runningIdsForCleanupRef.current) {
      void poolRef.current.abandonWrites(id).catch(() => undefined)
    }
  })
  const selectedSnapshot = pool.snapshots.get(selectedId ?? '')
  const selectedDiskStreamIds = listVmDiskStreamIds(
    selectedId ? pool.startMessages.get(selectedId) : undefined,
  )
  const displayedBusy = Boolean(
    displayedId !== undefined && selectedSnapshot && !selectedSnapshot.ready,
  )
  const showFlushHud = displayedFlushing || displayedShutdownPending
  const diskWriteLossPromptKey =
    selected?.id && selected.diskWriteLoss ? `${selected.id}:${selected.diskWriteLoss.at}` : undefined
  useEffect(() => {
    const selectedIdNow = selectedId
    return () => {
      if (selectedIdNow) {
        skipDiskWriteLossPromptIdsRef.current.delete(selectedIdNow)
      }
    }
  }, [selectedId])
  useEffect(() => {
    if (showFlushHud) {
      return
    }
    const id = selected?.id
    const loss = selected?.diskWriteLoss
    if (!id || !loss || !diskWriteLossPromptKey) {
      return
    }
    if (skipDiskWriteLossPromptIdsRef.current.has(id)) {
      return
    }
    if (promptedDiskWriteLossKeyRef.current === diskWriteLossPromptKey) {
      return
    }
    promptedDiskWriteLossKeyRef.current = diskWriteLossPromptKey
    const diskPath = selected?.devices.find((device) => device.type === 'hdd' && device.path.trim())
      ?.path
    void modal
      .confirm({
        title: '硬盘文件可能不完整',
        message: vmDiskWriteLossText(loss),
        confirmLabel: '急救',
        cancelLabel: '知道了',
        themeColor: THEME,
      })
      .then((goFirstAid) => {
        void setVirtualMachineDiskWriteLoss(id, undefined)
        recordSystemDebugTimeline({
          layer: 'vm',
          op: 'disk-write-loss-dismissed',
          detail: id,
        })
        const path = diskPath?.trim()
        if (goFirstAid && path) {
          openDiskUtilityFirstAid(path)
        }
      })
  }, [diskWriteLossPromptKey, modal, selected?.devices, selected?.diskWriteLoss, selected?.id, showFlushHud])
  // 发送按键始终发给当前显示的画面，有运行中的画面就可用。
  const canSendKeys = displayedId !== undefined

  // 按键映射：翻译器只服务当前显示的画面；设置保存后经 store 刷新自动生效（含运行中）。
  const keyTranslatorRef = useRef(new VmKeyboardTranslator())
  const displayedMachine = machines.find((machine) => machine.id === displayedId)
  // 体验增强开关：只控制宿主这一侧要不要参与（未配置时按开处理）；
  // 客机系统选「不启用增强」时各子项一律视为关。
  const enhanceActive = (displayedMachine?.osPreset ?? 'windows-xp') !== 'none'
  const enhanceClipboard = enhanceActive && (displayedMachine?.enhanceClipboard ?? true)
  const enhanceFileTransfer = enhanceActive && (displayedMachine?.enhanceFileTransfer ?? true)
  // 窗口吸附与其它增强不同：开关与触发距离必须下发客机（钩子挂/卸在那边），
  // 所以运行中经 agentCommand 实时推 OP_SNAP/OP_SNAP_EDGE 帧；未运行只存设置。
  // 设置变更立即推一帧（即时反馈）；agent 未就绪时失败被吞也不要紧——轮询
  // 周期（5s）里检测到 agent 活着就会顺带补发同款配置，自动收敛。
  const enhanceWindowSnap = enhanceActive && (displayedMachine?.enhanceWindowSnap ?? true)
  const enhanceWindowSnapEdgePx =
    displayedMachine?.enhanceWindowSnapEdgePx ?? VM_SNAP_EDGE_PX_DEFAULT
  snapPushRef.current = { enabled: enhanceWindowSnap, edgePx: enhanceWindowSnapEdgePx }
  useEffect(() => {
    if (displayedId === undefined || !selectedRunning) {
      return
    }
    void pool
      .agentCommand(displayedId, 'snap', [enhanceWindowSnap, enhanceWindowSnapEdgePx])
      .catch(() => {})
  }, [displayedId, enhanceWindowSnap, enhanceWindowSnapEdgePx, selectedRunning, pool.agentCommand])
  // 共享文件夹：宿主根 + 运行时拦截器热开关跟随当前显示的虚拟机；客机侧映射
  // 由 agent 启动自愈 + 设置变更时的 EXEC 配置负责。WebDAV 宿主根是全局
  // 单例，多机同时运行时按当前显示机生效（v1 语义）。
  const sharedFolderActive =
    (displayedMachine ? isSharedFolderActive(displayedMachine) : false) &&
    (displayedMachine?.sharedFolderPath ?? '').startsWith('/')
  const sharedFolderPath = displayedMachine?.sharedFolderPath ?? ''
  useEffect(() => {
    setWebdavSharedRoot(sharedFolderActive ? sharedFolderPath : undefined)
    if (displayedId === undefined || !selectedRunning) {
      return
    }
    void pool.setSharedFolder(displayedId, sharedFolderActive).catch(() => {})
  }, [displayedId, selectedRunning, sharedFolderActive, sharedFolderPath, pool])
  // 共享文件夹开机重推：guest 注册表配置是易失的（硬盘写入「不写入」时重启
  // 即蒸发），agent 的启动自愈只在配置还在时有效。每次开机、agent 命令链
  // 就绪（PONG 新鲜）后宿主重推一遍——幂等（Seq bump 后 agent 无操作收敛）。
  // 无论开关状态都推：connected=false / 能力关了也要下写 Enabled=0，压掉
  // guest 里持久化的旧 Enabled=1，否则开机自愈会把已断开的映射重新挂上。
  const sharedFolderBootPushedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!selectedId) {
      return
    }
    if (!selectedRunning) {
      // 停机清标记，下次开机重推。
      sharedFolderBootPushedRef.current.delete(selectedId)
      return
    }
    if (agentLink === 'off' || !selected) {
      return
    }
    if (sharedFolderBootPushedRef.current.has(selectedId)) {
      return
    }
    // 只有全部关键配置确认落盘才算推完；EXEC 命令链当时没就绪/被吞就隔几秒
    // 重推，上限兜底——之前是一次尝试失败就静默丢弃，整个会话都没盘符。
    let cancelled = false
    let attempts = 0
    const attempt = () => {
      if (cancelled || sharedFolderBootPushedRef.current.has(selectedId)) {
        return
      }
      attempts += 1
      void pushSharedFolderGuestConfig(
        isSharedFolderActive(selected),
        (command) => pool.agentCommand(selectedId, 'execResult', [command]),
        selected.sharedFolderDrive,
      ).then((ok) => {
        if (cancelled) {
          return
        }
        if (ok) {
          sharedFolderBootPushedRef.current.add(selectedId)
        } else if (attempts < VM_SHARED_FOLDER_PUSH_MAX_ATTEMPTS) {
          window.setTimeout(attempt, VM_SHARED_FOLDER_PUSH_RETRY_MS)
        }
      })
    }
    attempt()
    return () => {
      cancelled = true
    }
  }, [agentLink, pool.agentCommand, selected, selectedId, selectedRunning])
  useEffect(() => {
    keyTranslatorRef.current.setKeymap(
      compileVmKeyMappings(
        displayedMachine && displayedMachine.keyMappingEnabled
          ? displayedMachine.keyMappings
          : undefined,
      ),
    )
  }, [displayedMachine?.keyMappingEnabled, displayedMachine?.keyMappings])

  // #region 剪贴板双向同步（ivm-shm 信箱；todo/vm-remote-control）
  // 只同步当前显示的虚拟机：多机并发时背景机不应悄悄改写宿主剪贴板。
  const clipboardSyncRef = useRef(createVmClipboardSyncState())
  /** 客机→宿主写失败待补的文本（页面失焦被拒时排队，聚焦后补写）。 */
  const clipboardPendingWriteRef = useRef<{ text: string; attempts: number } | null>(null)
  useEffect(() => {
    // 切换显示目标 = 换了剪贴板域：清空回声指纹，避免旧文本被误判。
    clipboardSyncRef.current = createVmClipboardSyncState()
    clipboardPendingWriteRef.current = null
  }, [displayedId])

  useEffect(() => {
    if (displayedId === undefined) {
      return
    }
    let cancelled = false
    let readFailures = 0
    const tick = async () => {
      if (cancelled) {
        return
      }
      // 「体验增强」关掉剪贴板同步：宿主这侧完全不读不写。
      if (!enhanceClipboard) {
        return
      }
      // 失败补写：客机文本曾因页面失焦写不进系统剪贴板，聚焦恢复后 1s 内补上。
      const pending = clipboardPendingWriteRef.current
      if (pending !== null) {
        try {
          await navigator.clipboard?.writeText(pending.text)
          if (!cancelled) {
            console.info(
              '[vm-clipboard] 宿主: 补写成功',
              JSON.stringify(pending.text.slice(0, 60)),
              `(第 ${pending.attempts + 1} 次尝试)`,
            )
            if (clipboardPendingWriteRef.current === pending) {
              clipboardPendingWriteRef.current = null
            }
          }
        } catch {
          pending.attempts += 1
          if (!cancelled && pending.attempts >= VM_CLIPBOARD_WRITE_MAX_ATTEMPTS) {
            clipboardPendingWriteRef.current = null
            console.warn('[vm] 客机剪贴板文本补写放弃（页面持续失焦）：', JSON.stringify(pending.text))
          }
        }
      }
      try {
        const hostText = await navigator.clipboard?.readText()
        if (cancelled || hostText === undefined) {
          return
        }
        readFailures = 0
        const push = onHostClipboardChanged(clipboardSyncRef.current, hostText)
        if (push !== null) {
          const guestPush = normalizeHostClipboardTextForGuest(push)
          console.info(
            `[vm-clipboard] 宿主: 剪贴板变化，推向客机(${guestPush.length}字符) ${JSON.stringify(guestPush.slice(0, 60))}`,
          )
          void pool
            .agentCommand(displayedId, 'clipboardWrite', [guestPush])
            .catch(() => {})
        }
      } catch {
        // 页面失焦期间浏览器拒绝访问剪贴板属预期，聚焦后下一秒自愈；
        // 只在持续失败时提示一次，避免「权限被拒」与「暂时失焦」无法区分。
        readFailures += 1
        if (!cancelled && readFailures === VM_CLIPBOARD_READ_WARN_AFTER_FAILURES) {
          console.warn(
            '[vm] 宿主剪贴板连续读取失败——页面失焦期间属预期会自愈；若聚焦后仍出现，检查浏览器剪贴板权限',
          )
        }
      }
    }
    const timer = window.setInterval(() => void tick(), VM_CLIPBOARD_SYNC_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [displayedId, enhanceClipboard, pool.agentCommand])

  const handleGuestClipboard = useCallback(
    (machineId: string, text: string) => {
      if (machineId !== displayedId) {
        console.info(
          `[vm-clipboard] 宿主: 文本来自 ${machineId}，当前显示 ${displayedId ?? '无'}，忽略`,
        )
        return
      }
      if (!enhanceClipboard) {
        return
      }
      const write = onGuestClipboardReceived(
        clipboardSyncRef.current,
        normalizeGuestClipboardText(text),
      )
      if (write === null) {
        console.info(
          '[vm-clipboard] 宿主: 重复/回声/空文本，跳过写入',
          JSON.stringify(text.slice(0, 60)),
        )
        return
      }
      console.info(
        `[vm-clipboard] 宿主: 待写系统剪贴板(${write.length}字符) ${JSON.stringify(write.slice(0, 60))}`,
      )
      // 入补写队列再立即试一次：聚焦时 ~350ms 内落进系统剪贴板；页面失焦
      // 被拒属预期（用户正切去外部应用），由轮询 tick 持续补写直到成功。
      const entry = { text: write, attempts: 0 }
      clipboardPendingWriteRef.current = entry
      navigator.clipboard?.writeText(write).then(
        () => {
          // 立即写入已成功：清掉队列，防止 tick 再补写一遍。
          if (clipboardPendingWriteRef.current === entry) {
            clipboardPendingWriteRef.current = null
          }
          console.info('[vm-clipboard] 宿主: writeText 成功')
        },
        (error: unknown) =>
          console.info(
            '[vm-clipboard] 宿主: writeText 首次失败（已入补写队列，聚焦后自动补）:',
            error instanceof Error ? error.message : String(error),
          ),
      )
    },
    [displayedId, enhanceClipboard],
  )

  /** 文件通道上行（offer/data/req/done）：按显示机器过滤后交给传输服务。 */
  const handleGuestFileEvent = useCallback(
    (machineId: string, event: VmGuestFileEvent) => {
      if (machineId !== displayedId) {
        return
      }
      // 「体验增强」关掉文件互传：客机主动推来的文件事件一律不接。
      if (!enhanceFileTransfer) {
        return
      }
      handleVmFileEvent(event)
    },
    [displayedId, enhanceFileTransfer],
  )

  /**
   * iframe 抢到焦点时真实按键经此回宿主：与 armed 路径共用同一个翻译器，
   * 按键映射在两条路上行为一致。仅当前显示的机器接（背景机 iframe 拿不到焦点）。
   */
  const handleNativeKey = useCallback(
    (machineId: string, message: InstantVmNativeKeyMessage) => {
      if (machineId !== displayedId) {
        return
      }
      pool.sendKeyboard(machineId, keyTranslatorRef.current.translate(message, message.phase))
    },
    [displayedId, pool.sendKeyboard],
  )

  // 传输服务后端随显示机器切换注册/注销（文件APP 经此调用当前虚拟机）。
  useEffect(() => {
    registerVmFileTransferBackend(
      displayedId !== undefined && enhanceFileTransfer ? vmAgentFor(pool, displayedId) : null,
    )
    return () => registerVmFileTransferBackend(null)
    // pool.agentCommand 是稳定的命令入口；用它与 displayedId 做依赖即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayedId, enhanceFileTransfer, pool.agentCommand])

  // XP 里复制了文件 → OS 通知提示（文件APP里粘贴即导入）
  useEffect(() => {
    const unsubscribe = subscribeVmFileOffers((files) => {
      const subtitle =
        files.length === 1
          ? `${files[0]?.name ?? '文件'}（可在文件APP粘贴）`
          : `${files.length} 个文件（可在文件APP粘贴）`
      postOsNotification({
        id: 'virtual-machine:clipboard-files',
        title: '虚拟机剪贴板',
        subtitle,
        phase: 'neutral',
        icon: { kind: 'app', appId: 'virtual-machine' },
      })
    })
    return unsubscribe
  }, [])
  // #endregion

  const captureGuestKeyboard = useCallback(() => {
    // 不要把焦点交给 iframe：跨域画面看起来像聚焦了，按键却进不去。
    // 焦点留在宿主，按键由窗口监听转发进模拟器。
    if (settingsOpenRef.current || inspectorOpenRef.current) {
      return
    }
    setGuestKeyboardArmed(true)
    const token = ++stealFocusTokenRef.current
    const steal = () => {
      if (token !== stealFocusTokenRef.current) {
        return
      }
      if (settingsOpenRef.current || inspectorOpenRef.current) {
        return
      }
      keyboardSinkRef.current?.focus({ preventScroll: true })
    }
    steal()
    requestAnimationFrame(steal)
    window.setTimeout(steal, 0)
  }, [])

  const releaseGuestKeyboard = useCallback(() => {
    stealFocusTokenRef.current += 1
    setGuestKeyboardArmed(false)
    if (displayedId !== undefined) {
      pool.releaseKeyboard(displayedId)
    }
  }, [displayedId, pool.releaseKeyboard])

  useEffect(() => {
    if (!settingsOpen && !inspectorOpen && displayedId !== undefined) {
      return
    }
    stealFocusTokenRef.current += 1
    setGuestKeyboardArmed(false)
    if (displayedId !== undefined) {
      pool.releaseKeyboard(displayedId)
    }
  }, [displayedId, inspectorOpen, pool.releaseKeyboard, settingsOpen])

  const handleNew = useCallback(() => {
    setSettingsSession((current) => {
      if (current) {
        return current
      }
      return {
        mode: 'create',
        initial: defaultVirtualMachineSettings(nextVirtualMachineName(machines)),
      }
    })
    setPowerHint(undefined)
  }, [machines])

  const handleSettings = useCallback(() => {
    if (!selected) {
      return
    }
    setSettingsSession((current) => {
      if (current) {
        return current
      }
      return {
        mode: 'edit',
        id: selected.id,
        initial: settingsFromRecord(selected),
      }
    })
    setPowerHint(undefined)
  }, [selected])

  const focusMachine = useCallback((machineId: string) => {
    setSelectedId(machineId)
    setPowerHint(undefined)
    // 记住「上一次选中的机器」，下次打开 App 自动恢复。落盘失败不阻断交互。
    void setLastSelectedVirtualMachine(machineId).catch(() => {})
  }, [])

  const handleOpenSettings = useCallback(
    (machineId: string) => {
      const machine = machines.find((item) => item.id === machineId)
      if (!machine) {
        return
      }
      focusMachine(machineId)
      setSettingsSession((current) => {
        if (current) {
          return current
        }
        return {
          mode: 'edit',
          id: machine.id,
          initial: settingsFromRecord(machine),
        }
      })
    },
    [focusMachine, machines],
  )

  const handleListMove = useCallback(
    (fromIndex: number, toIndex: number) => {
      const machine = machines[fromIndex]
      if (!machine || fromIndex === toIndex) {
        return
      }
      void moveVirtualMachine(machine.id, toIndex).catch((error: unknown) => {
        showVmError(error instanceof Error ? error.message : '调整虚拟机顺序失败')
      })
    },
    [machines, showVmError],
  )

  const { showSystemOpenDialog, dialog: mediaOpenDialog } = useSystemOpenDialog()

  // #region 光盘/软盘热插拔（菜单「存储」分类与设置存储页共用）
  // 运行中：注册流 → 发 set/eject 命令 → 落盘 → 提交/回滚热插流。
  // 未运行：只落盘（等价于改设置），下次开机按 connected 装载。

  /**
   * 把 prev → next 的盘片变化同步到运行中的模拟器（含镜像占用迁移）。
   * 不落盘；调用方负责持久化与错误呈现。
   */
  const syncRemovableMediaRuntime = useCallback(
    async (machine: VirtualMachineRecord, prev: VmStorageDevice, next: VmStorageDevice) => {
      if (next.type !== 'cdrom' && next.type !== 'floppy') {
        return
      }
      const slot = slotOfDevice(machine.devices, next.id)
      if (slot !== 'cdrom' && slot !== 'fda' && slot !== 'fdb') {
        return
      }
      const prevInserted = isRemovableMediumInserted(prev)
      const nextInserted = isRemovableMediumInserted(next)
      const pathChanged = prev.path !== next.path
      if (!nextInserted && !prevInserted) {
        return
      }
      const running = pool.runningIds.includes(machine.id)
      if (!running) {
        return
      }
      const attaching = nextInserted && (pathChanged || !prevInserted)
      const occupant = { kind: 'vm' as const, id: machine.id }
      let claimedPath: string | undefined
      if (attaching) {
        // 只在真正往运行中的机器挂盘时声明占用；失败要放掉新路径，别把旧盘的占用一起清掉。
        await claimVirtualMachineDiskImageOccupancy(machine.id, [next])
        claimedPath = next.path.trim() || undefined
      }
      try {
        if (nextInserted) {
          if (!pathChanged && prevInserted) {
            return
          }
          const mount: VmRemovableMediaMount = await mountVirtualMachineRemovableMedia({
            machineId: machine.id,
            device: next,
            slot,
            diskWriteMode: machine.diskWriteMode,
          })
          try {
            if (slot === 'cdrom') {
              await pool.setActiveCdrom(machine.id, mount.stream)
            } else {
              await pool.setActiveFloppy(machine.id, slot, mount.stream)
            }
          } catch (error) {
            await mount.rollback()
            throw error
          }
          await mount.commit()
        } else {
          if (slot === 'cdrom') {
            await pool.ejectActiveCdrom(machine.id)
          } else {
            await pool.ejectActiveFloppy(machine.id, slot)
          }
          await releaseVirtualMachineRemovableMedia(machine.id, slot)
        }
        if (pathChanged && prev.path.trim()) {
          releaseDiskImagePath(prev.path, occupant)
        }
        if (!nextInserted && next.path.trim()) {
          releaseDiskImagePath(next.path, occupant)
        }
      } catch (error) {
        if (claimedPath) {
          releaseDiskImagePath(claimedPath, occupant)
        }
        throw error
      }
    },
    [pool],
  )

  const handleSwapMedia = useCallback(
    async (deviceId: string) => {
      if (!selected) {
        return
      }
      const device = selected.devices.find((item) => item.id === deviceId)
      if (!device) {
        return
      }
      const path = await showSystemOpenDialog({
        title: devicePickTitle(device.type),
        selectionMode: 'file',
        acceptExtensions: deviceAcceptExtensions(device.type),
        initialPath: device.path.trim() || undefined,
      })
      if (shouldSkipRemovableMediaPick(device, path)) {
        return
      }
      if (!path) {
        return
      }
      const next: VmStorageDevice = { ...device, path, connected: true }
      try {
        await syncRemovableMediaRuntime(selected, device, next)
        await updateVirtualMachine(selected.id, {
          ...settingsFromRecord(selected),
          devices: selected.devices.map((item) => (item.id === deviceId ? next : item)),
        })
      } catch (error) {
        showVmError(error instanceof Error ? error.message : '更换盘片失败')
      }
    },
    [selected, showSystemOpenDialog, showVmError, syncRemovableMediaRuntime],
  )

  const handleEjectMedia = useCallback(
    async (deviceId: string) => {
      if (!selected) {
        return
      }
      const device = selected.devices.find((item) => item.id === deviceId)
      if (!device) {
        return
      }
      const next: VmStorageDevice = { ...device, connected: false }
      try {
        await syncRemovableMediaRuntime(selected, device, next)
        await updateVirtualMachine(selected.id, {
          ...settingsFromRecord(selected),
          devices: selected.devices.map((item) => (item.id === deviceId ? next : item)),
        })
      } catch (error) {
        showVmError(error instanceof Error ? error.message : '弹出盘片失败')
      }
    },
    [selected, showVmError, syncRemovableMediaRuntime],
  )

  // 菜单「存储」分类：光盘/软盘各一个子菜单；都没有时用禁用项占位。
  const removableMediaMenuItems = useMemo((): MenuItemSubItem[] => {
    if (!selected) {
      return []
    }
    const floppyTotal = selected.devices.filter((device) => device.type === 'floppy').length
    let floppyIndex = 0
    const items: MenuItemSubItem[] = []
    for (const device of selected.devices) {
      if (device.type !== 'cdrom' && device.type !== 'floppy') {
        continue
      }
      if (!slotOfDevice(selected.devices, device.id)) {
        continue
      }
      const isCdrom = device.type === 'cdrom'
      if (!isCdrom) {
        floppyIndex += 1
      }
      // 仓里有盘才谈得上弹出：路径为空或已处于弹出状态时禁用
      const hasMedium = isRemovableMediumInserted(device)
      items.push({
        type: 'submenu',
        label: isCdrom
          ? '光盘'
          : floppyTotal > 1
            ? `软盘 ${floppyIndex}`
            : '软盘',
        items: [
          {
            type: 'action',
            label: isCdrom
              ? hasMedium
                ? '更换光盘…'
                : '插入光盘…'
              : hasMedium
                ? '更换软盘…'
                : '插入软盘…',
            onClick: () => void handleSwapMedia(device.id),
          },
          {
            type: 'action',
            label: isCdrom ? '弹出光盘' : '弹出软盘',
            disabled: !hasMedium,
            onClick: () => void handleEjectMedia(device.id),
          },
        ],
      })
    }
    if (items.length === 0) {
      items.push({
        type: 'action',
        label: '无可切换的存储',
        disabled: true,
        onClick: () => undefined,
      })
    }
    return items
  }, [handleEjectMedia, handleSwapMedia, selected])

  const handleSaveSettings = useCallback(
    async (settings: VirtualMachineSettings) => {
      if (!settingsSession) {
        return
      }
      if (settingsSession.mode === 'create') {
        const machine = await addVirtualMachine(settings)
        focusMachine(machine.id)
      } else {
        if (pool.runningIds.includes(settingsSession.id)) {
          // 立即生效的设置推给运行中的实例；重启才生效的只落盘，下次开机读取。
          try {
            // 光盘/软盘先热同步再落盘：命令失败时设置对话框保持打开，避免界面已插入、客机还是空托盘。
            const machine: VirtualMachineRecord = {
              ...settings,
              id: settingsSession.id,
              createdAt: Date.now(),
            }
            const prevById = new Map(
              settingsSession.initial.devices.map((device) => [device.id, device]),
            )
            for (const device of settings.devices) {
              const prev = prevById.get(device.id)
              if (!prev) {
                continue
              }
              const changed =
                prev.path !== device.path ||
                isRemovableMediumInserted(prev) !== isRemovableMediumInserted(device)
              if (changed) {
                await syncRemovableMediaRuntime(machine, prev, device)
              }
            }
            await pool.setActivePointerMode(settingsSession.id, settings.pointerMode)
            await pool.setActiveDisplayMode(settingsSession.id, settings.displayMode)
            await pool.setActiveAbsoluteMouse(
              settingsSession.id,
              settings.osPreset !== 'none' && settings.enhanceAbsoluteMouse,
            )
            // 共享文件夹：宿主根切换 + 运行时拦截器热开关立即生效；客机配置
            // 后台推送（与开机重推同一单飞通道收敛，失败由开机重推兜底）——
            // 不阻塞保存按钮几十秒。
            const sharedRoot = isSharedFolderActive(settings)
              ? settings.sharedFolderPath
              : undefined
            setWebdavSharedRoot(sharedRoot)
            await pool.setSharedFolder(settingsSession.id, sharedRoot !== undefined)
            // 运行中切硬盘写入档：只允许不保存 ⇄ 关机后写入（设置对话框已拦
            // 尽快写入），流侧只改最终是否合并，缓存不删。
            if (
              settings.diskWriteMode !== settingsSession.initial.diskWriteMode &&
              settings.diskWriteMode !== 'live'
            ) {
              await pool.setDiskWriteMode(settingsSession.id, settings.diskWriteMode)
            }
            void pushSharedFolderGuestConfig(
              sharedRoot !== undefined,
              (command) => pool.agentCommand(settingsSession.id, 'execResult', [command]),
              settings.sharedFolderDrive,
            ).catch(() => {})
          } catch (error) {
            showVmError(error instanceof Error ? error.message : '应用设置失败')
            return
          }
        }
        await updateVirtualMachine(settingsSession.id, settings)
      }
      setSettingsSession(undefined)
      setPowerHint(undefined)
    },
    [focusMachine, pool, settingsSession, showVmError, syncRemovableMediaRuntime],
  )

  const handleDisplayMode = useCallback(
    async (mode: VmDisplayModeId) => {
      if (!selected) {
        return
      }
      if (selectedRunning) {
        try {
          await pool.setActiveDisplayMode(selected.id, mode)
        } catch (error) {
          showVmError(error instanceof Error ? error.message : '切换显示比例失败')
          return
        }
      }
      await updateVirtualMachine(selected.id, {
        ...settingsFromRecord(selected),
        displayMode: mode,
      })
      setPowerHint(undefined)
    },
    [pool, selected, selectedRunning],
  )

  const handleDelete = useCallback(() => {
    if (!selected) {
      return
    }
    const target = selected
    void (async () => {
      const confirmed = await modal.confirm({
        title: '删除虚拟机',
        message: `要删除「${target.name}」吗？此操作无法撤销。`,
        confirmLabel: '删除',
        cancelLabel: '取消',
        confirmTone: 'danger',
        themeColor: THEME,
      })
      if (!confirmed) {
        return
      }
      if (pool.runningIds.includes(target.id)) {
        try {
          await pool.shutdown(target.id)
        } catch (error) {
          showVmError(error instanceof Error ? error.message : '关机失败')
          return
        }
      }
      const index = machines.findIndex((machine) => machine.id === target.id)
      const remaining = await removeVirtualMachine(target.id)
      const next = remaining[Math.min(Math.max(index, 0), Math.max(remaining.length - 1, 0))]
      if (next) {
        focusMachine(next.id)
      } else {
        setSelectedId(undefined)
      }
      setPowerHint(undefined)
    })()
  }, [focusMachine, machines, modal, pool, selected, showVmError])

  const handlePower = useCallback(
    (action: 'start' | 'shutdown' | 'stop' | 'reset') => {
      const powerStartAt = performance.now()
      const machineId = selected?.id
      const trace = (op: string, extra?: Record<string, unknown>) => {
        recordSystemDebugTimeline({
          layer: 'vm',
          op,
          detail: {
            action,
            machineId,
            running: machineId !== undefined ? pool.runningIds.includes(machineId) : undefined,
            ...extra,
          },
          durationMs: Math.round(performance.now() - powerStartAt),
        })
      }
      trace('power-pressed')
      if (!selected || !selectedBackend) {
        trace('power-skipped', { reason: 'no-selection-or-backend' })
        return
      }
      if (!selectedBackend.available || !runtimeOrigin) {
        setPowerHint(vmPowerUnavailableMessage(action))
        trace('power-skipped', { reason: 'backend-unavailable', runtimeOrigin })
        return
      }
      if (action === 'start') {
        if (pool.runningIds.includes(selected.id)) {
          trace('power-skipped', { reason: 'already-running' })
          return
        }
        if (!virtualMachineHasBootMedia(selected)) {
          setPowerHint('请先在设置里挂载硬盘、光盘或软盘')
          trace('power-skipped', { reason: 'no-boot-media' })
          return
        }
      } else if (!pool.runningIds.includes(selected.id)) {
        setPowerHint(action === 'reset' ? '请先开机' : '这台虚拟机未在运行')
        trace('power-skipped', { reason: 'not-running' })
        return
      }
      const machine = selected
      void (async () => {
        if (action === 'stop') {
          // 第一次点断电时机器还在跑：只按档位说话，不预告、不吓唬。
          // 正在写盘硬控中的机器断电按钮已禁用；放弃未写完只走画面上的「放弃」。
          const modeMessage =
            machine.diskWriteMode === 'live'
              ? '切断电源后，会把还没写完的改动继续写入硬盘文件。'
              : machine.diskWriteMode === 'poweroff'
                ? '切断电源后，这次开机对硬盘的改动会写入硬盘文件。'
                : '切断电源后，这次开机的改动先留在缓存里。之后会问你是否写入硬盘文件。'
          const confirmed = await modal.confirm({
            title: '断电',
            message: modeMessage,
            confirmLabel: '断电',
            cancelLabel: '取消',
            confirmTone: 'danger',
            themeColor: THEME,
          })
          if (!confirmed) {
            trace('power-skipped', { reason: 'stop-not-confirmed' })
            return
          }
        }
        setPowerBusy(true)
        let waitForGuestShutdown = false
        try {
          if (action === 'shutdown') {
            // 软关机只依赖串口命令链，信箱没就绪不影响关机，不必拦。状态灯 off
            // 里有大量「假掉线」——后台标签页节流把 PING 拖过期了——现场补一刀
            // PING 再决定拦不拦：真断才弹错，假掉线直接放行关机。
            if (agentLink === 'off') {
              setPowerHint('正在确认 Agent 连接…')
              trace('power-agent-verify')
              const alive = await Promise.race([
                verifyAgentAlive(machine.id),
                new Promise<false>((resolve) => {
                  window.setTimeout(() => resolve(false), VM_AGENT_VERIFY_TIMEOUT_MS)
                }),
              ])
              if (!alive) {
                setPowerHint(undefined)
                trace('power-skipped', { reason: 'agent-not-connected' })
                showVmError('客机 Agent 未连通，关机命令无法送达')
                return
              }
            }
            // XP 软关机：agent SHUTDOWN → ExitWindowsEx → 客机切电 →
            // guest-poweroff watcher → 宿主侧写回落盘 → runningIds 移除（收口）。
            // 成功后保持 busy，等待收口 effect；失败（agent 不可达）弹窗告知。
            await pool.agentCommand(machine.id, 'shutdown')
            trace('power-guest-shutdown-sent')
            setPowerHint(
              machine.diskWriteMode === 'none'
                ? GUEST_SHUTDOWN_SENT_NO_WRITE_HINT
                : GUEST_SHUTDOWN_SENT_HINT,
            )
            guestShutdownAtRef.current = Date.now()
            setAwaitingGuestShutdown(true)
            waitForGuestShutdown = true
            return
          }
          if (action === 'stop') {
            const forced = await pool.shutdown(machine.id)
            trace('power-stop-done', { forced })
            if (forced) {
              setPowerHint(FORCED_OFF_UNFLUSHED_HINT)
              void modal.alert({
                title: '强制断电',
                message: `已强制断电。还没保存完的改动可能丢失。若写入被打断，硬盘文件可能不完整，建议重新开机让系统自检修复，修好前请勿直接使用或导出。`,
                themeColor: THEME,
              })
            } else {
              setPowerHint(undefined)
            }
            return
          }
          if (action === 'reset') {
            const forced = await pool.shutdown(machine.id)
            trace('power-reset-done', { forced })
            if (forced) {
              setPowerHint(FORCED_OFF_UNFLUSHED_HINT)
              void modal.alert({
                title: '强制断电',
                message: `已强制断电。还没保存完的改动可能丢失。若写入被打断，硬盘文件可能不完整，建议重新开机让系统自检修复，修好前请勿直接使用或导出。`,
                themeColor: THEME,
              })
            } else {
              setPowerHint(undefined)
            }
            await pool.boot(machine)
            return
          }
          await pool.boot(machine)
          trace('power-boot-issued')
          setPowerHint(undefined)
        } catch (error) {
          trace('power-failed', {
            error: error instanceof Error ? error.message : String(error),
          })
          showVmError(error instanceof Error ? error.message : '操作失败')
        } finally {
          if (!waitForGuestShutdown) {
            setPowerBusy(false)
          }
        }
      })()
    },
    [agentLink, modal, pool, runtimeOrigin, selected, selectedBackend, showVmError, verifyAgentAlive],
  )

  const handleSendKeyPreset = useCallback(
    (preset: VmSendKeyPreset) => {
      if (displayedId === undefined) {
        return
      }
      recordSystemDebugTimeline({
        layer: 'vm',
        op: 'send-key',
        detail: `${preset.id} (${preset.label})`,
      })
      // 组合键就是一串键盘消息：按下顺序 down、逆序 up，走现有键盘注入通道。
      for (const message of buildKeyboardSequence(preset)) {
        pool.sendKeyboard(displayedId, message)
      }
    },
    [displayedId, pool.sendKeyboard],
  )

  // 硬控画面上的「放弃」：再过一道模态，确认才丢掉还没写完的部分。
  // 取消或关掉模态 = 继续写。
  const handleAbandonFlush = useCallback(() => {
    if (displayedId === undefined) {
      return
    }
    void (async () => {
      const abandon = await modal.confirm({
        title: '放弃写入？',
        message: '还没写进硬盘文件的部分会丢掉。',
        confirmLabel: '放弃',
        cancelLabel: '继续写入',
        confirmTone: 'danger',
        themeColor: THEME,
      })
      if (!abandon) {
        return
      }
      setPowerHint(FORCED_OFF_UNFLUSHED_HINT)
      await pool.abandonWrites(displayedId)
    })()
  }, [displayedId, modal, pool])

  const handleBootError = useCallback(
    (machineId: string, message: string, detail?: string) => {
      pool.onBootError(machineId, message, detail)
      showVmError(message)
    },
    [pool, showVmError],
  )

  const handleIframeLoadFailed = useCallback(
    (machineId: string, detail: string) => {
      recordSystemDebugTimeline({
        layer: 'vm',
        op: 'iframe-load-failed',
        detail: `${machineId}: ${detail.slice(0, 200)}`,
      })
      // ready 超时说明运行时实际不可用：打回未就绪状态，按钮随即禁用并恢复重试。
      runtimeAliveRef.current = false
      setRuntimeAlive(false)
      // 从运行列表移除：surface 连同 iframe 一起卸载，浏览器画的错误页随之消失；
      // hint 落到状态栏，屏幕回到「已关机。点开机启动。」
      pool.onBootError(machineId, detail)
    },
    [pool],
  )

  const handleDiskWriteFailed = useCallback(
    (machineId: string, detail: string) => {
      recordSystemDebugTimeline({
        layer: 'vm',
        op: 'disk-write-failed',
        detail: `${machineId}: ${detail.slice(0, 200)}`,
      })
      // 写不进去不弹窗打断、不自动强拆：硬控画面继续显示「正在写入」，
      // 用户自己决定要不要放弃。这里只发桌面通知留个痕迹。
      const machine = machinesRef.current.find((item) => item.id === machineId)
      postVirtualMachineDiskWriteFailedNotification({
        machineId,
        machineName: machine?.name ?? 'Virtual Machine',
        detail,
      })
    },
    [],
  )

  const selectedDisplayMode = selected?.displayMode
  const menuBar = useMemo((): MenuDefinition[] => {
    return [
      {
        label: '文件',
        items: [
          {
            type: 'action',
            label: '新建虚拟机',
            shortcut: '⌘N',
            onClick: handleNew,
          },
          {
            type: 'action',
            label: '设置虚拟机',
            disabled: !hasSelection,
            onClick: handleSettings,
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '删除',
            disabled: !hasSelection || powerBusy,
            onClick: handleDelete,
          },
        ],
      },
      {
        label: '虚拟机',
        items: [
          {
            type: 'action',
            label: '设置虚拟机',
            disabled: !hasSelection,
            onClick: handleSettings,
          },
          { type: 'separator' },
          {
            type: 'submenu',
            label: '电源',
            items: [
              {
                type: 'action',
                label: '开机',
                disabled: !canStart,
                onClick: () => handlePower('start'),
              },
              {
                type: 'action',
                label: '关机',
                // 不带 Agent 的客机软关机无处可达，置灰避免点了必失败。
                disabled: !canStop || !selectedAgentCapable,
                onClick: () => handlePower('shutdown'),
              },
              {
                type: 'action',
                label: '断电',
                disabled: !canStop,
                onClick: () => handlePower('stop'),
              },
              {
                type: 'action',
                label: '重置',
                disabled: !canReset,
                onClick: () => handlePower('reset'),
              },
            ],
          },
          {
            type: 'submenu',
            label: '发送按键',
            items: [
              ...VM_COMBO_KEY_PRESETS.map((preset) => ({
                type: 'action' as const,
                label: preset.label,
                disabled: !canSendKeys,
                onClick: () => handleSendKeyPreset(preset),
              })),
              { type: 'separator' as const },
              {
                type: 'submenu' as const,
                label: '功能键',
                items: VM_FUNCTION_KEY_PRESETS.map((preset) => ({
                  type: 'action' as const,
                  label: preset.label,
                  disabled: !canSendKeys,
                  onClick: () => handleSendKeyPreset(preset),
                })),
              },
            ],
          },
          {
            type: 'action',
            label: '详细信息',
            disabled: !hasSelection,
            onClick: () => setInspectorOpen(true),
          },
          { type: 'separator' },
          ...removableMediaMenuItems,
        ],
      },
      {
        label: '视图',
        items: [
          {
            type: 'submenu',
            label: '屏幕比例',
            items: VM_DISPLAY_MODE_IDS.map((mode) => ({
              type: 'action' as const,
              label:
                selectedDisplayMode === mode
                  ? `✓ ${formatVmDisplayModeLabel(mode)}`
                  : formatVmDisplayModeLabel(mode),
              disabled: !hasSelection,
              onClick: () => void handleDisplayMode(mode),
            })),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: vmWindowFullscreen ? '✓ 全屏' : '全屏',
            disabled: ownWindowId === undefined,
            onClick: () => {
              if (ownWindowId !== undefined) {
                toggleFullscreen(ownWindowId)
              }
            },
          },
        ],
      },
    ]
  }, [
    canReset,
    canSendKeys,
    canStart,
    canStop,
    handleDelete,
    handleDisplayMode,
    handleNew,
    handlePower,
    handleSendKeyPreset,
    handleSettings,
    hasSelection,
    ownWindowId,
    powerBusy,
    removableMediaMenuItems,
    selectedAgentCapable,
    selectedDisplayMode,
    toggleFullscreen,
    vmWindowFullscreen,
  ])

  useAppMenuBar(APP_ID, menuBar, isActiveWindow)

  useEffect(() => {
    if (!isActiveWindow) {
      return
    }
    // 键盘流中断过（切显示画面 / 开关弹窗）就作废按住集合，防修饰位粘住。
    keyTranslatorRef.current.reset()
    const onBlurWindow = () => keyTranslatorRef.current.reset()
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        handleNew()
        return
      }
      if (
        !guestKeyboardArmed ||
        displayedId === undefined ||
        settingsOpen ||
        inspectorOpen ||
        isVmImeKeyEvent(event) ||
        isVmHostTypingTarget(event.target) ||
        // 焦点不在 sink 上（点过菜单/工具栏后落在宿主 UI）就不转发：
        // 宿主 UI 的键盘操作（如菜单 Tab 导航）优先，点回画面即恢复。
        keyboardSinkRef.current !== document.activeElement
      ) {
        return
      }
      event.preventDefault()
      pool.sendKeyboard(displayedId, keyTranslatorRef.current.translate(event, 'down'))
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (
        !guestKeyboardArmed ||
        displayedId === undefined ||
        settingsOpen ||
        inspectorOpen ||
        isVmImeKeyEvent(event) ||
        isVmHostTypingTarget(event.target) ||
        keyboardSinkRef.current !== document.activeElement
      ) {
        return
      }
      event.preventDefault()
      pool.sendKeyboard(displayedId, keyTranslatorRef.current.translate(event, 'up'))
    }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', onBlurWindow)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', onBlurWindow)
    }
  }, [
    displayedId,
    guestKeyboardArmed,
    handleNew,
    inspectorOpen,
    isActiveWindow,
    pool.sendKeyboard,
    settingsOpen,
  ])

  const screenMessage = !ready
    ? '正在加载…'
    : !runtimeOrigin
      ? '未配置虚拟机运行时'
      : runtimeAlive === undefined
        ? '正在连接虚拟机运行时…'
        : runtimeAlive === false
          ? runtimeUnreachableHint
          : !selected
            ? '选择左侧的虚拟机，或新建一台。'
            : displayedId === undefined
              ? '已关机。点开机启动。'
              : undefined

  return (
    <div
      class={`virtual-machine${vmWindowFullscreen ? ' virtual-machine--fullscreen' : ''}`}
      ref={narrowHostRef}
    >
      {hud.view}
      <div class="virtual-machine__toolbar" onPointerDown={releaseGuestKeyboard}>
        <div class="virtual-machine__toolbar-actions">
          <Button onClick={handleNew}>
            新建
          </Button>
          <Button disabled={!hasSelection} onClick={handleSettings}>
            设置
          </Button>
          <Button
            disabled={!canStart}
            onClick={() => handlePower('start')}
          >
            开机
          </Button>
          {selectedAgentCapable ? (
            <Button disabled={!canStop} onClick={() => handlePower('shutdown')}>
              关机
            </Button>
          ) : (
            <Button disabled={!canStop} onClick={() => handlePower('stop')}>
              断电
            </Button>
          )}
        </div>
        {selected ? (
          <SegmentedControl
            value={selected.displayMode}
            items={DISPLAY_MODE_SEGMENTS}
            onChange={(mode) => void handleDisplayMode(mode)}
            ariaLabel="显示比例"
            className="virtual-machine__display-mode"
          />
        ) : null}
        <span class="virtual-machine__status" role="status">
          {formatStatus(selected, selectedRunning)}
          {statusHint ? (
            <span class="virtual-machine__status-hint"> · {statusHint}</span>
          ) : null}
        </span>
      </div>
      <div class="virtual-machine__body">
        <aside
          class="virtual-machine__list-pane"
          aria-label="虚拟机列表"
          onPointerDown={releaseGuestKeyboard}
        >
          <div class="virtual-machine__list-head">虚拟机</div>
          {machines.length === 0 && ready ? (
            <p class="virtual-machine__list-empty">还没有虚拟机。点「新建」添加一台。</p>
          ) : (
            <VirtualMachineList
              machines={machines}
              selectedId={selectedId}
              runningIds={pool.runningIds}
              startingIds={startingIds}
              flushingIds={pool.flushingIds}
              onFocus={focusMachine}
              onOpenSettings={handleOpenSettings}
              onMove={handleListMove}
            />
          )}
        </aside>
        <section class="virtual-machine__display-pane" aria-label="显示器">
          <div
            ref={keyboardSinkRef}
            class="virtual-machine__keyboard-sink"
            tabIndex={-1}
            aria-hidden="true"
          />
          <div class="virtual-machine__monitors">
            {runningMachines.map((machine) => {
              const isDisplayed = machine.id === displayedId
              return (
                <div
                  key={machine.id}
                  class={
                    isDisplayed
                      ? 'virtual-machine__screen virtual-machine__screen--main'
                      : 'virtual-machine__screen virtual-machine__screen--background'
                  }
                  aria-hidden={isDisplayed ? undefined : 'true'}
                >
                  <VmRuntimeSurface
                    machineId={machine.id}
                    origin={runtimeOrigin}
                    buildMode={machine.buildMode}
                    startMessage={pool.startMessages.get(machine.id)}
                    resolutionAutoAlign={
                      machine.osPreset !== 'none' && machine.resolutionAutoAlign
                    }
                    onRegister={pool.onRegister}
                    onUnregister={pool.onUnregister}
                    onStateChange={pool.onStateChange}
                    onStarted={pool.onStarted}
                    onGuestPoweredOff={pool.onGuestPoweredOff}
                    onGuestPoweroffDraining={pool.onGuestPoweroffDraining}
                    onBootError={handleBootError}
                    onIframeLoadFailed={handleIframeLoadFailed}
                    onDiskWriteFailed={handleDiskWriteFailed}
                    onGuestClipboard={handleGuestClipboard}
                    onGuestFileEvent={handleGuestFileEvent}
                    onNativeKey={handleNativeKey}
                    onCaptureKeyboard={captureGuestKeyboard}
                    isDisplayed={isDisplayed}
                  />
                </div>
              )
            })}
            {displayedId === undefined ? (
              <div class="virtual-machine__screen virtual-machine__screen--single">
                {screenMessage ? (
                  <div class="virtual-machine__screen-message">{screenMessage}</div>
                ) : null}
              </div>
            ) : null}
            {displayedBusy ? (
              <div class="virtual-machine__screen-message">正在连接模拟器…</div>
            ) : null}
          </div>
          {displayedFlushing ? (
            <VirtualMachineFlushScreen
              machineName={selected?.name}
              stage={flushProgress?.stage}
              totalBytes={flushProgress?.totalBytes}
              pendingBytes={flushProgress?.pendingBytes}
              speedBytesPerSec={flushProgress?.speedBytesPerSec}
              stalledMs={flushProgress?.stalledMs}
              onAbandon={handleAbandonFlush}
            />
          ) : null}
          <div
            class="virtual-machine__activity-slot"
            onPointerDown={releaseGuestKeyboard}
          >
            <VirtualMachineActivity
              stats={selectedSnapshot?.stats}
              running={selectedRunning && !displayedBusy}
              diskStreamIds={selectedDiskStreamIds}
              mountedSlots={vmMountedDiskSlots(selected?.devices)}
              diskWriteMode={selected?.diskWriteMode}
            />
          </div>
          {inspectorOpen && selected ? (
            <VirtualMachineInspectorOverlay
              machine={selected}
              running={selectedRunning}
              snapshot={selectedSnapshot}
              onClose={() => setInspectorOpen(false)}
            />
          ) : null}
        </section>
      </div>
      <VirtualMachineSettingsDialog
        open={settingsOpen}
        mode={settingsSession?.mode ?? 'create'}
        initial={settingsSession?.initial ?? defaultVirtualMachineSettings()}
        running={
          settingsSession?.mode === 'edit' &&
          pool.runningIds.includes(settingsSession.id)
        }
        onClose={() => setSettingsSession(undefined)}
        onSave={handleSaveSettings}
      />
      {mediaOpenDialog}
    </div>
  )
}
