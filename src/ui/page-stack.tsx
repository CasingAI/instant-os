import type { ComponentChildren, Ref } from 'preact'
import { useCallback, useRef, useState } from 'preact/hooks'
import './page-stack.css'

export type PageStackDirection = 'push' | 'pop'

export type PageStackTransition<T extends string> = {
  direction: PageStackDirection
  from: T
  to: T
}

function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * 页面栈状态机：push/pop + iOS 6 式转场（header 交叉淡移、正文整页滑入/滑出）。
 * 转场两页始终保活（layer 不卸载），滚动位置由各页 .page__body 自行保留，
 * 因此不需要像钥匙串旧实现那样在转场前偷拍 scrollTop。
 */
export function usePageStack<T extends string>(initial: T) {
  const [page, setPageState] = useState<T>(initial)
  const [stack, setStack] = useState<T[]>([initial])
  /** 已应用到 CSS 的转场（会触发 display:contents） */
  const [transition, setTransition] = useState<
    PageStackTransition<T> | undefined
  >(undefined)
  const settledRef = useRef<(() => void) | undefined>(undefined)
  const transitionRef = useRef(transition)
  transitionRef.current = transition

  const finishSettled = useCallback(() => {
    const settled = settledRef.current
    settledRef.current = undefined
    settled?.()
  }, [])

  const navigate = useCallback(
    (next: T, direction: PageStackDirection, onSettled?: () => void) => {
      settledRef.current = onSettled
      if (prefersReducedMotion() || next === page) {
        setTransition(undefined)
        if (direction === 'push') {
          setStack((prev) =>
            prev[prev.length - 1] === next ? prev : [...prev, next],
          )
        } else {
          setStack((prev) => {
            const idx = prev.lastIndexOf(next)
            return idx >= 0 ? prev.slice(0, idx + 1) : [next]
          })
        }
        setPageState(next)
        finishSettled()
        return
      }

      if (direction === 'push') {
        setStack((prev) =>
          prev[prev.length - 1] === next ? prev : [...prev, next],
        )
      } else {
        setStack((prev) => {
          if (prev.includes(next) && prev.includes(page)) return prev
          const topIdx = prev.lastIndexOf(page)
          if (topIdx >= 0) {
            return [...prev.slice(0, topIdx), next, ...prev.slice(topIdx)]
          }
          return [next, page]
        })
      }
      setPageState(next)
      setTransition({ direction, from: page, to: next })
    },
    [finishSettled, page],
  )

  const handleMotionEnd = useCallback(
    (event: AnimationEvent) => {
      const stackEl = event.currentTarget
      if (!(stackEl instanceof HTMLElement)) return
      if (
        !stackEl.classList.contains('page-stack--push') &&
        !stackEl.classList.contains('page-stack--pop')
      ) {
        return
      }
      const name = event.animationName
      if (
        name !== 'page-body-over-push' &&
        name !== 'page-body-over-pop'
      ) {
        return
      }
      const target = event.target
      if (!(target instanceof Element) || !stackEl.contains(target)) return
      const owner = target.closest('.page-stack--push, .page-stack--pop')
      if (owner !== stackEl) return

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
      finishSettled()
    },
    [finishSettled],
  )

  const setPageSilent = useCallback((next: T) => {
    setTransition(undefined)
    settledRef.current = undefined
    setStack([next])
    setPageState(next)
  }, [])

  return {
    page,
    stack,
    transition,
    navigate,
    handleMotionEnd,
    setPage: setPageSilent,
  }
}

type PageStackProps<T extends string> = {
  stack: T[]
  page: T
  transition?: PageStackTransition<T>
  onMotionEnd: (event: AnimationEvent) => void
  /** 每页渲染一个 `.page` 根（可用 Page 组件）。层与滚动容器由本组件接管。 */
  renderPage: (page: T) => ComponentChildren
  hostRef?: Ref<HTMLDivElement>
}

/**
 * iOS 6 式页面栈：转场时两页的 header 在同一栏交叉淡移，
 * 两页的 .page__body 在同一正文区整页滑动；静止时仅当前页可见。
 * 层永远保活（hidden 隐藏），scrollTop 自动保留。
 */
export function PageStack<T extends string>({
  stack,
  page,
  transition,
  onMotionEnd,
  renderPage,
  hostRef,
}: PageStackProps<T>) {
  const rootRef = useRef<HTMLDivElement | null>(null)

  const underScreen = transition
    ? transition.direction === 'push'
      ? transition.from
      : transition.to
    : undefined
  const overScreen = transition
    ? transition.direction === 'push'
      ? transition.to
      : transition.from
    : undefined

  const setRoot = useCallback(
    (node: HTMLDivElement | null) => {
      rootRef.current = node
      if (typeof hostRef === 'function') {
        hostRef(node)
      } else if (hostRef) {
        hostRef.current = node
      }
    },
    [hostRef],
  )

  return (
    <div
      ref={setRoot}
      class={
        transition
          ? `page-stack page-stack--${transition.direction}`
          : 'page-stack'
      }
      onAnimationEnd={onMotionEnd}
    >
      {stack.map((id) => {
        const isUnder = transition !== undefined && id === underScreen
        const isOver = transition !== undefined && id === overScreen
        const isActive =
          transition === undefined && id === page
        const visible = isUnder || isOver || isActive
        const layerClass = [
          'page-stack__layer',
          isUnder ? 'page-stack__layer--under' : '',
          isOver ? 'page-stack__layer--over' : '',
        ]
          .filter(Boolean)
          .join(' ')

        return (
          <div
            key={id}
            class={layerClass}
            data-page={id}
            hidden={!visible}
          >
            {renderPage(id)}
          </div>
        )
      })}
    </div>
  )
}