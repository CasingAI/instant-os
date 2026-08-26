/**
 * 发送按键预设的序列合成：down/up 顺序、修饰键位、功能键码值。
 * 运行：node --experimental-strip-types src/apps/virtual-machine/virtual-machine-send-keys.test.ts
 */
import assert from 'node:assert/strict'
import { INSTANT_VM_MESSAGE_TYPE } from './virtual-machine-protocol.ts'
import {
  buildKeyboardSequence,
  VM_COMBO_KEY_PRESETS,
  VM_FUNCTION_KEY_PRESETS,
  type VmSendKeyPreset,
} from './virtual-machine-send-keys.ts'

function presetById(presets: readonly VmSendKeyPreset[], id: string): VmSendKeyPreset {
  const preset = presets.find((item) => item.id === id)
  assert.ok(preset, `缺少预设 ${id}`)
  return preset
}

// Ctrl+Alt+Del：三键按住后逆序抬起，共 6 条消息。
{
  const sequence = buildKeyboardSequence(presetById(VM_COMBO_KEY_PRESETS, 'ctrl-alt-del'))
  assert.equal(sequence.length, 6)
  assert.deepEqual(
    sequence.map((message) => `${message.phase}:${message.code}`),
    [
      'down:ControlLeft',
      'down:AltLeft',
      'down:Delete',
      'up:Delete',
      'up:AltLeft',
      'up:ControlLeft',
    ],
  )
  // 码值与真实 Chrome 键盘事件一致（17=Ctrl 18=Alt 46=Delete）。
  assert.deepEqual(
    sequence.map((message) => message.keyCode),
    [17, 18, 46, 46, 18, 17],
  )
  // 按下 Delete 时 Ctrl、Alt 都处于按住状态；按下 Ctrl 那条自带 ctrlKey。
  assert.equal(sequence[0].ctrlKey, true)
  assert.equal(sequence[1].ctrlKey, true)
  assert.equal(sequence[1].altKey, true)
  assert.equal(sequence[2].ctrlKey, true)
  assert.equal(sequence[2].altKey, true)
  assert.equal(sequence[2].shiftKey, false)
  assert.equal(sequence[2].metaKey, false)
  // 抬起 Delete 时 Ctrl、Alt 仍按住，最后一条全部松开。
  assert.equal(sequence[3].ctrlKey, true)
  assert.equal(sequence[3].altKey, true)
  assert.equal(sequence[5].ctrlKey, false)
  assert.equal(sequence[5].altKey, false)
}

// F 功能键：单键 down/up，码值 112–123 连续。
{
  const f5 = presetById(VM_FUNCTION_KEY_PRESETS, 'f5')
  const sequence = buildKeyboardSequence(f5)
  assert.equal(sequence.length, 2)
  assert.equal(sequence[0].phase, 'down')
  assert.equal(sequence[1].phase, 'up')
  assert.equal(sequence[0].key, 'F5')
  assert.equal(sequence[0].code, 'F5')
  assert.equal(sequence[0].keyCode, 116)
  assert.equal(sequence[0].location, 0)
  assert.deepEqual(
    VM_FUNCTION_KEY_PRESETS.map((preset) => buildKeyboardSequence(preset)[0].keyCode),
    Array.from({ length: 12 }, (_, index) => 112 + index),
  )
}

// Win 单键：down 自带 metaKey；按 UI Events 规范，修饰键自身 keyup 时该位已复位。
{
  const sequence = buildKeyboardSequence(presetById(VM_COMBO_KEY_PRESETS, 'meta'))
  assert.equal(sequence.length, 2)
  assert.equal(sequence[0].code, 'MetaLeft')
  assert.equal(sequence[0].keyCode, 91)
  assert.equal(sequence[0].metaKey, true)
  assert.equal(sequence[0].ctrlKey, false)
  assert.equal(sequence[1].metaKey, false)
}

// Alt+Tab：按下 Tab 时 altKey 仍为真。
{
  const sequence = buildKeyboardSequence(presetById(VM_COMBO_KEY_PRESETS, 'alt-tab'))
  assert.deepEqual(
    sequence.map((message) => `${message.phase}:${message.code}`),
    ['down:AltLeft', 'down:Tab', 'up:Tab', 'up:AltLeft'],
  )
  assert.equal(sequence[1].altKey, true)
  assert.equal(sequence[2].altKey, true)
  assert.equal(sequence[3].altKey, false)
}

// 所有预设：消息类型正确、无 repeat、序列结束时全部松开。
for (const preset of [...VM_COMBO_KEY_PRESETS, ...VM_FUNCTION_KEY_PRESETS]) {
  const sequence = buildKeyboardSequence(preset)
  assert.ok(sequence.length >= 2 && sequence.length % 2 === 0, `${preset.id} 序列长度异常`)
  for (const message of sequence) {
    assert.equal(message.type, INSTANT_VM_MESSAGE_TYPE.keyboard)
    assert.equal(message.repeat, false)
    assert.ok(typeof message.key === 'string' && message.key.length > 0)
  }
  const last = sequence[sequence.length - 1]
  assert.equal(last.phase, 'up')
  assert.equal(last.shiftKey, false, `${preset.id} 结束时 shift 未松开`)
  assert.equal(last.ctrlKey, false, `${preset.id} 结束时 ctrl 未松开`)
  assert.equal(last.altKey, false, `${preset.id} 结束时 alt 未松开`)
  assert.equal(last.metaKey, false, `${preset.id} 结束时 meta 未松开`)
}

console.log('virtual-machine-send-keys: all assertions passed')
