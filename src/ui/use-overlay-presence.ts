import { useEffect, useState } from 'preact/hooks'

const DEFAULT_EXIT_DURATION_MS = 200

export function useOverlayPresence(open: boolean, exitDurationMs = DEFAULT_EXIT_DURATION_MS) {
  const [phase, setPhase] = useState<'hidden' | 'visible' | 'exiting'>(() =>
    open ? 'visible' : 'hidden',
  )

  useEffect(() => {
    if (open) {
      setPhase('visible')
      return
    }

    setPhase((current) => (current === 'hidden' ? 'hidden' : 'exiting'))
  }, [open])

  useEffect(() => {
    if (phase !== 'exiting') {
      return
    }

    const timer = window.setTimeout(() => setPhase('hidden'), exitDurationMs)
    return () => window.clearTimeout(timer)
  }, [phase, exitDurationMs])

  return {
    mounted: phase !== 'hidden',
    exiting: phase === 'exiting',
  }
}
