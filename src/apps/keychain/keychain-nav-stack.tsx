import type { ComponentChildren, Ref } from 'preact'
import { useCallback, useLayoutEffect, useRef, useState } from 'preact/hooks'

export type KeychainNavDirection = 'push' | 'pop'

export type KeychainNavTransition<T extends string> = {
  direction: KeychainNavDirection
  from: T
  to: T
}

function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

export function useKeychainNavStack<T extends string>(initial: T) {
  const [page, setPageState] = useState<T>(initial)
  const [stack, setStack] = useState<T[]>([initial])
  /** 已应用到 CSS 的转场（会触发 display:contents） */
  const [transition, setTransition] = useState<
    KeychainNavTransition<T> | undefined
  >(undefined)
  /** 已决定要转场，但尚未套 CSS——用来先偷拍 scrollTop */
  const [queuedTransition, setQueuedTransition] = useState<
    KeychainNavTransition<T> | undefined
  >(undefined)
  const settledRef = useRef<(() => void) | undefined>(undefined)
  const transitionRef = useRef(transition)
  transitionRef.current = transition
  const queuedRef = useRef(queuedTransition)
  queuedRef.current = queuedTransition

  const finishSettled = useCallback(() => {
    const settled = settledRef.current
    settledRef.current = undefined
    settled?.()
  }, [])

  const navigate = useCallback(
    (next: T, direction: KeychainNavDirection, onSettled?: () => void) => {
      settledRef.current = onSettled
      if (prefersReducedMotion() || next === page) {
        setQueuedTransition(undefined)
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
      // 先不套 --push/--pop，等组件偷拍完各页 .settings 的 scrollTop
      setQueuedTransition({ direction, from: page, to: next })
    },
    [finishSettled, page],
  )

  const commitQueuedTransition = useCallback(() => {
    const queued = queuedRef.current
    if (!queued) return
    setTransition(queued)
    setQueuedTransition(undefined)
  }, [])

  const handleMotionEnd = useCallback(
    (event: AnimationEvent) => {
      const stackEl = event.currentTarget
      if (!(stackEl instanceof HTMLElement)) return
      if (
        !stackEl.classList.contains('keychain-stack--push') &&
        !stackEl.classList.contains('keychain-stack--pop')
      ) {
        return
      }
      const name = event.animationName
      if (
        name !== 'keychain-body-over-push' &&
        name !== 'keychain-body-over-pop'
      ) {
        return
      }
      const target = event.target
      if (!(target instanceof Element) || !stackEl.contains(target)) return
      const owner = target.closest('.keychain-stack--push, .keychain-stack--pop')
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
    setQueuedTransition(undefined)
    setTransition(undefined)
    settledRef.current = undefined
    setStack([next])
    setPageState(next)
  }, [])

  return {
    page,
    stack,
    transition,
    queuedTransition,
    commitQueuedTransition,
    navigate,
    handleMotionEnd,
    setPage: setPageSilent,
  }
}

type KeychainNavStackProps<T extends string> = {
  stack: T[]
  page: T
  transition?: KeychainNavTransition<T>
  queuedTransition?: KeychainNavTransition<T>
  commitQueuedTransition?: () => void
  onMotionEnd: (event: AnimationEvent) => void
  renderPage: (page: T) => ComponentChildren
  hostRef?: Ref<HTMLDivElement>
}

function layerSettings(layer: Element): HTMLElement | null {
  for (const child of layer.children) {
    if (child instanceof HTMLElement && child.classList.contains('settings')) {
      return child
    }
  }
  return null
}

function layerContent(layer: Element): HTMLElement | null {
  const settings = layerSettings(layer)
  if (!settings) return null
  for (const child of settings.children) {
    if (
      child instanceof HTMLElement &&
      child.classList.contains('settings__content')
    ) {
      return child
    }
  }
  return null
}

function eachStackLayer(
  root: HTMLElement,
  fn: (layer: HTMLElement, id: string) => void,
) {
  for (const child of root.children) {
    if (!(child instanceof HTMLElement)) continue
    if (!child.classList.contains('keychain-stack__layer')) continue
    const id = child.dataset.keychainPage
    if (!id) continue
    fn(child, id)
  }
}

/** 钥匙串 iOS 6 式页面栈：Header 交叉淡移 + 正文整页叠推（栈内保活，不拆树） */
export function KeychainNavStack<T extends string>({
  stack,
  page,
  transition,
  queuedTransition,
  commitQueuedTransition,
  onMotionEnd,
  renderPage,
  hostRef,
}: KeychainNavStackProps<T>) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const scrollByPageRef = useRef(new Map<string, number>())

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

  const rememberScroll = useCallback((id: T, top: number) => {
    scrollByPageRef.current.set(id, top)
  }, [])

  const captureScrollsFromSettings = useCallback(() => {
    const root = rootRef.current
    if (!root) return
    eachStackLayer(root, (layer, id) => {
      if (layer.hidden) return
      const settings = layerSettings(layer)
      if (settings) scrollByPageRef.current.set(id, settings.scrollTop)
    })
  }, [])

  const restoreScrollsToContent = useCallback(() => {
    const root = rootRef.current
    if (!root) return
    eachStackLayer(root, (layer, id) => {
      const saved = scrollByPageRef.current.get(id)
      if (saved == null) return
      const content = layerContent(layer)
      if (content) content.scrollTop = saved
    })
  }, [])

  const restoreScrollsToSettings = useCallback(() => {
    const root = rootRef.current
    if (!root) return
    eachStackLayer(root, (layer, id) => {
      const saved = scrollByPageRef.current.get(id)
      if (saved == null) return
      const settings = layerSettings(layer)
      if (settings) settings.scrollTop = saved
    })
  }, [])

  useLayoutEffect(() => {
    if (queuedTransition && commitQueuedTransition) {
      const root = rootRef.current
      // 此时还没有 --push/--pop，.settings 仍是滚动容器
      captureScrollsFromSettings()

      // 同一帧内先套上转场 class 并写回 content.scrollTop，避免首帧闪顶
      if (root) {
        const under =
          queuedTransition.direction === 'push'
            ? queuedTransition.from
            : queuedTransition.to
        const over =
          queuedTransition.direction === 'push'
            ? queuedTransition.to
            : queuedTransition.from
        eachStackLayer(root, (layer, id) => {
          layer.classList.toggle(
            'keychain-stack__layer--under',
            id === under,
          )
          layer.classList.toggle('keychain-stack__layer--over', id === over)
          layer.hidden = id !== under && id !== over
        })
        root.classList.remove('keychain-stack--push', 'keychain-stack--pop')
        root.classList.add(`keychain-stack--${queuedTransition.direction}`)
        restoreScrollsToContent()
      }

      commitQueuedTransition()
      return
    }

    if (transition) {
      restoreScrollsToContent()
      const raf = requestAnimationFrame(() => {
        restoreScrollsToContent()
      })
      return () => cancelAnimationFrame(raf)
    }

    restoreScrollsToSettings()
  }, [
    queuedTransition,
    transition,
    stack,
    page,
    commitQueuedTransition,
    captureScrollsFromSettings,
    restoreScrollsToContent,
    restoreScrollsToSettings,
  ])

  return (
    <div
      ref={setRoot}
      class={
        transition
          ? `keychain-stack keychain-stack--${transition.direction}`
          : 'keychain-stack'
      }
      onAnimationEnd={onMotionEnd}
    >
      {stack.map((id) => {
        const isUnder = transition !== undefined && id === underScreen
        const isOver = transition !== undefined && id === overScreen
        // queued 阶段也要挂上 from/to，便于偷拍与随后转场
        const queuedUnder =
          queuedTransition &&
          (queuedTransition.direction === 'push'
            ? queuedTransition.from
            : queuedTransition.to)
        const queuedOver =
          queuedTransition &&
          (queuedTransition.direction === 'push'
            ? queuedTransition.to
            : queuedTransition.from)
        const isQueuedUnder = queuedTransition !== undefined && id === queuedUnder
        const isQueuedOver = queuedTransition !== undefined && id === queuedOver
        const isActive =
          transition === undefined &&
          queuedTransition === undefined &&
          id === page
        const visible =
          isUnder ||
          isOver ||
          isQueuedUnder ||
          isQueuedOver ||
          isActive
        const layerClass = [
          'keychain-stack__layer',
          isUnder ? 'keychain-stack__layer--under' : '',
          isOver ? 'keychain-stack__layer--over' : '',
        ]
          .filter(Boolean)
          .join(' ')

        return (
          <div
            key={id}
            class={layerClass}
            data-keychain-page={id}
            hidden={!visible}
          >
            <div
              class="settings"
              onScroll={(event) => {
                rememberScroll(id, event.currentTarget.scrollTop)
              }}
            >
              {renderPage(id)}
            </div>
          </div>
        )
      })}
    </div>
  )
}
