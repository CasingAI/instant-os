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
  onBootError: (machineId: string, message: string) => void
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
  onBootError,
}: VmRuntimeSurfaceProps) {
  const resolvedOrigin = buildMode ? buildVmRuntimeOriginWithMode(origin, buildMode) : origin
  const { iframeRef, ready, stats, bootProgress, pointerLocked, lastEdgeHit, start, stop, reset, setDisplayMode, requestPointerLock } =
    useVirtualMachineRuntime(resolvedOrigin)
  const processedRef = useRef<InstantVmStartMessage | undefined>(undefined)

  useEffect(() => {
    onRegister(machineId, { start, stop, reset, setDisplayMode, requestPointerLock })
    return () => onUnregister(machineId)
  }, [machineId, onRegister, onUnregister, start, stop, reset, setDisplayMode, requestPointerLock])

  useEffect(() => {
    onStateChange(machineId, { ready, stats, bootProgress, pointerLocked })
  }, [machineId, onStateChange, ready, stats, bootProgress, pointerLocked])

  useEffect(() => {
    if (!ready || !startMessage) {
      return
    }
    if (processedRef.current === startMessage) {
      return
    }
    const target = startMessage
    processedRef.current = target
    void start(target)
      .then(() => onStarted(machineId))
      .catch((error) => {
        onBootError(machineId, error instanceof Error ? error.message : String(error))
      })
  }, [machineId, onBootError, onStarted, ready, start, startMessage])

  if (!resolvedOrigin) {
    return null
  }

  return (
    <div class="virtual-machine__surface-wrapper">
      <iframe
        ref={iframeRef}
        class="virtual-machine__frame"
        title={`虚拟机显示器 ${machineId}`}
        src={resolvedOrigin}
        referrerPolicy="origin"
        sandbox="allow-scripts allow-same-origin allow-modals allow-pointer-lock"
        allow="autoplay; fullscreen; pointer-lock"
      />
      {pointerLocked ? (
        <div class="virtual-machine__pointer-overlay virtual-machine__pointer-overlay--locked">
          鼠标已捕获。移到屏幕边缘释放，或按 Esc。
          {lastEdgeHit ? (
            <span class="virtual-machine__edge-indicator virtual-machine__edge-indicator--{lastEdgeHit.edge}">
              {' '}边界命中: {lastEdgeHit.edge}
            </span>
          ) : null}
        </div>
      ) : (
        <div class="virtual-machine__pointer-overlay virtual-machine__pointer-overlay--unlocked">
          点击画面捕获鼠标，移到 Guest 边缘自动释放。
        </div>
      )}
    </div>
  )
}