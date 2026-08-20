import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import {
  buildFlip3dFlyOutTransform,
  buildFlip3dTransform,
  computeFlip3dFlyOutLayout,
  computeFlip3dLayout,
  FLIP3D_Z_BASE,
} from './build-flip3d-transform.ts'
import { FLIP3D_FLIGHT_OUT_MS, type Flip3dGhost } from './flip3d.ts'

type Flip3dGhostFrameProps = {
  ghost: Flip3dGhost
  count: number
  onDone: (ghostId: string) => void
}

export function Flip3dGhostFrame({ ghost, count, onDone }: Flip3dGhostFrameProps) {
  const viewport = { width: window.innerWidth, height: window.innerHeight }
  const restLayout = computeFlip3dLayout(ghost.bounds, 0, viewport, count)
  const flyLayout = computeFlip3dFlyOutLayout(ghost.bounds, viewport, count)
  const restTransform = buildFlip3dTransform(ghost.bounds, 0, viewport, count)
  const flyTransform = buildFlip3dFlyOutTransform(ghost.bounds, viewport, count)
  const startLayout = ghost.direction === 1 ? restLayout : flyLayout
  const endLayout = ghost.direction === 1 ? flyLayout : restLayout
  const startTransform = ghost.direction === 1 ? restTransform : flyTransform
  const endTransform = ghost.direction === 1 ? flyTransform : restTransform
  const [departing, setDeparting] = useState(false)
  const doneRef = useRef(false)
  const isDialog = ghost.chromeKind === 'dialog'

  useLayoutEffect(() => {
    const start = window.requestAnimationFrame(() => {
      setDeparting(true)
    })
    const finish = window.setTimeout(() => {
      if (doneRef.current) {
        return
      }
      doneRef.current = true
      onDone(ghost.id)
    }, FLIP3D_FLIGHT_OUT_MS)
    return () => {
      window.cancelAnimationFrame(start)
      window.clearTimeout(finish)
    }
  }, [ghost.id, onDone])

  const layout = departing ? endLayout : startLayout
  const transform = departing ? endTransform : startTransform
  const opacity = departing ? 0 : 1

  return (
    <section
      class={`window-frame window-frame--flip3d window-frame--flip3d-ghost${isDialog ? ' window-frame--dialog' : ''}${departing ? '' : ' window-frame--flip3d-instant'}`}
      aria-hidden="true"
      style={{
        zIndex: FLIP3D_Z_BASE + 80,
        left: `${layout.left}px`,
        top: `${layout.top}px`,
        width: `${ghost.bounds.width}px`,
        height: `${ghost.bounds.height}px`,
        transform,
        opacity,
      }}
    >
      <div class="window-frame__chrome">
        <header class="window-frame__titlebar">
          <div class="window-frame__controls">
            <span class="window-frame__control window-frame__control--close" />
            {isDialog ? undefined : (
              <>
                <span class="window-frame__control window-frame__control--minimize" />
                <span class="window-frame__control window-frame__control--fullscreen" />
              </>
            )}
          </div>
          <span class="window-frame__title">{ghost.title}</span>
          <span class="window-frame__title-trailing" />
        </header>
        <div class="window-frame__content window-frame__content--flip3d-ghost" />
      </div>
    </section>
  )
}
