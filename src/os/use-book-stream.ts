import { useEffect, useState } from 'preact/hooks'
import {
  getBookStream,
  subscribeBookStream,
  type BookStreamSnapshot,
} from './book-stream-store.ts'

export function useBookStream(slug: string | undefined): BookStreamSnapshot {
  const [snapshot, setSnapshot] = useState<BookStreamSnapshot>(() =>
    slug ? getBookStream(slug) : { rawText: '' },
  )

  useEffect(() => {
    if (!slug) {
      setSnapshot({ rawText: '' })
      return
    }

    setSnapshot(getBookStream(slug))
    return subscribeBookStream(slug, () => {
      setSnapshot(getBookStream(slug))
    })
  }, [slug])

  return snapshot
}
