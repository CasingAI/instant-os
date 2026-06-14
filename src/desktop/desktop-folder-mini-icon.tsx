import { useEffect, useRef, useState } from 'preact/hooks'
import type { FolderPreviewApp } from './desktop-folder-icon.tsx'
import {
  getFolderMiniIconSnapshotKey,
  peekFolderMiniIconSnapshot,
  resolveFolderMiniIconSnapshot,
  warmFolderMiniIconSnapshotCache,
} from './desktop-folder-mini-icon-service.tsx'

type DesktopFolderMiniIconProps = {
  app: FolderPreviewApp
  displaySize: number
  borderRadius: number
}

export function DesktopFolderMiniIcon({
  app,
  displaySize,
  borderRadius,
}: DesktopFolderMiniIconProps) {
  const cacheKey = getFolderMiniIconSnapshotKey(app)
  const rootRef = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(false)
  const [snapshotUrl, setSnapshotUrl] = useState<string | undefined>(() =>
    peekFolderMiniIconSnapshot(cacheKey),
  )

  useEffect(() => {
    const node = rootRef.current
    if (!node) {
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true)
        }
      },
      { rootMargin: '96px' },
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    void warmFolderMiniIconSnapshotCache().then(() => {
      if (snapshotUrl) {
        return
      }
      const warmed = peekFolderMiniIconSnapshot(cacheKey)
      if (warmed) {
        setSnapshotUrl(warmed)
      }
    })
  }, [cacheKey, snapshotUrl])

  useEffect(() => {
    if (!visible || snapshotUrl) {
      return
    }

    let cancelled = false

    void resolveFolderMiniIconSnapshot(app).then((dataUrl) => {
      if (!cancelled && dataUrl) {
        setSnapshotUrl(dataUrl)
      }
    })

    return () => {
      cancelled = true
    }
  }, [app, snapshotUrl, visible])

  if (!snapshotUrl) {
    return (
      <span
        ref={rootRef}
        class="desktop-folder-icon__icon desktop-folder-icon__icon--pending"
        style={{
          width: `${displaySize}px`,
          height: `${displaySize}px`,
          borderRadius: `${borderRadius}px`,
        }}
        aria-hidden="true"
      />
    )
  }

  return (
    <span
      ref={rootRef}
      class="desktop-folder-icon__icon desktop-folder-icon__icon--snapshot"
      style={{
        width: `${displaySize}px`,
        height: `${displaySize}px`,
        borderRadius: `${borderRadius}px`,
      }}
    >
      <img
        class="desktop-folder-icon__icon-image"
        src={snapshotUrl}
        width={displaySize}
        height={displaySize}
        alt=""
        draggable={false}
      />
    </span>
  )
}

export { invalidateFolderMiniIconSnapshot } from './desktop-folder-mini-icon-service.tsx'
