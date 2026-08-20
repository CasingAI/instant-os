/**
 * 运行：node --experimental-strip-types src/apps/pose-lab/pose-lab-transform.test.ts
 */
import assert from 'node:assert/strict'
import {
  buildPoseLabTransform,
  destCorner,
  POSE_LAB_CARD_HEIGHT,
  POSE_LAB_CARD_WIDTH,
  POSE_LAB_DEFAULT_CORNERS,
  restCorner,
} from './pose-lab-transform.ts'

function testIdentityIsUntransformed(): void {
  const css = buildPoseLabTransform(POSE_LAB_DEFAULT_CORNERS)
  const values = css
    .slice('matrix3d('.length, -1)
    .split(',')
    .map((item) => Number(item.trim()))
  assert.equal(values.length, 16)
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  for (const [index, expected] of identity.entries()) {
    assert.ok(Math.abs(values[index]! - expected) < 1e-4, `identity[${index}]`)
  }
}

function testUniformShiftIsTranslation(): void {
  const css = buildPoseLabTransform({
    tl: { x: 10, y: 20, z: 0 },
    tr: { x: 10, y: 20, z: 0 },
    br: { x: 10, y: 20, z: 0 },
    bl: { x: 10, y: 20, z: 0 },
  })
  const values = css
    .slice('matrix3d('.length, -1)
    .split(',')
    .map((item) => Number(item.trim()))
  assert.ok(Math.abs(values[12]! - 10) < 1e-4, 'translateX')
  assert.ok(Math.abs(values[13]! - 20) < 1e-4, 'translateY')
}

function testDestCornerAddsOffsetAtZeroDepth(): void {
  assert.deepEqual(destCorner({ ...POSE_LAB_DEFAULT_CORNERS, tr: { x: 8, y: -4, z: 0 } }, 'tr'), {
    x: restCorner('tr').x + 8,
    y: restCorner('tr').y - 4,
  })
}

function testPositiveZPullsCornerAwayFromCenter(): void {
  const closer = destCorner({ ...POSE_LAB_DEFAULT_CORNERS, tl: { x: 0, y: 0, z: 240 } }, 'tl')
  const rest = restCorner('tl')
  const centerX = POSE_LAB_CARD_WIDTH / 2
  const centerY = POSE_LAB_CARD_HEIGHT / 2
  assert.ok(closer.x < rest.x, 'left edge moves left when closer')
  assert.ok(closer.y < rest.y, 'top edge moves up when closer')
  assert.ok(Math.abs(closer.x - centerX) > Math.abs(rest.x - centerX))
  assert.ok(Math.abs(closer.y - centerY) > Math.abs(rest.y - centerY))
}

function run(): void {
  testIdentityIsUntransformed()
  testUniformShiftIsTranslation()
  testDestCornerAddsOffsetAtZeroDepth()
  testPositiveZPullsCornerAwayFromCenter()
  console.log('pose-lab-transform.test.ts ok')
}

run()
