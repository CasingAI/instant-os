import type { ComponentChildren, RefObject } from 'preact'
import { createContext } from 'preact'
import { useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks'
import { NotificationBannerHost } from './notification-banner-host.tsx'
import { NotificationCenterPanel } from './notification-center-panel.tsx'
import {
  getNotificationCenterStoreState,
  setNotificationCenterStoreState,
  subscribeNotificationCenterStore,
} from './notification-center-store.ts'
import { ProcessIsolationFallbackBannerHost } from './process-isolation-fallback-banner.tsx'
import { StorageWarningBannerHost } from './storage-warning-banner.tsx'

type NotificationPanelScreen = 'list' | 'detail'

type NotificationCenterActions = {
  openPanel: (slug?: string) => void
  closePanel: () => void
  togglePanel: () => void
  openDetail: (slug: string) => void
  closeDetail: () => void
}

type NotificationCenterContextValue = NotificationCenterActions & {
  isOpen: boolean
  panelScreen: NotificationPanelScreen
  selectedSlug: string | undefined
}

type NotificationCenterHostHandle = NotificationCenterActions

const NotificationCenterActionsContext = createContext<NotificationCenterActions | undefined>(undefined)

type NotificationCenterHostProps = {
  hostRef: RefObject<NotificationCenterHostHandle | undefined>
}

function NotificationCenterHost({ hostRef }: NotificationCenterHostProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [panelScreen, setPanelScreen] = useState<NotificationPanelScreen>('list')
  const [selectedSlug, setSelectedSlug] = useState<string | undefined>(undefined)

  useEffect(() => {
    setNotificationCenterStoreState({ isOpen, panelScreen, selectedSlug })
  }, [isOpen, panelScreen, selectedSlug])

  const openDetail = useCallback((slug: string) => {
    setSelectedSlug(slug)
    setPanelScreen('detail')
  }, [])

  const closeDetail = useCallback(() => {
    setSelectedSlug(undefined)
    setPanelScreen('list')
  }, [])

  const openPanel = useCallback((slug?: string) => {
    if (slug) {
      setSelectedSlug(slug)
      setPanelScreen('detail')
    } else {
      setSelectedSlug(undefined)
      setPanelScreen('list')
    }
    setIsOpen(true)
  }, [])

  const closePanel = useCallback(() => {
    setIsOpen(false)
    setSelectedSlug(undefined)
    setPanelScreen('list')
  }, [])

  const togglePanel = useCallback(() => {
    setIsOpen((current) => {
      if (current) {
        setSelectedSlug(undefined)
        setPanelScreen('list')
        return false
      }
      return true
    })
  }, [])

  useEffect(() => {
    hostRef.current = {
      openPanel,
      closePanel,
      togglePanel,
      openDetail,
      closeDetail,
    }
    return () => {
      hostRef.current = undefined
    }
  }, [closeDetail, closePanel, openDetail, openPanel, togglePanel, hostRef])

  return (
    <>
      <NotificationBannerHost />
      <StorageWarningBannerHost />
      <ProcessIsolationFallbackBannerHost />
      <NotificationCenterPanel open={isOpen} onClose={closePanel} />
    </>
  )
}

export function NotificationCenterProvider({ children }: { children: ComponentChildren }) {
  const hostRef = useRef<NotificationCenterHostHandle | undefined>(undefined)

  const openPanel = useCallback((slug?: string) => {
    hostRef.current?.openPanel(slug)
  }, [])

  const closePanel = useCallback(() => {
    hostRef.current?.closePanel()
  }, [])

  const togglePanel = useCallback(() => {
    hostRef.current?.togglePanel()
  }, [])

  const openDetail = useCallback((slug: string) => {
    hostRef.current?.openDetail(slug)
  }, [])

  const closeDetail = useCallback(() => {
    hostRef.current?.closeDetail()
  }, [])

  const actions = useMemo(
    () => ({ openPanel, closePanel, togglePanel, openDetail, closeDetail }),
    [openPanel, closePanel, togglePanel, openDetail, closeDetail],
  )

  return (
    <NotificationCenterActionsContext.Provider value={actions}>
      {children}
      <NotificationCenterHost hostRef={hostRef} />
    </NotificationCenterActionsContext.Provider>
  )
}

export function useNotificationCenter(): NotificationCenterContextValue {
  const actions = useContext(NotificationCenterActionsContext)
  if (!actions) {
    throw new Error('useNotificationCenter must be used within NotificationCenterProvider')
  }

  const [, rerender] = useReducer((value: number) => value + 1, 0)

  useEffect(() => subscribeNotificationCenterStore(() => rerender(0)), [])

  return {
    ...actions,
    ...getNotificationCenterStoreState(),
  }
}
