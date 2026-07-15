import type { ComponentChildren } from 'preact'
import { createPortal } from 'preact/compat'
import { useLayoutEffect, useRef, useState } from 'preact/hooks'

type DateTimePanelPortalProps = {
  children: ComponentChildren
  /** 浮层挂到的祖先选择器；默认设置窗口根节点。 */
  hostSelector?: string
}

/**
 * 将面板挂到指定宿主（默认 `.settings-host`），
 * 避免宽屏下遮罩只盖住右侧内容区；新闻等其它 App 可传各自根节点。
 */
export function DateTimePanelPortal({
  children,
  hostSelector = '.settings-host',
}: DateTimePanelPortalProps) {
  const probeRef = useRef<HTMLSpanElement>(null)
  const [host, setHost] = useState<HTMLElement | undefined>(undefined)

  useLayoutEffect(() => {
    const found = probeRef.current?.closest(hostSelector)
    if (found instanceof HTMLElement) {
      setHost(found)
    }
  }, [hostSelector])

  return (
    <>
      <span ref={probeRef} hidden aria-hidden="true" />
      {host ? createPortal(children, host) : undefined}
    </>
  )
}
