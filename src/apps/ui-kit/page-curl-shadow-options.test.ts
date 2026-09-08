import assert from 'node:assert/strict'
import {
  DEFAULT_PAGE_CURL_SHADOWS,
  shadowToggleValues,
  togglePageCurlShadow,
} from './page-curl-shadow-options.ts'

assert.deepEqual(shadowToggleValues(DEFAULT_PAGE_CURL_SHADOWS), [1, 1, 1, 1])

for (const [index, key] of ['underlay', 'edge', 'front', 'back'].entries()) {
  const next = togglePageCurlShadow(DEFAULT_PAGE_CURL_SHADOWS, key, false)
  const values = shadowToggleValues(next)
  assert.equal(values[index], 0, `${key} 应该关闭对应阴影`)
  assert.equal(values.filter((value) => value === 0).length, 1, `${key} 不应关闭其他阴影`)
}
