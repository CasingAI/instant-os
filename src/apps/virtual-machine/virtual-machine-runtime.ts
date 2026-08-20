import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import {
  INSTANT_VM_MESSAGE_TYPE,
  collectStartTransfers,
  isInstantVmRuntimeToHostMessage,
  type InstantVmStartMessage,
} from './virtual-machine-protocol.ts'

const REQUEST_TIMEOUT_MS = 60_000
const REMOTE_DISK_REQUEST_TIMEOUT_MS = 180_000

type Pending = {
  resolve: () => void
  reject: (error: Error) => void
}

function newRequestId(): string {
  return `vm-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`
}

export function useVirtualMachineRuntime(origin: string | undefined) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const pendingRef = useRef(new Map<string, Pending>())
  const [ready, setReady] = useState(false)

  const failAll = useCallback((error: Error) => {
    for (const pending of pendingRef.current.values()) {
      pending.reject(error)
    }
    pendingRef.current.clear()
  }, [])

  useEffect(() => {
    setReady(false)
    failAll(new Error('运行时已重新加载'))
  }, [failAll, origin])

  useEffect(() => {
    if (!origin) {
      return
    }

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin) {
        return
      }
      if (event.source !== iframeRef.current?.contentWindow) {
        return
      }
      if (!isInstantVmRuntimeToHostMessage(event.data)) {
        return
      }

      const message = event.data
      if (message.type === INSTANT_VM_MESSAGE_TYPE.ready) {
        setReady(true)
        return
      }

      if (message.type === INSTANT_VM_MESSAGE_TYPE.error) {
        const error = new Error(message.message)
        if (message.requestId) {
          const pending = pendingRef.current.get(message.requestId)
          pendingRef.current.delete(message.requestId)
          pending?.reject(error)
          return
        }
        failAll(error)
        return
      }

      const pending = pendingRef.current.get(message.requestId)
      if (!pending) {
        return
      }
      pendingRef.current.delete(message.requestId)
      pending.resolve()
    }

    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
      failAll(new Error('运行时已卸载'))
    }
  }, [failAll, origin])

  const post = useCallback(
    (message: object, transfer: Transferable[] = []) => {
      const contentWindow = iframeRef.current?.contentWindow
      if (!origin || !contentWindow) {
        throw new Error('虚拟机运行时未就绪')
      }
      contentWindow.postMessage(message, origin, transfer)
    },
    [origin],
  )

  const request = useCallback(
    (message: { requestId: string }, transfer: Transferable[] = [], timeoutMs = REQUEST_TIMEOUT_MS) => {
      return new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          pendingRef.current.delete(message.requestId)
          reject(new Error('运行时无响应'))
        }, timeoutMs)
        pendingRef.current.set(message.requestId, {
          resolve: () => {
            window.clearTimeout(timer)
            resolve()
          },
          reject: (error) => {
            window.clearTimeout(timer)
            reject(error)
          },
        })
        try {
          post(message, transfer)
        } catch (error) {
          window.clearTimeout(timer)
          pendingRef.current.delete(message.requestId)
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      })
    },
    [post],
  )

  const start = useCallback(
    async (message: InstantVmStartMessage) => {
      const timeoutMs =
        message.hdaUrl || message.cdromUrl || message.fdaUrl || message.stateUrl
          ? REMOTE_DISK_REQUEST_TIMEOUT_MS
          : REQUEST_TIMEOUT_MS
      await request(message, collectStartTransfers(message), timeoutMs)
    },
    [request],
  )

  const stop = useCallback(async () => {
    await request({ type: INSTANT_VM_MESSAGE_TYPE.stop, requestId: newRequestId() })
  }, [request])

  const reset = useCallback(async () => {
    await request({ type: INSTANT_VM_MESSAGE_TYPE.reset, requestId: newRequestId() })
  }, [request])

  return {
    iframeRef,
    ready,
    start,
    stop,
    reset,
    newRequestId,
  }
}
