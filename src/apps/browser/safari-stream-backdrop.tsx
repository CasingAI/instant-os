import { useLayoutEffect, useRef } from 'preact/hooks'

type SafariStreamBackdropProps = {
  text: string
}

export function SafariStreamBackdrop({ text }: SafariStreamBackdropProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    container.scrollTop = container.scrollHeight
  }, [text])

  if (!text) {
    return undefined
  }

  return (
    <div ref={containerRef} class="safari__stream-backdrop" aria-hidden="true">
      <pre class="safari__stream-text">{text}</pre>
    </div>
  )
}
