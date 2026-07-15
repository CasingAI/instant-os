import { useEffect, useState } from 'preact/hooks'
import type { CalendarInstant } from './calendar-instant.ts'
import { getOsNowInstant, OS_CLOCK_CHANGED_EVENT, osNowDate } from './os-clock.ts'

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

export function useOsNowInstant(tickMs = 1000): CalendarInstant {
  const [now, setNow] = useState(() => getOsNowInstant())

  useEffect(() => {
    const sync = () => setNow(getOsNowInstant())
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
