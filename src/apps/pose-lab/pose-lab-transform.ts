export const POSE_LAB_CARD_WIDTH = 420
export const POSE_LAB_CARD_HEIGHT = 280
export const POSE_LAB_PERSPECTIVE_PX = 1200
export const POSE_LAB_Z_MIN = -800
export const POSE_LAB_Z_MAX = 800

export const POSE_LAB_CORNER_IDS = ['tl', 'tr', 'br', 'bl'] as const
export type PoseLabCornerId = (typeof POSE_LAB_CORNER_IDS)[number]

/** 相对卡片原始四角的三维位移。Z 正值靠近镜头。 */
export type PoseLabPoint = {
  x: number
  y: number
  z: number
}

export type PoseLabCorners = Record<PoseLabCornerId, PoseLabPoint>

export const POSE_LAB_DEFAULT_CORNERS: PoseLabCorners = {
  tl: { x: 0, y: 0, z: 0 },
  tr: { x: 0, y: 0, z: 0 },
  br: { x: 0, y: 0, z: 0 },
  bl: { x: 0, y: 0, z: 0 },
}

export const POSE_LAB_CORNER_LABELS: Record<PoseLabCornerId, string> = {
  tl: '左上',
  tr: '右上',
  br: '右下',
  bl: '左下',
}

export function restCorner(id: PoseLabCornerId): PoseLabPoint {
  switch (id) {
    case 'tl':
      return { x: 0, y: 0, z: 0 }
    case 'tr':
      return { x: POSE_LAB_CARD_WIDTH, y: 0, z: 0 }
    case 'br':
      return { x: POSE_LAB_CARD_WIDTH, y: POSE_LAB_CARD_HEIGHT, z: 0 }
    case 'bl':
      return { x: 0, y: POSE_LAB_CARD_HEIGHT, z: 0 }
  }
}

export function clampPoseLabZ(z: number): number {
  return Math.min(POSE_LAB_Z_MAX, Math.max(POSE_LAB_Z_MIN, z))
}

export function worldCorner(corners: PoseLabCorners, id: PoseLabCornerId): PoseLabPoint {
  const rest = restCorner(id)
  const offset = corners[id]
  return {
    x: rest.x + offset.x,
    y: rest.y + offset.y,
    z: clampPoseLabZ(offset.z),
  }
}

export function projectPoint(point: PoseLabPoint): { x: number; y: number } {
  const perspective = POSE_LAB_PERSPECTIVE_PX
  const z = Math.min(point.z, perspective - 40)
  const factor = perspective / (perspective - z)
  const centerX = POSE_LAB_CARD_WIDTH / 2
  const centerY = POSE_LAB_CARD_HEIGHT / 2
  return {
    x: centerX + (point.x - centerX) * factor,
    y: centerY + (point.y - centerY) * factor,
  }
}

export function unprojectPoint(screen: { x: number; y: number }, z: number): { x: number; y: number } {
  const perspective = POSE_LAB_PERSPECTIVE_PX
  const clampedZ = Math.min(clampPoseLabZ(z), perspective - 40)
  const factor = perspective / (perspective - clampedZ)
  const centerX = POSE_LAB_CARD_WIDTH / 2
  const centerY = POSE_LAB_CARD_HEIGHT / 2
  return {
    x: centerX + (screen.x - centerX) / factor,
    y: centerY + (screen.y - centerY) / factor,
  }
}

/** 投影后的屏幕位置，用来摆角点把手 */
export function destCorner(corners: PoseLabCorners, id: PoseLabCornerId): { x: number; y: number } {
  return projectPoint(worldCorner(corners, id))
}

export function depthScale(z: number): number {
  const perspective = POSE_LAB_PERSPECTIVE_PX
  const clamped = Math.min(clampPoseLabZ(z), perspective - 40)
  return perspective / (perspective - clamped)
}

function solveLinearSystem(matrix: number[][], values: number[]): number[] | undefined {
  const size = values.length
  const rows = matrix.map((row, index) => [...row, values[index]!])
  for (let column = 0; column < size; column += 1) {
    let pivot = column
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(rows[row]![column]!) > Math.abs(rows[pivot]![column]!)) {
        pivot = row
      }
    }
    if (Math.abs(rows[pivot]![column]!) < 1e-8) {
      return undefined
    }
    if (pivot !== column) {
      const swapped = rows[column]!
      rows[column] = rows[pivot]!
      rows[pivot] = swapped
    }
    const divisor = rows[column]![column]!
    for (let index = column; index <= size; index += 1) {
      rows[column]![index]! /= divisor
    }
    for (let row = 0; row < size; row += 1) {
      if (row === column) {
        continue
      }
      const factor = rows[row]![column]!
      for (let index = column; index <= size; index += 1) {
        rows[row]![index]! -= factor * rows[column]![index]!
      }
    }
  }
  return rows.map((row) => row[size]!)
}

/**
 * 把原始矩形四角映射到三维角点透视投影后的 CSS matrix3d。
 */
export function buildPoseLabTransform(corners: PoseLabCorners): string {
  const from = POSE_LAB_CORNER_IDS.map((id) => restCorner(id))
  const to = POSE_LAB_CORNER_IDS.map((id) => destCorner(corners, id))
  const matrix: number[][] = []
  const values: number[] = []
  for (let index = 0; index < 4; index += 1) {
    const source = from[index]!
    const dest = to[index]!
    matrix.push([source.x, source.y, 1, 0, 0, 0, -source.x * dest.x, -source.y * dest.x])
    values.push(dest.x)
    matrix.push([0, 0, 0, source.x, source.y, 1, -source.x * dest.y, -source.y * dest.y])
    values.push(dest.y)
  }
  const solved = solveLinearSystem(matrix, values)
  if (!solved) {
    return 'none'
  }
  const [h11, h12, h13, h21, h22, h23, h31, h32] = solved
  const h33 = 1
  const numbers = [h11, h21, 0, h31, h12, h22, 0, h32, 0, 0, 1, 0, h13, h23, 0, h33]
  return `matrix3d(${numbers.map((value) => Number(value!.toFixed(6))).join(', ')})`
}

function formatNum(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

export function formatPoseLabCorners(corners: PoseLabCorners): string {
  return POSE_LAB_CORNER_IDS.map((id) => {
    const point = corners[id]
    return `${POSE_LAB_CORNER_LABELS[id]}  x ${formatNum(point.x)}  y ${formatNum(point.y)}  z ${formatNum(point.z)}`
  }).join('\n')
}
