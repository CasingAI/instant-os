import { useEffect, useState } from 'preact/hooks'

const COLLAPSE_MS = 420

type GomokuAiAlertBannerProps = {
  show: boolean
  message: string
}

export function GomokuAiAlertBanner({ show, message }: GomokuAiAlertBannerProps) {
  const [mounted, setMounted] = useState(false)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (!show) {
      return
    }

    setMounted(true)
    setExpanded(false)
    const frame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        setExpanded(true)
      })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [show])

  useEffect(() => {
    if (show || !mounted) {
      return
    }

    setExpanded(false)
    const timer = window.setTimeout(() => {
      setMounted(false)
    }, COLLAPSE_MS)
    return () => window.clearTimeout(timer)
  }, [show, mounted])

  if (!mounted) {
    return undefined
  }

  return (
    <div
      class={`gomoku-app__ai-alert${expanded ? ' gomoku-app__ai-alert--expanded' : ''}`}
      role="alert"
      aria-live="assertive"
    >
      <p class="gomoku-app__ai-alert-text">{message}</p>
    </div>
  )
}
