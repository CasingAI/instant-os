import { countSystemDebugHot, recordSystemDebugTimeline } from '../../os/system-debug-log.ts'
import { useEffect, useRef } from 'preact/hooks'
import type {
  InstantVmNativeKeyMessage,
  InstantVmStartMessage,
  VmGuestFileEvent,
} from './virtual-machine-protocol.ts'
import { buildVmRuntimeOriginWithMode, appendVmCrashReportParam } from './virtual-machine-runtime-config.ts'
import { loadExperimentalSettings } from '../../os/experimental-settings-storage.ts'
import {
  useVirtualMachineRuntime,
  type VmRuntimeApi,
  type VmRuntimeSnapshot,
} from './virtual-machine-runtime.ts'
import { createResolutionAligner, resolutionAutoAlignEnabled } from './resolution-channel.ts'

export type VmRuntimeSurfaceProps = {
  machineId: string
  origin: string | undefined
  buildMode?: string
  startMessage: InstantVmStartMessage | undefined
  /** 分辨率自动对齐的活开关：来自机器记录（store 刷新即变），运行中切换立即生效。 */
  resolutionAutoAlign?: boolean
  onRegister: (machineId: string, api: VmRuntimeApi) => void
  onUnregister: (machineId: string) => void
  onStateChange: (machineId: string, snapshot: VmRuntimeSnapshot) => void
  onStarted: (machineId: string) => void
  onGuestPoweredOff: (machineId: string) => void
  onBootError: (machineId: string, message: string, detail?: string) => void
  onIframeLoadFailed: (machineId: string, detail: string) => void
  onDiskWriteFailed: (machineId: string, message: string) => void
  onGuestClipboard: (machineId: string, text: string) => void
  onGuestFileEvent: (machineId: string, event: VmGuestFileEvent) => void
  /** iframe 抢到焦点时真实按键会上报到这里，由宿主过按键映射后注回。 */
  onNativeKey: (machineId: string, message: InstantVmNativeKeyMessage) => void
  onCaptureKeyboard: () => void
  isDisplayed: boolean
}

/**
 * 一台运行中虚拟机的显示面：拥有独立 iframe 与运行时状态；
 * 拿到 startMessage 且运行时就绪后自动开机。
 */
export function VmRuntimeSurface({
  machineId,
  origin,
  buildMode,
  startMessage,
  resolutionAutoAlign,
  onRegister,
  onUnregister,
  onStateChange,
  onStarted,
  onGuestPoweredOff,
  onBootError,
  onIframeLoadFailed,
  onDiskWriteFailed,
  onGuestClipboard,
  onGuestFileEvent,
  onNativeKey,
  onCaptureKeyboard,
  isDisplayed,
}: VmRuntimeSurfaceProps) {
  const resolvedOrigin = buildMode ? buildVmRuntimeOriginWithMode(origin, buildMode) : origin
  const crashReportOrigin = appendVmCrashReportParam(
    resolvedOrigin,
    loadExperimentalSettings().vmCrashReport,
  )
  const {
    iframeRef,
    ready,
    stats,
    bootProgress,
    iframeStatus,
    handleIframeLoad,
    handleIframeError,
    start,
    stop,
    lastMessageAt,
    saveState,
    setDisplayMode,
    setPointerMode,
    setAbsoluteMouse,
    setResolution,
    setCdrom,
    ejectCdrom,
    setFloppy,
    ejectFloppy,
    sendKeyboard,
    captureKeyboard,
    releaseKeyboard,
    agentCommand,
  } = useVirtualMachineRuntime(
    resolvedOrigin,
    () => onGuestPoweredOff(machineId),
    (message) => onDiskWriteFailed(machineId, message),
    (message, detail) => onBootError(machineId, message, detail),
    (detail) => onIframeLoadFailed(machineId, detail),
    (text) => onGuestClipboard(machineId, text),
    (event) => onGuestFileEvent(machineId, event),
    (message) => onNativeKey(machineId, message),
  )
  const processedRef = useRef<InstantVmStartMessage | undefined>(undefined)

  useEffect(() => {
    onRegister(machineId, {
      start,
      stop,
      lastMessageAt,
      saveState,
      setDisplayMode,
      setPointerMode,
      setAbsoluteMouse,
      setResolution,
      setCdrom,
      ejectCdrom,
      setFloppy,
      ejectFloppy,
      sendKeyboard,
      captureKeyboard,
      releaseKeyboard,
      agentCommand,
    })
    return () => onUnregister(machineId)
  }, [
    machineId,
    onRegister,
    onUnregister,
    saveState,
    start,
    stop,
    lastMessageAt,
    setDisplayMode,
    setPointerMode,
    setAbsoluteMouse,
    setResolution,
    setCdrom,
    ejectCdrom,
    setFloppy,
    ejectFloppy,
    sendKeyboard,
    captureKeyboard,
    releaseKeyboard,
    agentCommand,
  ])

  useEffect(() => {
    onStateChange(machineId, { ready, stats, bootProgress, iframeStatus })
  }, [machineId, onStateChange, ready, stats, bootProgress, iframeStatus])

  useEffect(() => {
    if (!ready || !startMessage) {
      countSystemDebugHot('vm', 'boot-wait-runtime')
      return
    }
    if (processedRef.current === startMessage) {
      return
    }
    const target = startMessage
    processedRef.current = target
    recordSystemDebugTimeline({
      layer: 'vm',
      op: 'send-start-to-runtime',
      detail: `${machineId} ${target.requestId}`,
    })
    void start(target)
      .then(() => {
        onStarted(machineId)
        if (isDisplayed) {
          captureKeyboard()
          onCaptureKeyboard()
        }
      })
      .catch((error) => {
        onBootError(machineId, error instanceof Error ? error.message : String(error))
      })
  }, [
    captureKeyboard,
    isDisplayed,
    machineId,
    onBootError,
    onCaptureKeyboard,
    onStarted,
    ready,
    start,
    startMessage,
  ])

  // 分辨率自动对齐：只观察 iframe 元素本身 —— 它的尺寸完全由宿主布局决定
  // （CSS 绝对定位填满屏幕容器），客机内部切模式不会反过来改变它，从根上
  // 切断「切模式 → 容器变 → 再触发」的反馈震荡（00 §5）。
  // 开关读活值（设置保存后 store 刷新带动），运行中切换立即生效；
  // 关掉即断开观察、客机保持当前分辨率，打开时挂上就对齐一次当前视口。
  const resolutionAlign = resolutionAutoAlign ?? resolutionAutoAlignEnabled(startMessage)
  useEffect(() => {
    if (!ready || !resolutionAlign) {
      return
    }
    const element = iframeRef.current
    if (!element) {
      return
    }
    const aligner = createResolutionAligner({
      // 「原始」按「放得下的最大档」下取，其余走「可见面积最大化」选档（详见 selectResolutionMode）。
      displayMode: startMessage?.config.displayMode,
      onTarget: (target) => {
        // 客机代理未安装 / 不支持时运行时静默忽略，宿主不弹错。
        void setResolution(target.width, target.height).catch(() => undefined)
      },
    })
    aligner.observe(element)
    return () => aligner.disconnect()
  }, [ready, resolutionAlign, setResolution, iframeRef, startMessage])

  // 绝对坐标生效时给 iframe 元素自身也写 cursor:none（第二道保险）：指针从浏览器
  // 窗口外直接落回 OOPIF 时，Chromium 可能拿父框架一侧的光标兜底而不理会 iframe
  // 内部的 cursor:none；宿主这边同为 none，重入路径也能直接隐藏。失效时清掉。
  const absoluteMouseEngaged = stats?.absoluteMouse === true
  useEffect(() => {
    const element = iframeRef.current
    if (!element) {
      return
    }
    element.style.cursor = absoluteMouseEngaged ? 'none' : ''
  }, [absoluteMouseEngaged, iframeRef, iframeStatus])

  if (!resolvedOrigin) {
    return null
  }

  // ready 之前把 iframe 藏起来：服务器没起等情况下 Chrome 会在 iframe 里画原生
  // 错误页，藏住后用户只会看到宿主的「正在连接模拟器…」，超时后走错误清场。
  const failed = iframeStatus === 'error'
  const frameClass =
    iframeStatus === 'ready'
      ? 'virtual-machine__frame'
      : 'virtual-machine__frame virtual-machine__frame--idle'

  return (
    <>
      {failed ? null : (
        <iframe
          ref={iframeRef}
          class={frameClass}
          title={`虚拟机显示器 ${machineId}`}
          src={crashReportOrigin ?? resolvedOrigin}
          tabIndex={-1}
          referrerPolicy="origin"
          sandbox="allow-scripts allow-same-origin allow-modals allow-pointer-lock"
          allow="autoplay; fullscreen; pointer-lock"
          onLoad={handleIframeLoad}
          onError={handleIframeError}
          onFocus={() => {
            // 点进跨域 iframe 时焦点会落到 iframe 上，宿主窗口就再也收不到按键。
            // 立刻交还宿主，改走 postMessage 注入。注意 onPointerDown 在这里帮不上忙：
            // 对 iframe 内容的点击不会进父文档（v86 还对 mousedown preventDefault，
            // 焦点根本不会移动），靠 runtime 侧 mousedown 里 window.focus() 才有本事件。
            captureKeyboard()
            onCaptureKeyboard()
          }}
        />
      )}
      {failed ? (
        <div class="virtual-machine__screen-message virtual-machine__iframe-error" role="alert">
          虚拟机运行时未响应（{resolvedOrigin}）
        </div>
      ) : null}
    </>
  )
}
