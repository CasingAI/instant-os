/**
 * 虚拟机剪贴板同步决策逻辑单测。
 * 运行：node --experimental-strip-types src/apps/virtual-machine/virtual-machine-clipboard.test.ts
 */
import assert from 'node:assert/strict'
import {
  createVmClipboardSyncState,
  normalizeGuestClipboardText,
  normalizeHostClipboardTextForGuest,
  onGuestClipboardReceived,
  onHostClipboardChanged,
} from './virtual-machine-clipboard.ts'

function testHostPushAndEchoSuppression(): void {
  const state = createVmClipboardSyncState()
  // 用户在宿主复制 → 推给客机
  assert.equal(onHostClipboardChanged(state, 'host text'), 'host text')
  // 同一轮文本没变 → 不推
  assert.equal(onHostClipboardChanged(state, 'host text'), null)
  // 宿主新变化 → 推
  assert.equal(onHostClipboardChanged(state, 'second'), 'second')
}

function testGuestReceiveSuppressesEcho(): void {
  const state = createVmClipboardSyncState()
  // 客机送来文本 → 写宿主
  assert.equal(onGuestClipboardReceived(state, 'guest text'), 'guest text')
  // 下一轮宿主轮询读到刚落地的同文本：是回声 → 不回推客机
  assert.equal(onHostClipboardChanged(state, 'guest text'), null)
  // 用户随后在宿主复制别的 → 正常推
  assert.equal(onHostClipboardChanged(state, 'user copy'), 'user copy')
}

function testRepeatedGuestTextIgnored(): void {
  const state = createVmClipboardSyncState()
  assert.equal(onGuestClipboardReceived(state, 'same'), 'same')
  // 客机重发同文本（理论上桥已拦，这里是兜底）→ 不重复写宿主
  assert.equal(onGuestClipboardReceived(state, 'same'), null)
  assert.equal(onGuestClipboardReceived(state, 'other'), 'other')
}

function testEmptyTextNotSynced(): void {
  const state = createVmClipboardSyncState()
  // 宿主剪贴板是图片/富文本：readText() 返回空 → 不推给客机
  assert.equal(onHostClipboardChanged(state, ''), null)
  // 持续为空也不推
  assert.equal(onHostClipboardChanged(state, ''), null)
  // 恢复非空 → 正常推（状态没被空串卡死）
  assert.equal(onHostClipboardChanged(state, 'real'), 'real')
  // 客机送来空文本 → 不清掉宿主剪贴板
  assert.equal(onGuestClipboardReceived(state, ''), null)
}

function testNewlineNormalization(): void {
  // 宿主→客机：裸 \n / 孤立 \r 都归一成 \r\n；已是 \r\n 原样（幂等）
  assert.equal(normalizeHostClipboardTextForGuest('a\nb\nc'), 'a\r\nb\r\nc')
  assert.equal(normalizeHostClipboardTextForGuest('a\rb'), 'a\r\nb')
  assert.equal(normalizeHostClipboardTextForGuest('a\r\nb'), 'a\r\nb')
  assert.equal(
    normalizeHostClipboardTextForGuest(normalizeHostClipboardTextForGuest('x\ny')),
    'x\r\ny',
  )
  // 客机→宿主：\r\n 归一成 \n；裸 \n 原样；孤立 \r 不动（避免误伤罕见内容）
  assert.equal(normalizeGuestClipboardText('a\r\nb\r\nc'), 'a\nb\nc')
  assert.equal(normalizeGuestClipboardText('a\nb'), 'a\nb')
  assert.equal(normalizeGuestClipboardText('a\rb'), 'a\rb')
  assert.equal(normalizeGuestClipboardText(''), '')
}

function testNormalizedRoundTripNoLoop(): void {
  const state = createVmClipboardSyncState()
  // 宿主复制多行（\n）→ 决策层返回原文，推送前归一成 \r\n
  const push = onHostClipboardChanged(state, 'sc query\nnet use')
  assert.equal(push, 'sc query\nnet use')
  const guestPush = normalizeHostClipboardTextForGuest(push)
  assert.equal(guestPush, 'sc query\r\nnet use')
  // 指纹记的是宿主原文：下一轮轮询读到原文 → 不回推
  assert.equal(onHostClipboardChanged(state, 'sc query\nnet use'), null)
  // 客机（\r\n）复制送来 → 归一成 \n 后写宿主，指纹与实写一致
  const write = onGuestClipboardReceived(
    state,
    normalizeGuestClipboardText('dir\r\ncd\r\n'),
  )
  assert.equal(write, 'dir\ncd\n')
  // 下一轮轮询读到刚落地的 \n 文本：是回声 → 不回推客机
  assert.equal(onHostClipboardChanged(state, 'dir\ncd\n'), null)
}

function main(): void {
  testHostPushAndEchoSuppression()
  testGuestReceiveSuppressesEcho()
  testRepeatedGuestTextIgnored()
  testEmptyTextNotSynced()
  testNewlineNormalization()
  testNormalizedRoundTripNoLoop()
  console.log('virtual-machine-clipboard.test.ts ok')
}

main()
