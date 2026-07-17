import type { HelpAgentActivity } from './help-agent.ts'

const DEFAULT_GAP_MS = 1000

export type HelpActivityRevealController = {
  reset: () => void
  setSource: (activities: HelpAgentActivity[]) => void
  revealAll: () => void
  waitUntilCaughtUp: () => Promise<void>
  dispose: () => void
}

/** 把突发涌入的活动项按最短间隔逐条揭示，让界面更像在连续推进 */
export function createHelpActivityRevealController(options: {
  gapMs?: number
  onChange: (activities: HelpAgentActivity[]) => void
}): HelpActivityRevealController {
  const gapMs = options.gapMs ?? DEFAULT_GAP_MS
  let source: HelpAgentActivity[] = []
  let displayed = 0
  let lastRevealAt = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  const waiters: Array<() => void> = []

  const publish = () => {
    const slice = source.slice(0, displayed).map((item, index) => {
      const isLastVisible = index === displayed - 1
      const catchingUp = displayed < source.length
      return {
        ...item,
        done: catchingUp ? !isLastVisible : true,
      }
    })
    options.onChange(slice)
  }

  const flushWaiters = () => {
    if (displayed < source.length) {
      return
    }
    while (waiters.length > 0) {
      waiters.shift()?.()
    }
  }

  const clearTimer = () => {
    if (timer === undefined) {
      return
    }
    clearTimeout(timer)
    timer = undefined
  }

  const schedule = () => {
    if (disposed) {
      return
    }
    clearTimer()
    if (displayed >= source.length) {
      flushWaiters()
      return
    }

    const elapsed = Date.now() - lastRevealAt
    const delay = displayed === 0 ? 0 : Math.max(0, gapMs - elapsed)

    timer = setTimeout(() => {
      timer = undefined
      if (disposed || displayed >= source.length) {
        flushWaiters()
        return
      }
      displayed += 1
      lastRevealAt = Date.now()
      publish()
      flushWaiters()
      schedule()
    }, delay)
  }

  return {
    reset() {
      clearTimer()
      source = []
      displayed = 0
      lastRevealAt = 0
      waiters.length = 0
      options.onChange([])
    },
    setSource(activities) {
      if (disposed) {
        return
      }
      source = activities.map((item) => ({ ...item }))
      if (displayed > source.length) {
        displayed = source.length
      }
      if (displayed === 0 && source.length > 0) {
        displayed = 1
        lastRevealAt = Date.now()
        publish()
        flushWaiters()
      } else if (displayed > 0) {
        publish()
      }
      schedule()
    },
    revealAll() {
      if (disposed) {
        return
      }
      clearTimer()
      if (displayed < source.length) {
        displayed = source.length
        lastRevealAt = Date.now()
        publish()
      }
      flushWaiters()
    },
    waitUntilCaughtUp() {
      if (disposed || displayed >= source.length) {
        return Promise.resolve()
      }
      return new Promise<void>((resolve) => {
        waiters.push(resolve)
      })
    },
    dispose() {
      disposed = true
      clearTimer()
      waiters.length = 0
    },
  }
}
