import { useEffect, useState } from 'preact/hooks'
import {
  getPendingInstallStreamSnapshot,
  subscribePendingInstallStream,
  type PendingInstallStreamSnapshot,
} from './pending-install-stream.ts'

export function usePendingInstallStream(slug: string | undefined): PendingInstallStreamSnapshot {
  const [snapshot, setSnapshot] = useState<PendingInstallStreamSnapshot>(() =>
    slug ? getPendingInstallStreamSnapshot(slug) : { reasoningText: '', rawText: '' },
  )

  useEffect(() => {
    if (!slug) {
      setSnapshot({ reasoningText: '', rawText: '' })
      return
    }

    setSnapshot(getPendingInstallStreamSnapshot(slug))
    return subscribePendingInstallStream(slug, () => {
      setSnapshot(getPendingInstallStreamSnapshot(slug))
    })
  }, [slug])

  return snapshot
}
