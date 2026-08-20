/**
 * 运行：node --experimental-strip-types src/apps/chromo/chromo-page-zoom.test.ts
 */
import assert from 'node:assert/strict'
import {
  CHROMO_DEFAULT_ZOOM,
  chromoViewerZoomStyle,
  formatChromoZoom,
  nextChromoZoom,
} from './chromo-page-zoom.ts'

function testZoomSteps(): void {
  assert.equal(nextChromoZoom(CHROMO_DEFAULT_ZOOM, 1), 1.1)
  assert.equal(nextChromoZoom(CHROMO_DEFAULT_ZOOM, -1), 0.9)
  assert.equal(nextChromoZoom(3, 1), 3)
  assert.equal(nextChromoZoom(0.5, -1), 0.5)
  assert.equal(formatChromoZoom(1.25), '125%')
  console.log('ok: zoom steps')
}

function testViewerZoomStyle(): void {
  assert.equal(chromoViewerZoomStyle(1), undefined)
  const style = chromoViewerZoomStyle(2)
  assert.ok(style)
  assert.equal(style?.transform, 'scale(2)')
  assert.equal(style?.transformOrigin, '0 0')
  assert.equal(style?.width, '50%')
  assert.equal(style?.height, '50%')
  console.log('ok: viewer zoom style')
}

testZoomSteps()
testViewerZoomStyle()
console.log('chromo-page-zoom tests passed')
