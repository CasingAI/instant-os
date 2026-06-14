import type { ComponentChildren, RefObject } from 'preact'
import { createContext } from 'preact'
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { getAppDefinition } from './app-registry.tsx'
import { AboutAppDialog, type AboutAppContent } from './about-app-dialog.tsx'
import { FINDER_ABOUT, INSTANT_ABOUT } from './builtin-app-about.ts'
import type { BuiltinAppId } from './types.ts'

type AboutAppContextValue = {
  showAbout: (content: AboutAppContent) => void
  showBuiltinAbout: (appId: BuiltinAppId) => void
  showFinderAbout: () => void
  showInstantAbout: () => void
}

type AboutAppHostHandle = {
  show: (content: AboutAppContent) => void
}

const AboutAppContext = createContext<AboutAppContextValue | undefined>(undefined)

type AboutAppHostProps = {
  hostRef: RefObject<AboutAppHostHandle | undefined>
}

function AboutAppHost({ hostRef }: AboutAppHostProps) {
  const [content, setContent] = useState<AboutAppContent | undefined>(undefined)

  const closeAbout = useCallback(() => {
    setContent(undefined)
  }, [])

  useEffect(() => {
    hostRef.current = {
      show: (next) => setContent(next),
    }
    return () => {
      hostRef.current = undefined
    }
  }, [hostRef])

  useEffect(() => {
    if (!content) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeAbout()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [content, closeAbout])

  if (!content) {
    return undefined
  }

  return <AboutAppDialog {...content} onClose={closeAbout} />
}

export function AboutAppProvider({ children }: { children: ComponentChildren }) {
  const hostRef = useRef<AboutAppHostHandle | undefined>(undefined)

  const showAbout = useCallback((next: AboutAppContent) => {
    hostRef.current?.show(next)
  }, [])

  const showBuiltinAbout = useCallback(
    (appId: BuiltinAppId) => {
      const definition = getAppDefinition(appId)
      if (!definition?.about) {
        return
      }
      showAbout({
        title: definition.name,
        icon: definition.icon,
        ...definition.about,
      })
    },
    [showAbout],
  )

  const showFinderAbout = useCallback(() => showAbout(FINDER_ABOUT), [showAbout])
  const showInstantAbout = useCallback(() => showAbout(INSTANT_ABOUT), [showAbout])

  const value = useMemo(
    () => ({ showAbout, showBuiltinAbout, showFinderAbout, showInstantAbout }),
    [showAbout, showBuiltinAbout, showFinderAbout, showInstantAbout],
  )

  return (
    <AboutAppContext.Provider value={value}>
      {children}
      <AboutAppHost hostRef={hostRef} />
    </AboutAppContext.Provider>
  )
}

export function useAboutApp() {
  const context = useContext(AboutAppContext)
  if (!context) {
    throw new Error('useAboutApp must be used within AboutAppProvider')
  }
  return context
}
