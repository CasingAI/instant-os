import type { ComponentChildren } from 'preact'
import { createContext } from 'preact'
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import {
  GENERATED_APP_HEARTBEAT_DEADLOCK_MISSES,
  GENERATED_APP_HEARTBEAT_FROZEN_MISSES,
  GENERATED_APP_HEARTBEAT_INTERVAL_MS,
  GENERATED_APP_HEARTBEAT_STARTUP_GRACE_MS,
  GENERATED_APP_HEARTBEAT_UNRESPONSIVE_MISSES,
  isGeneratedAppHeartbeatMessage,
  type GeneratedAppHeartbeatPhase,
} from '../apps/generated/generated-app-heartbeat-types.ts'
import type { GeneratedAppId } from './types.ts'

type HeartbeatSource = {
  appId: GeneratedAppId
  contentWindow: Window | undefined
  registeredAt: number
  lastBeatAt: number
  consecutiveMisses: number
  ready: boolean
}

function shouldCountHeartbeatMiss(source: HeartbeatSource, now: number): boolean {
  if (source.ready) {
    return true
  }

  if (source.contentWindow !== undefined) {
    return true
  }

  return now - source.registeredAt >= GENERATED_APP_HEARTBEAT_STARTUP_GRACE_MS
}

type GeneratedAppHeartbeatContextValue = {
  registerHeartbeat: (windowId: string, appId: GeneratedAppId) => void
  unregisterHeartbeat: (windowId: string) => void
  resetHeartbeatMonitoring: (windowId: string) => void
  setHeartbeatContentWindow: (windowId: string, contentWindow: Window | undefined) => void
  markHeartbeatReady: (windowId: string) => void
  getWindowHeartbeatPhase: (windowId: string) => GeneratedAppHeartbeatPhase | undefined
  isAppUnresponsive: (appId: GeneratedAppId) => boolean
  isWindowUnresponsive: (windowId: string) => boolean
  isWindowFrozen: (windowId: string) => boolean
  isAnyWindowDeadlocked: () => boolean
}

const GeneratedAppHeartbeatContext = createContext<GeneratedAppHeartbeatContextValue | undefined>(
  undefined,
)

function resolveHeartbeatPhase(source: HeartbeatSource | undefined): GeneratedAppHeartbeatPhase | undefined {
  if (!source) {
    return undefined
  }

  if (source.consecutiveMisses >= GENERATED_APP_HEARTBEAT_DEADLOCK_MISSES) {
    return 'deadlock'
  }

  if (source.consecutiveMisses >= GENERATED_APP_HEARTBEAT_FROZEN_MISSES) {
    return 'frozen'
  }

  if (source.consecutiveMisses >= GENERATED_APP_HEARTBEAT_UNRESPONSIVE_MISSES) {
    return 'unresponsive'
  }

  if (!source.ready) {
    return 'starting'
  }

  return 'healthy'
}

export function GeneratedAppHeartbeatProvider({ children }: { children: ComponentChildren }) {
  const sourcesRef = useRef(new Map<string, HeartbeatSource>())
  const [revision, setRevision] = useState(0)

  const bumpRevision = useCallback(() => {
    setRevision((current) => current + 1)
  }, [])

  const registerHeartbeat = useCallback(
    (windowId: string, appId: GeneratedAppId) => {
      const now = Date.now()
      sourcesRef.current.set(windowId, {
        appId,
        contentWindow: undefined,
        registeredAt: now,
        lastBeatAt: now,
        consecutiveMisses: 0,
        ready: false,
      })
      bumpRevision()
    },
    [bumpRevision],
  )

  const unregisterHeartbeat = useCallback(
    (windowId: string) => {
      if (!sourcesRef.current.delete(windowId)) {
        return
      }
      bumpRevision()
    },
    [bumpRevision],
  )

  const setHeartbeatContentWindow = useCallback(
    (windowId: string, contentWindow: Window | undefined) => {
      const source = sourcesRef.current.get(windowId)
      if (!source) {
        return
      }

      source.contentWindow = contentWindow
    },
    [],
  )

  const resetHeartbeatMonitoring = useCallback(
    (windowId: string) => {
      const source = sourcesRef.current.get(windowId)
      if (!source) {
        return
      }

      const now = Date.now()
      source.contentWindow = undefined
      source.registeredAt = now
      source.lastBeatAt = now
      source.consecutiveMisses = 0
      source.ready = false
      bumpRevision()
    },
    [bumpRevision],
  )

  const markHeartbeatReady = useCallback(
    (windowId: string) => {
      const source = sourcesRef.current.get(windowId)
      if (!source || source.ready) {
        return
      }

      source.ready = true
      source.lastBeatAt = Date.now()
      source.consecutiveMisses = 0
      bumpRevision()
    },
    [bumpRevision],
  )

  const handleHeartbeat = useCallback(
    (windowId: string) => {
      const source = sourcesRef.current.get(windowId)
      if (!source) {
        return
      }

      const wasReady = source.ready
      const previousMisses = source.consecutiveMisses
      source.lastBeatAt = Date.now()
      source.consecutiveMisses = 0

      if (!wasReady) {
        source.ready = true
      }

      if (previousMisses > 0 || !wasReady) {
        bumpRevision()
      }
    },
    [bumpRevision],
  )

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!isGeneratedAppHeartbeatMessage(event.data)) {
        return
      }

      const source = sourcesRef.current.get(event.data.windowId)
      if (!source) {
        return
      }

      if (source.contentWindow && event.source !== source.contentWindow) {
        return
      }

      if (source.appId !== event.data.appId) {
        return
      }

      handleHeartbeat(event.data.windowId)
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [handleHeartbeat])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now()
      let changed = false

      for (const source of sourcesRef.current.values()) {
        if (!shouldCountHeartbeatMiss(source, now)) {
          continue
        }

        if (now - source.lastBeatAt > GENERATED_APP_HEARTBEAT_INTERVAL_MS) {
          const previousMisses = source.consecutiveMisses
          source.consecutiveMisses += 1

          const crossedUnresponsive =
            previousMisses < GENERATED_APP_HEARTBEAT_UNRESPONSIVE_MISSES &&
            source.consecutiveMisses >= GENERATED_APP_HEARTBEAT_UNRESPONSIVE_MISSES
          const crossedFrozen =
            previousMisses < GENERATED_APP_HEARTBEAT_FROZEN_MISSES &&
            source.consecutiveMisses >= GENERATED_APP_HEARTBEAT_FROZEN_MISSES
          const crossedDeadlock =
            previousMisses < GENERATED_APP_HEARTBEAT_DEADLOCK_MISSES &&
            source.consecutiveMisses >= GENERATED_APP_HEARTBEAT_DEADLOCK_MISSES

          if (crossedUnresponsive || crossedFrozen || crossedDeadlock || source.consecutiveMisses === previousMisses + 1) {
            changed = true
          }
        }
      }

      if (changed) {
        bumpRevision()
      }
    }, GENERATED_APP_HEARTBEAT_INTERVAL_MS)

    return () => window.clearInterval(timer)
  }, [bumpRevision])

  const getWindowHeartbeatPhase = useCallback((windowId: string): GeneratedAppHeartbeatPhase | undefined => {
    void revision
    return resolveHeartbeatPhase(sourcesRef.current.get(windowId))
  }, [revision])

  const isAppUnresponsive = useCallback((appId: GeneratedAppId): boolean => {
    void revision
    for (const source of sourcesRef.current.values()) {
      if (source.appId !== appId) {
        continue
      }

      if (source.consecutiveMisses >= GENERATED_APP_HEARTBEAT_UNRESPONSIVE_MISSES) {
        return true
      }
    }
    return false
  }, [revision])

  const isWindowUnresponsive = useCallback((windowId: string): boolean => {
    void revision
    const source = sourcesRef.current.get(windowId)
    if (!source) {
      return false
    }
    return source.consecutiveMisses >= GENERATED_APP_HEARTBEAT_UNRESPONSIVE_MISSES
  }, [revision])

  const isWindowFrozen = useCallback((windowId: string): boolean => {
    void revision
    const source = sourcesRef.current.get(windowId)
    if (!source) {
      return false
    }
    return source.consecutiveMisses >= GENERATED_APP_HEARTBEAT_FROZEN_MISSES
  }, [revision])

  const isAnyWindowDeadlocked = useCallback((): boolean => {
    void revision
    for (const source of sourcesRef.current.values()) {
      if (source.consecutiveMisses >= GENERATED_APP_HEARTBEAT_DEADLOCK_MISSES) {
        return true
      }
    }
    return false
  }, [revision])

  const value = useMemo(
    (): GeneratedAppHeartbeatContextValue => ({
      registerHeartbeat,
      unregisterHeartbeat,
      resetHeartbeatMonitoring,
      setHeartbeatContentWindow,
      markHeartbeatReady,
      getWindowHeartbeatPhase,
      isAppUnresponsive,
      isWindowUnresponsive,
      isWindowFrozen,
      isAnyWindowDeadlocked,
    }),
    [
      registerHeartbeat,
      unregisterHeartbeat,
      resetHeartbeatMonitoring,
      setHeartbeatContentWindow,
      markHeartbeatReady,
      getWindowHeartbeatPhase,
      isAppUnresponsive,
      isWindowUnresponsive,
      isWindowFrozen,
      isAnyWindowDeadlocked,
    ],
  )

  return (
    <GeneratedAppHeartbeatContext.Provider value={value}>
      {children}
    </GeneratedAppHeartbeatContext.Provider>
  )
}

export function useGeneratedAppHeartbeat() {
  const context = useContext(GeneratedAppHeartbeatContext)
  if (!context) {
    throw new Error('useGeneratedAppHeartbeat must be used within GeneratedAppHeartbeatProvider')
  }
  return context
}
