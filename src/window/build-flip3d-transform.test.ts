/**
 * Flip 3D 叠层：transform 方向与窗口队列循环。
 * 运行：node --experimental-strip-types src/window/build-flip3d-transform.test.ts
 */
import assert from 'node:assert/strict'
import {
  FLIP3D_CAMERA_PITCH_DEG,
  FLIP3D_CAMERA_ROLL_DEG,
  FLIP3D_CAMERA_YAW_DEG,
  FLIP3D_PERSPECTIVE_PX,
  FLIP3D_SCALE_WIDTH_MAX_RATIO,
  buildFlip3dTransform,
  computeFlip3dFlyOutLayout,
  computeFlip3dLayout,
  computeFlip3dBackEnterLayout,
  flip3dCardSize,
  flip3dWindowScale,
  hitTestFlip3dWindowId,
  projectFlip3dQuad,
} from './build-flip3d-transform.ts'
import {
  bringFlip3dWindowToFront,
  createFlip3dGhost,
  cycleFlip3dOrder,
  dismissFlip3dGhost,
  appendFlip3dGhost,
  FLIP3D_MAX_GHOSTS,
  isFlip3dEligibleWindow,
  listFlip3dWindowIds,
  peeledFlip3dWindowId,
  resolveFlip3dVisual,
} from './flip3d.ts'
import type { WindowState } from '../os/types.ts'

const VIEWPORT = { width: 1280, height: 800 }
const BOUNDS = { x: 100, y: 80, width: 640, height: 480 }

function makeWindow(id: string, partial: Partial<WindowState> = {}): WindowState {
  return {
    id,
    appId: 'files',
    title: 't',
    minimized: false,
    maximized: false,
    fullscreen: false,
    zIndex: 1,
    x: 0,
    y: 0,
    width: 400,
    height: 600,
    ...partial,
  }
}

function testRankRecedesUpAndLeft(): void {
  const front = computeFlip3dLayout(BOUNDS, 0, VIEWPORT)
  const mid = computeFlip3dLayout(BOUNDS, 1, VIEWPORT)
  const back = computeFlip3dLayout(BOUNDS, 2, VIEWPORT)
  assert.ok(back.slotZ < front.slotZ, '后窗应更远离镜头')
  assert.ok(front.slotX - back.slotX > 40, '后窗应更靠左')
  assert.ok(front.slotY - back.slotY > 20, '后窗应更靠上')
  assert.equal(mid.rotateY, front.rotateY, '各层姿态相同（平行平面）')
  assert.equal(back.rotateY, front.rotateY)
  assert.equal(front.rotateY, FLIP3D_CAMERA_YAW_DEG)
  assert.equal(front.rotateX, FLIP3D_CAMERA_PITCH_DEG)
  assert.equal(front.rotateZ, FLIP3D_CAMERA_ROLL_DEG)
  const css = buildFlip3dTransform(BOUNDS, 2, VIEWPORT)
  assert.ok(css.includes(`rotateY(${FLIP3D_CAMERA_YAW_DEG}deg)`))
  console.log('ok: flip3d rank recedes')
}

function testManyWindowsStayInFrontOfCamera(): void {
  const fourBack = computeFlip3dLayout(BOUNDS, 3, VIEWPORT, 4)
  const sixBack = computeFlip3dLayout(BOUNDS, 5, VIEWPORT, 6)
  const twelveFront = computeFlip3dLayout(BOUNDS, 0, VIEWPORT, 12)
  const twelveMid = computeFlip3dLayout(BOUNDS, 1, VIEWPORT, 12)
  const twelveBack = computeFlip3dLayout(BOUNDS, 11, VIEWPORT, 12)
  assert.equal(twelveFront.slotZ, computeFlip3dLayout(BOUNDS, 0, VIEWPORT, 4).slotZ)
  assert.ok(twelveBack.slotZ > -FLIP3D_PERSPECTIVE_PX * 0.85, '最后一层不得穿过镜头')
  assert.equal(twelveBack.slotZ, sixBack.slotZ)
  const spanFour = fourBack.slotX - computeFlip3dLayout(BOUNDS, 0, VIEWPORT, 4).slotX
  const spanTwelve = twelveBack.slotX - twelveFront.slotX
  assert.ok(Math.abs(spanTwelve - spanFour * (5 / 3)) < 1)
  const gapFront = twelveMid.slotX - twelveFront.slotX
  const gapBack =
    computeFlip3dLayout(BOUNDS, 11, VIEWPORT, 12).slotX -
    computeFlip3dLayout(BOUNDS, 10, VIEWPORT, 12).slotX
  assert.ok(Math.abs(gapFront - gapBack) < 1e-6, '多窗时世界间距应均匀，后段不再额外挤叠')
  const narrow = computeFlip3dLayout({ ...BOUNDS, width: 320 }, 3, VIEWPORT, 6)
  const wide = computeFlip3dLayout({ ...BOUNDS, width: 900 }, 3, VIEWPORT, 6)
  assert.ok(narrow.slotX < wide.slotX, '窄窗应左移以对齐卡片左缘')
  console.log('ok: flip3d many windows pack in front of camera')
}

function testLayoutIgnoresDesktopPosition(): void {
  const a = computeFlip3dLayout({ ...BOUNDS, x: 20, y: 30 }, 0, VIEWPORT)
  const b = computeFlip3dLayout({ ...BOUNDS, x: 400, y: 200 }, 0, VIEWPORT)
  assert.equal(a.left, b.left)
  assert.equal(a.top, b.top)
  console.log('ok: flip3d layout ignores desktop position')
}

function testCssTransformEncodesDesktopOffset(): void {
  const home = { ...BOUNDS, x: 100, y: 80 }
  const elsewhere = { ...BOUNDS, x: 400, y: 200 }
  const layout = computeFlip3dLayout(home, 1, VIEWPORT, 3)
  const cssHome = buildFlip3dTransform(home, 1, VIEWPORT, 3)
  const cssElse = buildFlip3dTransform(elsewhere, 1, VIEWPORT, 3)
  const txHome = layout.slotX + layout.left - home.x
  const tyHome = layout.slotY + layout.top - home.y
  const txElse = layout.slotX + layout.left - elsewhere.x
  const tyElse = layout.slotY + layout.top - elsewhere.y
  assert.ok(cssHome.startsWith(`translate3d(${txHome}px, ${tyHome}px, ${layout.slotZ}px)`))
  assert.ok(cssElse.startsWith(`translate3d(${txElse}px, ${tyElse}px, ${layout.slotZ}px)`))
  assert.notEqual(cssHome, cssElse)
  console.log('ok: flip3d css transform encodes desktop offset')
}

function testScaleFitsCardWithoutUpscaling(): void {
  const card = flip3dCardSize(VIEWPORT)
  const tall = { ...BOUNDS, width: 400, height: 700 }
  const wide = { ...BOUNDS, width: 1000, height: 400 }
  const small = { ...BOUNDS, width: 320, height: 200 }
  assert.ok(Math.abs(flip3dWindowScale(tall, card) - card.height / 700) < 1e-6)
  const wideScale = flip3dWindowScale(wide, card)
  assert.ok(wideScale < card.height / 400)
  assert.ok(1000 * wideScale <= card.width * FLIP3D_SCALE_WIDTH_MAX_RATIO + 1e-6)
  assert.equal(flip3dWindowScale(small, card), 1, '小于卡片的窗不应被拉大')
  assert.ok(small.height < card.height)
  console.log('ok: flip3d scale fits card without upscaling')
}

function testCycleOrder(): void {
  assert.deepEqual(cycleFlip3dOrder(['a', 'b', 'c'], 1), ['b', 'c', 'a'])
  assert.deepEqual(cycleFlip3dOrder(['a', 'b', 'c'], -1), ['c', 'a', 'b'])
  assert.deepEqual(cycleFlip3dOrder(['only'], 1), ['only'])
  let order = ['a', 'b', 'c']
  order = cycleFlip3dOrder(order, 1)
  order = cycleFlip3dOrder(order, 1)
  assert.deepEqual(order, ['c', 'a', 'b'], '连续两次切换立刻落在队列上')
  console.log('ok: flip3d cycle order')
}

function testPeeledWindowAndGhosts(): void {
  assert.equal(peeledFlip3dWindowId(['a', 'b', 'c'], 1), 'a')
  assert.equal(peeledFlip3dWindowId(['a', 'b', 'c'], -1), 'c')
  assert.equal(peeledFlip3dWindowId(['only'], 1), undefined)
  const windowA = makeWindow('a', { title: 'A', x: 10, y: 20, width: 400, height: 300 })
  const first = createFlip3dGhost(windowA, 1, 'g1')
  const second = createFlip3dGhost(windowA, 1, 'g2')
  assert.equal(first.windowId, 'a')
  assert.equal(second.windowId, 'a')
  assert.notEqual(first.id, second.id)
  const both = [first, second]
  assert.equal(both.length, 2)
  assert.deepEqual(
    dismissFlip3dGhost(both, 'g1').map((ghost) => ghost.id),
    ['g2'],
  )
  let stacked: ReturnType<typeof createFlip3dGhost>[] = []
  for (let i = 0; i < FLIP3D_MAX_GHOSTS + 3; i++) {
    stacked = appendFlip3dGhost(stacked, createFlip3dGhost(windowA, 1, `g-${i}`))
  }
  assert.equal(stacked.length, FLIP3D_MAX_GHOSTS)
  assert.equal(stacked[0]?.id, `g-${3}`)
  console.log('ok: flip3d peeled window and concurrent ghosts')
}

function testBringToFront(): void {
  assert.deepEqual(bringFlip3dWindowToFront(['a', 'b', 'c'], 'c'), ['c', 'a', 'b'])
  assert.deepEqual(bringFlip3dWindowToFront(['a', 'b', 'c'], 'b'), ['b', 'a', 'c'])
  assert.deepEqual(bringFlip3dWindowToFront(['a', 'b', 'c'], 'a'), ['a', 'b', 'c'])
  assert.deepEqual(bringFlip3dWindowToFront(['a', 'b', 'c'], 'missing'), ['a', 'b', 'c'])
  console.log('ok: flip3d bring to front')
}

function testCycleVisual(): void {
  const order = ['a', 'b', 'c']
  const front = resolveFlip3dVisual(order, 'a')
  const back = resolveFlip3dVisual(order, 'c')
  assert.equal(front?.rank, 0)
  assert.equal(back?.rank, 2)
  assert.equal(front?.skipTransition, false)
  const cycled = cycleFlip3dOrder(order, 1)
  const peeled = peeledFlip3dWindowId(order, 1)
  assert.equal(peeled, 'a')
  assert.equal(resolveFlip3dVisual(cycled, 'a')?.rank, 2)
  assert.equal(resolveFlip3dVisual(cycled, 'b')?.rank, 0)
  assert.equal(resolveFlip3dVisual(cycled, 'missing'), undefined)
  assert.equal(resolveFlip3dVisual(cycled, 'a', [peeled!])?.skipTransition, true)
  assert.equal(resolveFlip3dVisual(cycled, 'a', [peeled!])?.fromBack, true)
  assert.equal(resolveFlip3dVisual(cycled, 'a', [peeled!])?.opacity, 0)
  assert.equal(resolveFlip3dVisual(cycled, 'b', [peeled!])?.skipTransition, false)
  assert.equal(resolveFlip3dVisual(cycled, 'b', [peeled!])?.fromBack, false)
  assert.equal(resolveFlip3dVisual(cycled, 'c', [peeled!])?.skipTransition, false)
  const reversed = cycleFlip3dOrder(order, -1)
  const reversePeeled = peeledFlip3dWindowId(order, -1)
  assert.equal(reversePeeled, 'c')
  assert.equal(resolveFlip3dVisual(reversed, 'c', [reversePeeled!])?.rank, 0)
  assert.equal(resolveFlip3dVisual(reversed, 'c', [reversePeeled!])?.fromBack, false)
  assert.equal(resolveFlip3dVisual(reversed, 'c', [reversePeeled!])?.skipTransition, true)
  console.log('ok: flip3d cycle visual')
}

function testFlyOutGoesRight(): void {
  const rest = computeFlip3dLayout(BOUNDS, 0, VIEWPORT)
  const fly = computeFlip3dFlyOutLayout(BOUNDS, VIEWPORT)
  assert.ok(fly.slotX > rest.slotX, '掠过时应往右飞出')
  assert.equal(fly.rotateY, rest.rotateY)
  console.log('ok: flip3d fly-out right')
}

function testBackEnterStartsBehindLast(): void {
  const last = computeFlip3dLayout(BOUNDS, 2, VIEWPORT, 3)
  const enter = computeFlip3dBackEnterLayout(BOUNDS, VIEWPORT, 3)
  assert.ok(enter.slotX < last.slotX, '入场起点应比最后一层更靠左')
  assert.ok(enter.slotY < last.slotY, '入场起点应比最后一层更靠上')
  assert.ok(enter.slotZ < last.slotZ, '入场起点应比最后一层更远')
  console.log('ok: flip3d back enter starts behind last')
}

function quadCentroid(quad: { x: number; y: number }[]): { x: number; y: number } {
  return {
    x: quad.reduce((sum, point) => sum + point.x, 0) / quad.length,
    y: quad.reduce((sum, point) => sum + point.y, 0) / quad.length,
  }
}

function testHitTestSelectsExposedBackWindow(): void {
  const front = BOUNDS
  const mid = { ...BOUNDS, width: 520, height: 400 }
  const back = { ...BOUNDS, width: 420, height: 320 }
  const order = ['front', 'mid', 'back']
  const boundsById = new Map([
    ['front', front],
    ['mid', mid],
    ['back', back],
  ])
  const frontQuad = projectFlip3dQuad(front, 0, VIEWPORT, 3)
  const backQuad = projectFlip3dQuad(back, 2, VIEWPORT, 3)
  assert.ok(frontQuad && backQuad)
  const frontCenter = quadCentroid(frontQuad)
  assert.equal(
    hitTestFlip3dWindowId(frontCenter.x, frontCenter.y, order, boundsById, VIEWPORT),
    'front',
  )
  const backLeft = backQuad[0]!
  const backCenter = quadCentroid(backQuad)
  const exposed = {
    x: backLeft.x * 0.82 + backCenter.x * 0.18,
    y: backLeft.y * 0.82 + backCenter.y * 0.18,
  }
  assert.equal(hitTestFlip3dWindowId(exposed.x, exposed.y, order, boundsById, VIEWPORT), 'back')
  assert.equal(hitTestFlip3dWindowId(12, 12, order, boundsById, VIEWPORT), undefined)
  console.log('ok: flip3d hit test selects exposed back window')
}

function testEligibleWindows(): void {
  const windows = [
    makeWindow('front', { zIndex: 5 }),
    makeWindow('min', { zIndex: 9, minimized: true }),
    makeWindow('closing', { zIndex: 8, closing: true }),
    makeWindow('hidden-windowless', { zIndex: 7, windowless: true }),
    makeWindow('panel', { zIndex: 4, windowless: true, windowlessPanel: true }),
    makeWindow('back', { zIndex: 2 }),
  ]
  assert.equal(isFlip3dEligibleWindow(windows[1]!), false)
  assert.deepEqual(listFlip3dWindowIds(windows), ['front', 'panel', 'back'])
  console.log('ok: flip3d eligible windows')
}

function main(): void {
  testRankRecedesUpAndLeft()
  testLayoutIgnoresDesktopPosition()
  testCssTransformEncodesDesktopOffset()
  testManyWindowsStayInFrontOfCamera()
  testScaleFitsCardWithoutUpscaling()
  testCycleOrder()
  testPeeledWindowAndGhosts()
  testBringToFront()
  testCycleVisual()
  testFlyOutGoesRight()
  testBackEnterStartsBehindLast()
  testHitTestSelectsExposedBackWindow()
  testEligibleWindows()
  console.log('all flip3d tests passed')
}

main()
