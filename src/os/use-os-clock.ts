import { useEffect, useState } from 'preact/hooks'
import { OS_CLOCK_CHANGED_EVENT, osNowDate } from './os-clock.ts'

export function useOsNowDate(tickMs = 1000): Date {
  const [now, setNow] = useState(() => osNowDate())

  useEffect(() => {
    const sync = () => setNow(osNowDate())
    sync()
    const intervalId = window.setInterval(sync, tickMs)
    window.addEventListener(OS_CLOCK_CHANGED_EVENT, sync)
    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener(OS_CLOCK_CHANGED_EVENT, sync)
    }
  }, [tickMs])

  return now
}
