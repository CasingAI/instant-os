import type { ComponentChildren } from 'preact'
import { createContext } from 'preact'
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import {
  EXPERIMENTAL_SETTINGS_CHANGED_EVENT,
  loadExperimentalSettings,
} from './experimental-settings-storage.ts'
import { useOs } from './os-context.tsx'
import {
  FULLSCREEN_CHROME_DISMISS_CATCHER_PX,
  FULLSCREEN_CHROME_TOP_TRIGGER_PX,
  IMMERSIVE_FRAME_CHROME_TOP,
} from '../window/window-metrics.ts'
import './fullscreen-chrome-edge-sensor.css'

export {
  FULLSCREEN_CHROME_DISMISS_CATCHER_PX,
  FULLSCREEN_CHROME_TOP_TRIGGER_PX,
  IMMERSIVE_FRAME_CHROME_TOP,
}

function isImmersiveChromeElement(node: Node | null): boolean {
  if (!(node instanceof Element)) {
    return false
  }

  return (
    node.closest('.menu-bar') !== null ||
    node.closest('.window-frame--chrome-revealed .window-frame__titlebar') !== null
  )
}

type FullscreenChromeRevealContextValue = {
  immersiveChromeEnabled: boolean
  hasImmersiveFullscreen: boolean
  chromeRevealed: boolean
  setChromePinSource: (source: string, pinned: boolean) => void
}

const FullscreenChromeRevealContext = createContext<FullscreenChromeRevealContextValue | undefined>(
  undefined,
)

export function FullscreenChromeRevealProvider({ children }: { children: ComponentChildren }) {
  const { windows } = useOs()
  const [settings, setSettings] = useState(loadExperimentalSettings)
  const [chromeRevealed, setChromeRevealed] = useState(false)
  const chromeRevealedRef = useRef(chromeRevealed)
  const pinSourcesRef = useRef(new Set<string>())
  const lastPointerYRef = useRef<number | undefined>(undefined)

  const syncChromeRevealAtY = useCallback((y: number) => {
    lastPointerYRef.current = y

    if (pinSourcesRef.current.size > 0) {
      setChromeRevealed(true)
      return
    }

    if (y <= FULLSCREEN_CHROME_TOP_TRIGGER_PX) {
      setChromeRevealed(true)
      return
    }

    if (y <= IMMERSIVE_FRAME_CHROME_TOP) {
      setChromeRevealed(chromeRevealedRef.current)
      return
    }

    setChromeRevealed(false)
  }, [])

  const dismissChromeIfAllowed = useCallback(() => {
    if (pinSourcesRef.current.size > 0) {
      return
    }
    setChromeRevealed(false)
  }, [])

  useEffect(() => {
    chromeRevealedRef.current = chromeRevealed
  }, [chromeRevealed])

  useEffect(() => {
    const syncSettings = () => {
      setSettings(loadExperimentalSettings())
    }

    window.addEventListener(EXPERIMENTAL_SETTINGS_CHANGED_EVENT, syncSettings)
    return () => window.removeEventListener(EXPERIMENTAL_SETTINGS_CHANGED_EVENT, syncSettings)
  }, [])

  const immersiveChromeEnabled = settings.fullscreenImmersiveChrome
  const hasImmersiveFullscreen =
    immersiveChromeEnabled && windows.some((window) => window.fullscreen && !window.minimized)

  const setChromePinSource = useCallback((source: string, pinned: boolean) => {
    if (pinned) {
      pinSourcesRef.current.add(source)
    } else {
      pinSourcesRef.current.delete(source)
    }

    if (pinSourcesRef.current.size > 0) {
      setChromeRevealed(true)
      return
    }

    const lastY = lastPointerYRef.current
    if (lastY !== undefined) {
      syncChromeRevealAtY(lastY)
    }
  }, [syncChromeRevealAtY])

  useEffect(() => {
    const trackPointer = (event: PointerEvent) => {
      lastPointerYRef.current = event.clientY
    }

    window.addEventListener('pointermove', trackPointer, { passive: true })
    return () => window.removeEventListener('pointermove', trackPointer)
  }, [])

  useEffect(() => {
    if (!hasImmersiveFullscreen) {
      pinSourcesRef.current.clear()
      setChromeRevealed(false)
      return
    }

    const handlePointerMove = (event: PointerEvent) => {
      syncChromeRevealAtY(event.clientY)
    }

    window.addEventListener('pointermove', handlePointerMove, { passive: true })

    const lastY = lastPointerYRef.current
    if (lastY !== undefined) {
      syncChromeRevealAtY(lastY)
    }

    return () => window.removeEventListener('pointermove', handlePointerMove)
  }, [hasImmersiveFullscreen, syncChromeRevealAtY])

  useEffect(() => {
    if (!hasImmersiveFullscreen || !chromeRevealed) {
      return
    }

    const handleChromeLeave = (event: Event) => {
      const pointerEvent = event as PointerEvent
      if (isImmersiveChromeElement(pointerEvent.relatedTarget as Node | null)) {
        return
      }
      dismissChromeIfAllowed()
    }

    const handlePointerOut = (event: Event) => {
      const pointerEvent = event as PointerEvent
      if (pointerEvent.relatedTarget !== null) {
        return
      }
      if (!(pointerEvent.target instanceof Element)) {
        return
      }
      if (!isImmersiveChromeElement(pointerEvent.target)) {
        return
      }
      dismissChromeIfAllowed()
    }

    const bindChromeLeaveTargets = () => {
      const targets: Element[] = []
      const menuBar = document.querySelector('.menu-bar')
      if (menuBar) {
        targets.push(menuBar)
      }
      document
        .querySelectorAll('.window-frame--chrome-revealed .window-frame__titlebar')
        .forEach((titlebar) => targets.push(titlebar))
      return targets
    }

    const targets = bindChromeLeaveTargets()
    for (const target of targets) {
      target.addEventListener('pointerleave', handleChromeLeave)
    }
    document.addEventListener('pointerout', handlePointerOut, true)

    return () => {
      for (const target of targets) {
        target.removeEventListener('pointerleave', handleChromeLeave)
      }
      document.removeEventListener('pointerout', handlePointerOut, true)
    }
  }, [chromeRevealed, dismissChromeIfAllowed, hasImmersiveFullscreen])

  const value = useMemo(
    () => ({
      immersiveChromeEnabled,
      hasImmersiveFullscreen,
      chromeRevealed,
      setChromePinSource,
    }),
    [immersiveChromeEnabled, hasImmersiveFullscreen, chromeRevealed, setChromePinSource],
  )

  return (
    <FullscreenChromeRevealContext.Provider value={value}>
      {hasImmersiveFullscreen && !chromeRevealed && (
        <div
          class="fullscreen-chrome-edge-sensor fullscreen-chrome-edge-sensor--reveal"
          style={{ height: `${FULLSCREEN_CHROME_TOP_TRIGGER_PX}px` }}
          aria-hidden="true"
          onPointerEnter={() => setChromeRevealed(true)}
          onPointerMove={() => setChromeRevealed(true)}
        />
      )}
      {hasImmersiveFullscreen && chromeRevealed && (
        <div
          class="fullscreen-chrome-edge-sensor fullscreen-chrome-edge-sensor--dismiss"
          style={{
            top: `${IMMERSIVE_FRAME_CHROME_TOP}px`,
            height: `${FULLSCREEN_CHROME_DISMISS_CATCHER_PX}px`,
          }}
          aria-hidden="true"
          onPointerEnter={dismissChromeIfAllowed}
          onPointerMove={dismissChromeIfAllowed}
        />
      )}
      {children}
    </FullscreenChromeRevealContext.Provider>
  )
}

export function useFullscreenChromeReveal(): FullscreenChromeRevealContextValue {
  const value = useContext(FullscreenChromeRevealContext)
  if (!value) {
    throw new Error('useFullscreenChromeReveal must be used within FullscreenChromeRevealProvider')
  }
  return value
}
