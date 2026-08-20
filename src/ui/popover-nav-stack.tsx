import type { ComponentChildren } from 'preact'
import { useCallback, useLayoutEffect, useRef, useState } from 'preact/hooks'
import './popover-nav-stack.css'

export type PopoverNavDirection = 'push' | 'pop'

export type PopoverNavTransition<T extends string> = {
  direction: PopoverNavDirection
  from: T
  to: T
}

const NAV_MOTION_MS = 200

function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

export function usePopoverNavStack<T extends string>(initial: T) {
  const [page, setPage] = useState(initial)
  const [stack, setStack] = useState<T[]>([initial])
  const [transition, setTransition] = useState<PopoverNavTransition<T> | undefined>()
  const transitionRef = useRef(transition)
  transitionRef.current = transition
  const initialRef = useRef(initial)

  const finishTransition = useCallback(() => {
    const current = transitionRef.current
    if (!current) return
    transitionRef.current = undefined
    setTransition(undefined)
    if (current.direction === 'pop') {
      setStack((prev) => {
        const idx = prev.lastIndexOf(current.to)
        return idx >= 0 ? prev.slice(0, idx + 1) : [current.to]
      })
    }
  }, [])

  const push = useCallback(
    (next: T) => {
      if (next === page || transitionRef.current) return
      setStack((prev) => (prev[prev.length - 1] === next ? prev : [...prev, next]))
      if (prefersReducedMotion()) {
        setPage(next)
        return
      }
      setPage(next)
      setTransition({ direction: 'push', from: page, to: next })
    },
    [page],
  )

  const pop = useCallback(() => {
    if (stack.length <= 1 || transitionRef.current) return false
    const next = stack[stack.length - 2]!
    if (prefersReducedMotion()) {
      setStack((prev) => prev.slice(0, -1))
      setPage(next)
      return true
    }
    setPage(next)
    setTransition({ direction: 'pop', from: page, to: next })
    return true
  }, [page, stack])

  const reset = useCallback(() => {
    const root = initialRef.current
    transitionRef.current = undefined
    setTransition(undefined)
    setStack([root])
    setPage(root)
  }, [])

  return {
    page,
    stack,
    transition,
    canPop: stack.length > 1,
    push,
    pop,
    reset,
    finishTransition,
  }
}

type PopoverNavStackProps<T extends string> = {
  page: T
  transition?: PopoverNavTransition<T>
  onTransitionEnd: () => void
  renderPage: (page: T) => ComponentChildren
  dark?: boolean
  class?: string
}

export function PopoverNavStack<T extends string>({
  page,
  transition,
  onTransitionEnd,
  renderPage,
  dark,
  class: className,
}: PopoverNavStackProps<T>) {
  const stackRef = useRef<HTMLDivElement>(null)
  const underRef = useRef<HTMLDivElement>(null)
  const overRef = useRef<HTMLDivElement>(null)
  const settledRef = useRef(false)

  const under = transition
    ? transition.direction === 'push'
      ? transition.from
      : transition.to
    : undefined
  const over = transition
    ? transition.direction === 'push'
      ? transition.to
      : transition.from
    : undefined

  useLayoutEffect(() => {
    const stackEl = stackRef.current
    if (!transition || !stackEl) {
      if (stackEl) {
        stackEl.style.height = ''
        stackEl.style.transition = ''
      }
      return
    }

    const underEl = underRef.current
    const overEl = overRef.current
    if (!underEl || !overEl) return

    const fromHeight =
      transition.direction === 'push' ? underEl.offsetHeight : overEl.offsetHeight
    const toHeight =
      transition.direction === 'push' ? overEl.offsetHeight : underEl.offsetHeight

    settledRef.current = false
    stackEl.style.transition = 'none'
    stackEl.style.height = `${fromHeight}px`
    // 强制同步布局，保证下一帧 transition 从 from 起算
    void stackEl.offsetHeight

    const frame = window.requestAnimationFrame(() => {
      stackEl.style.transition = `height ${NAV_MOTION_MS}ms ease-out`
      stackEl.style.height = `${toHeight}px`
    })
    return () => window.cancelAnimationFrame(frame)
  }, [transition])

  const settle = useCallback(() => {
    if (settledRef.current) return
    settledRef.current = true
    onTransitionEnd()
  }, [onTransitionEnd])

  const handleOverAnimationEnd = (event: AnimationEvent) => {
    if (event.target !== event.currentTarget) return
    const name = event.animationName
    if (
      name !== 'popover-nav-slide-in' &&
      name !== 'popover-nav-slide-out' &&
      name !== 'popover-nav-slide-out-back'
    ) {
      return
    }
    settle()
  }

  const handleHeightTransitionEnd = (event: TransitionEvent) => {
    if (event.target !== event.currentTarget) return
    if (event.propertyName !== 'height') return
    settle()
  }

  if (!transition || under === undefined || over === undefined) {
    return (
      <div
        ref={stackRef}
        class={`popover-nav-stack${dark ? ' popover-nav-stack--dark' : ''}${className ? ` ${className}` : ''}`}
        style={{ ['--popover-nav-motion-ms' as string]: `${NAV_MOTION_MS}ms` }}
      >
        <div class="popover-nav-stack__page">{renderPage(page)}</div>
      </div>
    )
  }

  const directionClass =
    transition.direction === 'push'
      ? ' popover-nav-stack--push'
      : ' popover-nav-stack--pop'

  return (
    <div
      ref={stackRef}
      class={`popover-nav-stack popover-nav-stack--animating${directionClass}${dark ? ' popover-nav-stack--dark' : ''}${className ? ` ${className}` : ''}`}
      style={{ ['--popover-nav-motion-ms' as string]: `${NAV_MOTION_MS}ms` }}
      onTransitionEnd={handleHeightTransitionEnd}
    >
      <div
        ref={underRef}
        class="popover-nav-stack__page popover-nav-stack__page--under"
        aria-hidden="true"
      >
        {renderPage(under)}
      </div>
      <div
        ref={overRef}
        class="popover-nav-stack__page popover-nav-stack__page--over"
        onAnimationEnd={handleOverAnimationEnd}
      >
        {renderPage(over)}
      </div>
    </div>
  )
}
