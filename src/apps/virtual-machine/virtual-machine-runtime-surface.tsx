import { useEffect, useRef } from 'preact/hooks'
import type {
  InstantVmStartMessage,
} from './virtual-machine-protocol.ts'
import { buildVmRuntimeOriginWithMode } from './virtual-machine-runtime-config.ts'
import {
  useVirtualMachineRuntime,
  type VmRuntimeApi,
  type VmRuntimeSnapshot,
} from './virtual-machine-runtime.ts'

export type VmRuntimeSurfaceProps = {
  machineId: string
  origin: string | undefined
  buildMode?: string
  startMessage: InstantVmStartMessage | undefined
  onRegister: (machineId: string, api: VmRuntimeApi) => void
  onUnregister: (machineId: string) => void
  onStateChange: (machineId: string, snapshot: VmRuntimeSnapshot) => void
  onStarted: (machineId: string) => void
  onGuestPoweredOff: (machineId: string) => void
  onBootError: (machineId: string, message: string) => void
  onDiskWriteFailed: (machineId: string, message: string) => void
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
  onRegister,
  onUnregister,
  onStateChange,
  onStarted,
  onGuestPoweredOff,
  onBootError,
  onDiskWriteFailed,
  onCaptureKeyboard,
  isDisplayed,
}: VmRuntimeSurfaceProps) {
  const resolvedOrigin = buildMode ? buildVmRuntimeOriginWithMode(origin, buildMode) : origin
  const {
    iframeRef,
    ready,
    stats,
    bootProgress,
    start,
    stop,
    reset,
    saveState,
    setDisplayMode,
    setPointerMode,
    sendKeyboard,
    captureKeyboard,
    releaseKeyboard,
  } = useVirtualMachineRuntime(
    resolvedOrigin,
    () => onGuestPoweredOff(machineId),
    (message) => onDiskWriteFailed(machineId, message),
    (message) => onBootError(machineId, message),
  )
  const processedRef = useRef<InstantVmStartMessage | undefined>(undefined)

  useEffect(() => {
    onRegister(machineId, {
      start,
      stop,
      reset,
      saveState,
      setDisplayMode,
      setPointerMode,
      sendKeyboard,
      captureKeyboard,
      releaseKeyboard,
    })
    return () => onUnregister(machineId)
  }, [
    machineId,
    onRegister,
    onUnregister,
    saveState,
    start,
    stop,
    reset,
    setDisplayMode,
    setPointerMode,
    sendKeyboard,
    captureKeyboard,
    releaseKeyboard,
  ])

  useEffect(() => {
    onStateChange(machineId, { ready, stats, bootProgress })
  }, [machineId, onStateChange, ready, stats, bootProgress])

  useEffect(() => {
    if (!ready || !startMessage) {
      console.log('[vm-boot] wait for runtime', machineId, {
        ready,
        hasStart: Boolean(startMessage),
      })
      return
    }
    if (processedRef.current === startMessage) {
      return
    }
    const target = startMessage
    processedRef.current = target
    console.log('[vm-boot] sending start to runtime', machineId, target.requestId)
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

  if (!resolvedOrigin) {
    return null
  }

  return (
    <iframe
      ref={iframeRef}
      class="virtual-machine__frame"
      title={`虚拟机显示器 ${machineId}`}
      src={resolvedOrigin}
      tabIndex={-1}
      referrerPolicy="origin"
      sandbox="allow-scripts allow-same-origin allow-modals allow-pointer-lock"
      allow="autoplay; fullscreen; pointer-lock"
      onFocus={() => {
        // 点进跨域 iframe 时焦点会落到 iframe 上，宿主窗口就再也收不到按键。
        // 立刻交还宿主，改走 postMessage 注入。
        captureKeyboard()
        onCaptureKeyboard()
      }}
      onPointerDown={() => {
        captureKeyboard()
        onCaptureKeyboard()
      }}
    />
  )
}
