import type { ComponentChildren, Ref } from 'preact'
import { useCallback, useRef, useState } from 'preact/hooks'

export type KeychainNavDirection = 'push' | 'pop'

export type KeychainNavTransition<T extends string> = {
  direction: KeychainNavDirection
  from: T
  to: T
}

export function useKeychainNavStack<T extends string>(initial: T) {
  const [page, setPage] = useState<T>(initial)
  const [transition, setTransition] = useState<
    KeychainNavTransition<T> | undefined
  >(undefined)
  const settledRef = useRef<(() => void) | undefined>(undefined)

  const navigate = useCallback(
    (next: T, direction: KeychainNavDirection, onSettled?: () => void) => {
      const reduced =
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      settledRef.current = onSettled
      if (reduced || next === page) {
        setTransition(undefined)
        setPage(next)
        const settled = settledRef.current
        settledRef.current = undefined
        settled?.()
        return
      }
      setTransition({ direction, from: page, to: next })
      setPage(next)
    },
    [page],
  )

  const handleMotionEnd = useCallback((event: AnimationEvent) => {
    const stack = event.currentTarget
    if (!(stack instanceof HTMLElement)) return
    if (
      !stack.classList.contains('keychain-stack--push') &&
      !stack.classList.contains('keychain-stack--pop')
    ) {
      return
    }
    const name = event.animationName
    if (name !== 'keychain-body-over-push' && name !== 'keychain-body-over-pop') {
      return
    }
    const target = event.target
    if (!(target instanceof Element) || !stack.contains(target)) return
    const owner = target.closest('.keychain-stack--push, .keychain-stack--pop')
    if (owner !== stack) return

    setTransition(undefined)
    const settled = settledRef.current
    settledRef.current = undefined
    settled?.()
  }, [])

  const setPageSilent = useCallback((next: T) => {
    setTransition(undefined)
    settledRef.current = undefined
    setPage(next)
  }, [])

  return {
    page,
    transition,
    navigate,
    handleMotionEnd,
    setPage: setPageSilent,
  }
}

type KeychainNavStackProps<T extends string> = {
  page: T
  transition?: KeychainNavTransition<T>
  onMotionEnd: (event: AnimationEvent) => void
  renderPage: (page: T) => ComponentChildren
  hostRef?: Ref<HTMLDivElement>
}

/** 钥匙串 iOS 6 式页面栈：Header 交叉淡移 + 正文整页叠推 */
export function KeychainNavStack<T extends string>({
  page,
  transition,
  onMotionEnd,
  renderPage,
  hostRef,
}: KeychainNavStackProps<T>) {
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

  return (
    <div
      ref={hostRef}
      class={
        transition
          ? `keychain-stack keychain-stack--${transition.direction}`
          : 'keychain-stack'
      }
      onAnimationEnd={onMotionEnd}
    >
      {transition && underScreen !== undefined && overScreen !== undefined ? (
        <>
          <div class="keychain-stack__layer keychain-stack__layer--under">
            <div class="settings">{renderPage(underScreen)}</div>
          </div>
          <div class="keychain-stack__layer keychain-stack__layer--over">
            <div class="settings">{renderPage(overScreen)}</div>
          </div>
        </>
      ) : (
        <div class="settings">{renderPage(page)}</div>
      )}
    </div>
  )
}
