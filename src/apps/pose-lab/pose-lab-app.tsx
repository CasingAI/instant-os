import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import {
  buildPoseLabTransform,
  clampPoseLabZ,
  destCorner,
  depthScale,
  formatPoseLabCorners,
  POSE_LAB_CARD_HEIGHT,
  POSE_LAB_CARD_WIDTH,
  POSE_LAB_CORNER_IDS,
  POSE_LAB_CORNER_LABELS,
  POSE_LAB_DEFAULT_CORNERS,
  POSE_LAB_Z_MAX,
  POSE_LAB_Z_MIN,
  restCorner,
  unprojectPoint,
  type PoseLabCornerId,
  type PoseLabCorners,
  type PoseLabPoint,
} from './pose-lab-transform.ts'
import './pose-lab.css'

const APP_ID = 'pose-lab' as const
const BG_SCALE_MIN = 10
const BG_SCALE_MAX = 400
const IMAGE_NAME_RE = /\.(avif|bmp|gif|jpe?g|png|svg|tif?f|webp)$/i

type DragSession = {
  id: PoseLabCornerId
  pointerId: number
  axis: 'xy' | 'z'
  grabX: number
  grabY: number
  startZ: number
  startClientY: number
}

type BackgroundImage = {
  url: string
  name: string
  naturalWidth: number
  naturalHeight: number
  x: number
  y: number
  scale: number
}

type BackgroundDrag = {
  pointerId: number
  originX: number
  originY: number
  startX: number
  startY: number
}

function parseCoord(raw: string, fallback: number): number {
  const next = Number(raw)
  return Number.isFinite(next) ? next : fallback
}

function clampBgScale(value: number): number {
  return Math.min(BG_SCALE_MAX, Math.max(BG_SCALE_MIN, value))
}

function isPickedImageFile(file: File): boolean {
  return file.type.startsWith('image/') || IMAGE_NAME_RE.test(file.name)
}

export function PoseLabApp() {
  const stageRef = useRef<HTMLDivElement>(null)
  const boardRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [corners, setCorners] = useState<PoseLabCorners>(POSE_LAB_DEFAULT_CORNERS)
  const [background, setBackground] = useState<BackgroundImage | undefined>(undefined)
  const [draggingId, setDraggingId] = useState<PoseLabCornerId | undefined>(undefined)
  const [draggingBg, setDraggingBg] = useState(false)
  const [copied, setCopied] = useState(false)
  const dragRef = useRef<DragSession | undefined>(undefined)
  const bgDragRef = useRef<BackgroundDrag | undefined>(undefined)
  const bgUrlRef = useRef<string | undefined>(undefined)
  const pickGenRef = useRef(0)
  const backgroundRef = useRef(background)
  backgroundRef.current = background
  const transform = useMemo(() => buildPoseLabTransform(corners), [corners])
  const dump = useMemo(() => formatPoseLabCorners(corners), [corners])

  useAppMenuBar(APP_ID, [])

  useEffect(() => {
    return () => {
      pickGenRef.current += 1
      if (bgUrlRef.current) {
        URL.revokeObjectURL(bgUrlRef.current)
        bgUrlRef.current = undefined
      }
    }
  }, [])

  const patchBackground = useCallback((patch: Partial<Omit<BackgroundImage, 'url' | 'name' | 'naturalWidth' | 'naturalHeight'>>) => {
    setBackground((current) => {
      if (!current) {
        return current
      }
      return {
        ...current,
        ...patch,
        scale: patch.scale === undefined ? current.scale : clampBgScale(patch.scale),
      }
    })
  }, [])

  const clearBackground = useCallback(() => {
    pickGenRef.current += 1
    bgDragRef.current = undefined
    setDraggingBg(false)
    if (bgUrlRef.current) {
      URL.revokeObjectURL(bgUrlRef.current)
      bgUrlRef.current = undefined
    }
    setBackground(undefined)
  }, [])

  const pickBackground = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const onBackgroundFileChange = useCallback((event: Event) => {
    const input = event.currentTarget
    if (!(input instanceof HTMLInputElement)) {
      return
    }
    const file = input.files?.[0]
    input.value = ''
    if (!file || !isPickedImageFile(file)) {
      return
    }
    const loadId = pickGenRef.current + 1
    pickGenRef.current = loadId
    if (bgUrlRef.current) {
      URL.revokeObjectURL(bgUrlRef.current)
      bgUrlRef.current = undefined
    }
    const url = URL.createObjectURL(file)
    bgUrlRef.current = url
    const image = new Image()
    image.onload = () => {
      if (loadId !== pickGenRef.current) {
        return
      }
      const stage = stageRef.current
      const fit = stage
        ? Math.min(stage.clientWidth / image.naturalWidth, stage.clientHeight / image.naturalHeight) * 92
        : 100
      setBackground({
        url,
        name: file.name,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        x: 0,
        y: 0,
        scale: Math.round(clampBgScale(fit)),
      })
    }
    image.onerror = () => {
      if (loadId !== pickGenRef.current) {
        return
      }
      if (bgUrlRef.current === url) {
        URL.revokeObjectURL(url)
        bgUrlRef.current = undefined
      }
      setBackground(undefined)
    }
    image.src = url
  }, [])

  const patchCorner = useCallback((id: PoseLabCornerId, patch: Partial<PoseLabPoint>) => {
    setCorners((current) => {
      const next = { ...current[id], ...patch }
      return { ...current, [id]: { ...next, z: clampPoseLabZ(next.z) } }
    })
    setCopied(false)
  }, [])

  const reset = useCallback(() => {
    dragRef.current = undefined
    setDraggingId(undefined)
    setCorners(POSE_LAB_DEFAULT_CORNERS)
    setCopied(false)
  }, [])

  const copyValues = useCallback(() => {
    const text = `${dump}\ntransform ${transform}`
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    })
  }, [dump, transform])

  const onHandlePointerDown = useCallback(
    (id: PoseLabCornerId, event: PointerEvent) => {
      if (event.button !== 0) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      const handle = event.currentTarget
      if (!(handle instanceof HTMLElement)) {
        return
      }
      const dest = destCorner(corners, id)
      const board = boardRef.current?.getBoundingClientRect()
      if (!board) {
        return
      }
      handle.setPointerCapture(event.pointerId)
      dragRef.current = {
        id,
        pointerId: event.pointerId,
        axis: event.shiftKey ? 'z' : 'xy',
        grabX: event.clientX - board.left - dest.x,
        grabY: event.clientY - board.top - dest.y,
        startZ: corners[id].z,
        startClientY: event.clientY,
      }
      setDraggingId(id)
    },
    [corners],
  )

  const onHandlePointerMove = useCallback(
    (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || event.pointerId !== drag.pointerId) {
        return
      }
      if (drag.axis === 'z') {
        patchCorner(drag.id, { z: drag.startZ - (event.clientY - drag.startClientY) })
        return
      }
      const board = boardRef.current?.getBoundingClientRect()
      if (!board) {
        return
      }
      const screenX = event.clientX - board.left - drag.grabX
      const screenY = event.clientY - board.top - drag.grabY
      const world = unprojectPoint({ x: screenX, y: screenY }, corners[drag.id].z)
      const rest = restCorner(drag.id)
      patchCorner(drag.id, {
        x: Math.round(world.x - rest.x),
        y: Math.round(world.y - rest.y),
      })
    },
    [corners, patchCorner],
  )

  const onHandlePointerUp = useCallback((event: PointerEvent) => {
    const drag = dragRef.current
    if (!drag || event.pointerId !== drag.pointerId) {
      return
    }
    dragRef.current = undefined
    setDraggingId(undefined)
  }, [])

  const onHandleWheel = useCallback(
    (id: PoseLabCornerId, event: WheelEvent) => {
      event.preventDefault()
      event.stopPropagation()
      patchCorner(id, { z: corners[id].z - event.deltaY * 0.35 })
    },
    [corners, patchCorner],
  )

  const onStagePointerDown = useCallback((event: PointerEvent) => {
    if (event.button !== 0 || !backgroundRef.current) {
      return
    }
    const target = event.target
    if (target instanceof Element && target.closest('.pose-lab__handle')) {
      return
    }
    const stage = event.currentTarget
    if (!(stage instanceof HTMLElement)) {
      return
    }
    event.preventDefault()
    stage.setPointerCapture(event.pointerId)
    const current = backgroundRef.current
    bgDragRef.current = {
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      startX: current.x,
      startY: current.y,
    }
    setDraggingBg(true)
  }, [])

  const onStagePointerMove = useCallback((event: PointerEvent) => {
    const drag = bgDragRef.current
    if (!drag || event.pointerId !== drag.pointerId) {
      return
    }
    patchBackground({
      x: Math.round(drag.startX + (event.clientX - drag.originX)),
      y: Math.round(drag.startY + (event.clientY - drag.originY)),
    })
  }, [patchBackground])

  const onStagePointerUp = useCallback((event: PointerEvent) => {
    const drag = bgDragRef.current
    if (!drag || event.pointerId !== drag.pointerId) {
      return
    }
    bgDragRef.current = undefined
    setDraggingBg(false)
  }, [])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) {
      return
    }
    const onWheel = (event: WheelEvent) => {
      const target = event.target
      if (!(target instanceof Element)) {
        return
      }
      const handle = target.closest('.pose-lab__handle')
      if (handle instanceof HTMLElement) {
        const id = POSE_LAB_CORNER_IDS.find((cornerId) => handle.classList.contains(`pose-lab__handle--${cornerId}`))
        if (id) {
          onHandleWheel(id, event)
          return
        }
      }
      const current = backgroundRef.current
      if (!current) {
        return
      }
      event.preventDefault()
      patchBackground({ scale: current.scale - event.deltaY * 0.12 })
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [onHandleWheel, patchBackground])

  return (
    <div class="pose-lab">
      <div
        ref={stageRef}
        class={`pose-lab__stage${background ? ' pose-lab__stage--has-ref' : ''}${draggingBg ? ' pose-lab__stage--dragging-ref' : ''}`}
        onPointerDown={onStagePointerDown}
        onPointerMove={onStagePointerMove}
        onPointerUp={onStagePointerUp}
        onPointerCancel={onStagePointerUp}
      >
        {background ? (
          <img
            class="pose-lab__ref"
            src={background.url}
            alt=""
            draggable={false}
            style={{
              width: `${(background.naturalWidth * background.scale) / 100}px`,
              height: `${(background.naturalHeight * background.scale) / 100}px`,
              transform: `translate(${background.x}px, ${background.y}px)`,
            }}
          />
        ) : undefined}
        <div
          ref={boardRef}
          class="pose-lab__board"
          style={{ width: `${POSE_LAB_CARD_WIDTH}px`, height: `${POSE_LAB_CARD_HEIGHT}px` }}
        >
          <article class="pose-lab__card" style={{ transform }}>
            <header class="pose-lab__titlebar">
              <span class="pose-lab__dots" aria-hidden="true">
                <span class="pose-lab__dot pose-lab__dot--close" />
                <span class="pose-lab__dot pose-lab__dot--min" />
                <span class="pose-lab__dot pose-lab__dot--zoom" />
              </span>
              <span class="pose-lab__title">风景</span>
            </header>
            <div class="pose-lab__photo">
              <span class="pose-lab__sun" aria-hidden="true" />
              <span class="pose-lab__hill pose-lab__hill--left" aria-hidden="true" />
              <span class="pose-lab__hill pose-lab__hill--right" aria-hidden="true" />
              <span class="pose-lab__grid" aria-hidden="true" />
            </div>
          </article>

          {POSE_LAB_CORNER_IDS.map((id) => {
            const dest = destCorner(corners, id)
            const scale = depthScale(corners[id].z)
            return (
              <button
                key={id}
                type="button"
                class={`pose-lab__handle pose-lab__handle--${id}${draggingId === id ? ' pose-lab__handle--active' : ''}`}
                style={{
                  left: `${dest.x}px`,
                  top: `${dest.y}px`,
                  transform: `translate(-50%, -50%) scale(${scale})`,
                }}
                aria-label={`移动${POSE_LAB_CORNER_LABELS[id]}角`}
                onPointerDown={(event) => onHandlePointerDown(id, event)}
                onPointerMove={onHandlePointerMove}
                onPointerUp={onHandlePointerUp}
                onPointerCancel={onHandlePointerUp}
              >
                <span class="pose-lab__handle-label">
                  {POSE_LAB_CORNER_LABELS[id]} z{corners[id].z >= 0 ? '+' : ''}
                  {Math.round(corners[id].z)}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <aside class="pose-lab__panel">
        <section class="pose-lab__section">
          <h2 class="pose-lab__panel-title">对照图</h2>
          <p class="pose-lab__hint">系统文件对话框选本机图片，不进 VFS。拖空白处改位置，滚轮改大小。</p>
          <div class="pose-lab__actions">
            <button type="button" class="pose-lab__btn" onClick={pickBackground}>
              选择图片
            </button>
            <button type="button" class="pose-lab__btn" disabled={!background} onClick={clearBackground}>
              清除
            </button>
          </div>
          {background ? (
            <>
              <p class="pose-lab__ref-name" title={background.name}>
                {background.name}
              </p>
              <div class="pose-lab__corner-xy">
                <label class="pose-lab__coord">
                  X
                  <input
                    type="number"
                    step="1"
                    value={Math.round(background.x)}
                    onInput={(event) =>
                      patchBackground({ x: parseCoord(event.currentTarget.value, background.x) })
                    }
                  />
                </label>
                <label class="pose-lab__coord">
                  Y
                  <input
                    type="number"
                    step="1"
                    value={Math.round(background.y)}
                    onInput={(event) =>
                      patchBackground({ y: parseCoord(event.currentTarget.value, background.y) })
                    }
                  />
                </label>
              </div>
              <label class="pose-lab__coord pose-lab__coord--z">
                大小
                <input
                  type="range"
                  min={BG_SCALE_MIN}
                  max={BG_SCALE_MAX}
                  step="1"
                  value={Math.round(background.scale)}
                  onInput={(event) =>
                    patchBackground({ scale: parseCoord(event.currentTarget.value, background.scale) })
                  }
                />
                <input
                  type="number"
                  step="1"
                  value={Math.round(background.scale)}
                  onInput={(event) =>
                    patchBackground({ scale: parseCoord(event.currentTarget.value, background.scale) })
                  }
                />
              </label>
            </>
          ) : undefined}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            class="pose-lab__file-input"
            aria-hidden="true"
            tabIndex={-1}
            onChange={onBackgroundFileChange}
          />
        </section>

        <h2 class="pose-lab__panel-title">四角三维</h2>
        <p class="pose-lab__hint">
          拖动手把改 X/Y。滚轮或按住 Shift 再拖改 Z：正值靠近镜头，负值远离。每个角都是独立三维坐标。
        </p>
        {POSE_LAB_CORNER_IDS.map((id) => (
          <div key={id} class={`pose-lab__corner-block pose-lab__corner-block--${id}`}>
            <span class="pose-lab__corner-name">{POSE_LAB_CORNER_LABELS[id]}</span>
            <div class="pose-lab__corner-xy">
              <label class="pose-lab__coord">
                X
                <input
                  type="number"
                  step="1"
                  value={Math.round(corners[id].x)}
                  onInput={(event) =>
                    patchCorner(id, { x: parseCoord(event.currentTarget.value, corners[id].x) })
                  }
                />
              </label>
              <label class="pose-lab__coord">
                Y
                <input
                  type="number"
                  step="1"
                  value={Math.round(corners[id].y)}
                  onInput={(event) =>
                    patchCorner(id, { y: parseCoord(event.currentTarget.value, corners[id].y) })
                  }
                />
              </label>
            </div>
            <label class="pose-lab__coord pose-lab__coord--z">
              Z
              <input
                type="range"
                min={POSE_LAB_Z_MIN}
                max={POSE_LAB_Z_MAX}
                step="1"
                value={Math.round(corners[id].z)}
                onInput={(event) =>
                  patchCorner(id, { z: parseCoord(event.currentTarget.value, corners[id].z) })
                }
              />
              <input
                type="number"
                step="1"
                value={Math.round(corners[id].z)}
                onInput={(event) =>
                  patchCorner(id, { z: parseCoord(event.currentTarget.value, corners[id].z) })
                }
              />
            </label>
          </div>
        ))}
        <pre class="pose-lab__dump">{dump}</pre>
        <div class="pose-lab__actions">
          <button type="button" class="pose-lab__btn" onClick={copyValues}>
            {copied ? '已复制' : '复制数值'}
          </button>
          <button type="button" class="pose-lab__btn" onClick={reset}>
            复位
          </button>
        </div>
      </aside>
    </div>
  )
}
