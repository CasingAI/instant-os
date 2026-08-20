import { useLayoutEffect, useRef } from 'preact/hooks'
import { resolveFlip3dGhostMotion } from './build-flip3d-transform.ts'
import { peekFlip3dGhostSnapshot } from './flip3d-ghost-snapshot.ts'
import { FLIP3D_FLIGHT_OUT_MS, type Flip3dGhost } from './flip3d.ts'

type Flip3dGhostFrameProps = {
  ghost: Flip3dGhost
  count: number
  onDone: (ghostId: string) => void
}

export function Flip3dGhostFrame({ ghost, count, onDone }: Flip3dGhostFrameProps) {
  const nodeRef = useRef<HTMLElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const doneRef = useRef(false)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone
  const isDialog = ghost.chromeKind === 'dialog'
  const viewport = { width: window.innerWidth, height: window.innerHeight }
  const motion = resolveFlip3dGhostMotion(ghost.bounds, ghost.direction, viewport, count)

  useLayoutEffect(() => {
    const host = hostRef.current
    const snapshot = peekFlip3dGhostSnapshot(ghost.id)
    if (host && snapshot) {
      host.replaceChildren(snapshot)
    }

    const node = nodeRef.current
    if (!node) {
      return
    }

    doneRef.current = false
    const animation = node.animate(
      [
        { transform: motion.fromTransform, opacity: 1 },
        { transform: motion.toTransform, opacity: 0 },
      ],
      {
        duration: FLIP3D_FLIGHT_OUT_MS,
        easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
        fill: 'forwards',
      },
    )

    const finish = () => {
      if (doneRef.current) {
        return
      }
      doneRef.current = true
      onDoneRef.current(ghost.id)
    }

    const fallback = window.setTimeout(finish, FLIP3D_FLIGHT_OUT_MS)
    void animation.finished.then(finish).catch(() => {})

    return () => {
      window.clearTimeout(fallback)
      animation.cancel()
    }
  }, [ghost.id, motion.fromTransform, motion.toTransform])

  return (
    <section
      ref={nodeRef}
      class={`window-frame window-frame--flip3d window-frame--flip3d-ghost window-frame--flip3d-instant${isDialog ? ' window-frame--dialog' : ''}`}
      aria-hidden="true"
      style={{
        zIndex: motion.zIndex,
        left: `${ghost.bounds.x}px`,
        top: `${ghost.bounds.y}px`,
        width: `${ghost.bounds.width}px`,
        height: `${ghost.bounds.height}px`,
        transform: motion.fromTransform,
        opacity: 1,
      }}
    >
      <div ref={hostRef} class="window-frame__ghost-snapshot" />
    </section>
  )
}
