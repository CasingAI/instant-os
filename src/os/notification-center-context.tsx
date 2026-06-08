import type { ComponentChildren } from 'preact'
import { createContext } from 'preact'
import { useCallback, useContext, useMemo, useState } from 'preact/hooks'
import { NotificationBannerHost } from './notification-banner-host.tsx'
import { NotificationCenterPanel } from './notification-center-panel.tsx'
import { StorageWarningBannerHost } from './storage-warning-banner.tsx'

type NotificationPanelScreen = 'list' | 'detail'

type NotificationCenterContextValue = {
  isOpen: boolean
  panelScreen: NotificationPanelScreen
  selectedSlug: string | undefined
  openPanel: (slug?: string) => void
  closePanel: () => void
  togglePanel: () => void
  openDetail: (slug: string) => void
  closeDetail: () => void
}

const NotificationCenterContext = createContext<NotificationCenterContextValue | undefined>(undefined)

export function NotificationCenterProvider({ children }: { children: ComponentChildren }) {
  const [selectedSlug, setSelectedSlug] = useState<string | undefined>(undefined)
  const [panelScreen, setPanelScreen] = useState<NotificationPanelScreen>('list')
  const [isOpen, setIsOpen] = useState(false)

  const openDetail = useCallback((slug: string) => {
    setSelectedSlug(slug)
    setPanelScreen('detail')
  }, [])

  const closeDetail = useCallback(() => {
    setSelectedSlug(undefined)
    setPanelScreen('list')
  }, [])

  const openPanel = useCallback(
    (slug?: string) => {
      if (slug) {
        setSelectedSlug(slug)
        setPanelScreen('detail')
      } else {
        setSelectedSlug(undefined)
        setPanelScreen('list')
      }
      setIsOpen(true)
    },
    [],
  )

  const closePanel = useCallback(() => {
    setIsOpen(false)
    setSelectedSlug(undefined)
    setPanelScreen('list')
  }, [])

  const togglePanel = useCallback(() => {
    if (isOpen) {
      closePanel()
      return
    }
    openPanel()
  }, [isOpen, closePanel, openPanel])

  const value = useMemo(
    () => ({
      isOpen,
      panelScreen,
      selectedSlug,
      openPanel,
      closePanel,
      togglePanel,
      openDetail,
      closeDetail,
    }),
    [isOpen, panelScreen, selectedSlug, openPanel, closePanel, togglePanel, openDetail, closeDetail],
  )

  return (
    <NotificationCenterContext.Provider value={value}>
      {children}
      <NotificationBannerHost />
      <StorageWarningBannerHost />
      <NotificationCenterPanel open={isOpen} onClose={closePanel} />
    </NotificationCenterContext.Provider>
  )
}

export function useNotificationCenter() {
  const context = useContext(NotificationCenterContext)
  if (!context) {
    throw new Error('useNotificationCenter must be used within NotificationCenterProvider')
  }
  return context
}
