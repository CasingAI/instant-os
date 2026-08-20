import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isExtAppBootstrapRequestMessage } from './ext-app-bootstrap-messages.ts'
import { rewriteCssFontUrls } from './rewrite-css-font-urls.ts'

test('rewriteCssFontUrls 把 /fonts 路径改成宿主绝对 URL', () => {
  const css = "src: url('/fonts/apple-color-emoji/AppleColorEmoji[1].ttf') format('truetype');"
  assert.equal(
    rewriteCssFontUrls(css, 'http://localhost:6173'),
    "src: url('http://localhost:6173/fonts/apple-color-emoji/AppleColorEmoji[1].ttf') format('truetype');",
  )
  assert.equal(
    rewriteCssFontUrls(css, 'http://localhost:6173/'),
    "src: url('http://localhost:6173/fonts/apple-color-emoji/AppleColorEmoji[1].ttf') format('truetype');",
  )
})

test('isExtAppBootstrapRequestMessage 只接受 ext: appId', () => {
  assert.equal(
    isExtAppBootstrapRequestMessage({
      type: 'instant-os-ext-app-bootstrap-request',
      appId: 'ext:example-app',
    }),
    true,
  )
  assert.equal(
    isExtAppBootstrapRequestMessage({
      type: 'instant-os-ext-app-bootstrap-request',
      appId: 'gen:foo',
    }),
    false,
  )
})
