/**
 * 按键映射引擎单测：透传等价、单键改写、修饰位重算、互换序列、归一化与合并。
 * 运行：node --experimental-strip-types src/apps/virtual-machine/virtual-machine-keymap.test.ts
 */
import assert from 'node:assert/strict'
import { INSTANT_VM_MESSAGE_TYPE } from './virtual-machine-protocol.ts'
import {
  compileVmKeyMappings,
  isVmImeKeyEvent,
  normalizeVmKeyMappings,
  upsertVmKeyMappings,
  vmKeySpecFromEventFields,
  vmKeySpecIdentity,
  vmKeySpecLabel,
  VM_KEY_MAPPING_PRESETS,
  VM_KEY_QUICK_PICKS,
  VM_KEY_SPECS,
  VmKeyboardTranslator,
  type VmKeyMapping,
} from './virtual-machine-keymap.ts'

type EventFields = ReturnType<typeof keyEvent>

function keyEvent(fields: {
  key: string
  code: string
  keyCode: number
  location?: number
  repeat?: boolean
  shiftKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  metaKey?: boolean
}) {
  return {
    key: fields.key,
    code: fields.code,
    keyCode: fields.keyCode,
    location: fields.location ?? 0,
    repeat: fields.repeat ?? false,
    shiftKey: fields.shiftKey ?? false,
    ctrlKey: fields.ctrlKey ?? false,
    altKey: fields.altKey ?? false,
    metaKey: fields.metaKey ?? false,
  }
}

/** 与被移除的 guestKeyboardFromEvent 逐字段一致的参照实现（透传基准）。 */
function referenceMessage(event: EventFields, phase: 'down' | 'up') {
  return {
    type: INSTANT_VM_MESSAGE_TYPE.keyboard,
    phase,
    key: event.key,
    code: event.code,
    keyCode: event.keyCode,
    location: event.location,
    repeat: event.repeat,
    shiftKey: event.shiftKey,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
  }
}

const CMD = keyEvent({ key: 'Meta', code: 'MetaLeft', keyCode: 91, location: 1 })
const CTRL = keyEvent({ key: 'Control', code: 'ControlLeft', keyCode: 17, location: 1 })
const KEY_C_DOWN = keyEvent({ key: 'c', code: 'KeyC', keyCode: 67, metaKey: true })
const CAPS = keyEvent({ key: 'CapsLock', code: 'CapsLock', keyCode: 20 })

// —— 无映射：与原始事件逐字段一致（存量用户零行为变化）——
{
  const translator = new VmKeyboardTranslator()
  translator.setKeymap(compileVmKeyMappings(undefined))
  const events = [
    keyEvent({ key: 'a', code: 'KeyA', keyCode: 65 }),
    CMD,
    keyEvent({ key: 'F5', code: 'F5', keyCode: 116, repeat: true, shiftKey: true }),
    keyEvent({ key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, altKey: true, ctrlKey: true }),
  ]
  for (const event of events) {
    assert.deepEqual(translator.translate(event, 'down'), referenceMessage(event, 'down'))
    assert.deepEqual(translator.translate(event, 'up'), referenceMessage(event, 'up'))
  }
  // keyMappingEnabled=false 走同一旁路：显式给空表结果一致。
  assert.deepEqual(
    translator.translate(KEY_C_DOWN, 'down').metaKey,
    true,
  )
}

// —— 非修饰键映射（CapsLock→Delete）：只换四个身份字段，修饰位沿用事件自带位 ——
{
  const translator = new VmKeyboardTranslator()
  translator.setKeymap(
    compileVmKeyMappings([{ from: vmKeySpecFromEventFields(CAPS), to: VM_KEY_SPECS.delete }]),
  )
  const message = translator.translate(CAPS, 'down')
  assert.equal(message.key, 'Delete')
  assert.equal(message.code, 'Delete')
  assert.equal(message.keyCode, 46)
  assert.equal(message.location, 0)
  // 修饰族未被触碰：Shift 物理按住时位照常透传。
  const withShift = translator.translate(
    keyEvent({ key: 'a', code: 'KeyA', keyCode: 65, shiftKey: true }),
    'down',
  )
  assert.equal(withShift.shiftKey, true)
  assert.equal(withShift.key, 'a')
}

// —— ⌘→Ctrl：⌘C 必须以标准 Ctrl+C 进入客机，⌘ 自身 keyup 位复位 ——
{
  const translator = new VmKeyboardTranslator()
  translator.setKeymap(
    compileVmKeyMappings([
      { from: vmKeySpecFromEventFields(CMD), to: VM_KEY_SPECS.controlLeft },
    ]),
  )
  // ⌘ down → Control down（自带 ctrlKey）
  const cmdDown = translator.translate(CMD, 'down')
  assert.equal(cmdDown.key, 'Control')
  assert.equal(cmdDown.code, 'ControlLeft')
  assert.equal(cmdDown.keyCode, 17)
  assert.equal(cmdDown.location, 1)
  assert.equal(cmdDown.ctrlKey, true)
  assert.equal(cmdDown.metaKey, false)
  // c down（物理 metaKey=true）→ ctrl:true meta:false
  const cDown = translator.translate(KEY_C_DOWN, 'down')
  assert.equal(cDown.key, 'c')
  assert.equal(cDown.code, 'KeyC')
  assert.equal(cDown.keyCode, 67)
  assert.equal(cDown.ctrlKey, true)
  assert.equal(cDown.metaKey, false)
  // c up 仍带 ctrl；⌘ up 变 Control up 且位全部复位（UI Events 时序）
  const cUp = translator.translate(KEY_C_DOWN, 'up')
  assert.equal(cUp.ctrlKey, true)
  const cmdUp = translator.translate(CMD, 'up')
  assert.equal(cmdUp.key, 'Control')
  assert.equal(cmdUp.ctrlKey, false)
  assert.equal(cmdUp.metaKey, false)
}

// —— 右 ⌘ 也换右 Ctrl：位置信息不丢 ——
{
  const translator = new VmKeyboardTranslator()
  translator.setKeymap(
    compileVmKeyMappings([
      { from: VM_KEY_SPECS.metaRight, to: VM_KEY_SPECS.controlRight },
    ]),
  )
  const message = translator.translate(
    keyEvent({ key: 'Meta', code: 'MetaRight', keyCode: 93, location: 2 }),
    'down',
  )
  assert.equal(message.code, 'ControlRight')
  assert.equal(message.location, 2)
  assert.equal(message.ctrlKey, true)
}

// —— 「⌘ 与 Ctrl 互换」预设：物理 ⌘C 全序列 —— 客机应看到 Ctrl…C…Ctrl ——
{
  const swap = VM_KEY_MAPPING_PRESETS.find((preset) => preset.id === 'cmd-ctrl-swap')
  assert.ok(swap)
  assert.equal(swap.mappings.length, 4)
  const translator = new VmKeyboardTranslator()
  translator.setKeymap(compileVmKeyMappings(swap.mappings))
  const codes: string[] = []
  const flags: string[] = []
  for (const [event, phase] of [
    [CMD, 'down'],
    [KEY_C_DOWN, 'down'],
    [KEY_C_DOWN, 'up'],
    [CMD, 'up'],
  ] as const) {
    const message = translator.translate(event, phase)
    codes.push(`${phase}:${message.code}`)
    flags.push(
      `${message.shiftKey ? 'S' : ''}${message.ctrlKey ? 'C' : ''}${message.altKey ? 'A' : ''}${
        message.metaKey ? 'M' : ''
      }`,
    )
  }
  assert.deepEqual(codes, [
    'down:ControlLeft',
    'down:KeyC',
    'up:KeyC',
    'up:ControlLeft',
  ])
  assert.deepEqual(flags, ['C', 'C', 'C', ''])
  // 反向：物理 Ctrl 变 Win（meta 位），⌘ 未按。
  const ctrlDown = translator.translate(CTRL, 'down')
  assert.equal(ctrlDown.key, 'Meta')
  assert.equal(ctrlDown.code, 'MetaLeft')
  assert.equal(ctrlDown.keyCode, 91)
  assert.equal(ctrlDown.metaKey, true)
  assert.equal(ctrlDown.ctrlKey, false)
}

// —— 非修饰键映射成修饰键：CapsLock→Ctrl 后，CapsLock 按住期间字母带 ctrl ——
{
  const translator = new VmKeyboardTranslator()
  translator.setKeymap(
    compileVmKeyMappings([{ from: VM_KEY_SPECS.capsLock, to: VM_KEY_SPECS.controlLeft }]),
  )
  const capsDown = translator.translate(CAPS, 'down')
  assert.equal(capsDown.code, 'ControlLeft')
  assert.equal(capsDown.ctrlKey, true)
  const aDown = translator.translate(
    keyEvent({ key: 'a', code: 'KeyA', keyCode: 65 }),
    'down',
  )
  assert.equal(aDown.key, 'a')
  assert.equal(aDown.ctrlKey, true)
  const capsUp = translator.translate(CAPS, 'up')
  assert.equal(capsUp.ctrlKey, false)
}

// —— 未映射的修饰键族沿用事件位：仅映射 ⌘→Ctrl 时，物理 Shift/Alt 照常透传 ——
{
  const translator = new VmKeyboardTranslator()
  translator.setKeymap(
    compileVmKeyMappings([{ from: VM_KEY_SPECS.metaLeft, to: VM_KEY_SPECS.controlLeft }]),
  )
  // 真实序列：⌘ 与 Shift/Alt 的 down 都先经过翻译器，按住集合才有它们。
  translator.translate(
    keyEvent({ key: 'Shift', code: 'ShiftLeft', keyCode: 16, location: 1, shiftKey: true }),
    'down',
  )
  translator.translate(
    keyEvent({ key: 'Alt', code: 'AltLeft', keyCode: 18, location: 1, altKey: true }),
    'down',
  )
  translator.translate(CMD, 'down')
  const message = translator.translate(
    keyEvent({
      key: 'x',
      code: 'KeyX',
      keyCode: 88,
      shiftKey: true,
      altKey: true,
      metaKey: true,
    }),
    'down',
  )
  assert.equal(message.shiftKey, true)
  assert.equal(message.altKey, true)
  assert.equal(message.ctrlKey, true)
  assert.equal(message.metaKey, false)
}

// —— reset：中断后按住集合作废，位回落到「没有任何翻译修饰」——
{
  const translator = new VmKeyboardTranslator()
  translator.setKeymap(
    compileVmKeyMappings([{ from: VM_KEY_SPECS.metaLeft, to: VM_KEY_SPECS.controlLeft }]),
  )
  translator.translate(CMD, 'down')
  translator.reset()
  const cDown = translator.translate(KEY_C_DOWN, 'down')
  assert.equal(cDown.ctrlKey, false)
  assert.equal(cDown.metaKey, false)
}

// —— repeat 透传 ——
{
  const translator = new VmKeyboardTranslator()
  translator.setKeymap(
    compileVmKeyMappings([{ from: VM_KEY_SPECS.metaLeft, to: VM_KEY_SPECS.controlLeft }]),
  )
  translator.translate(CMD, 'down')
  const repeat = translator.translate(
    keyEvent({ key: 'Meta', code: 'MetaLeft', keyCode: 91, location: 1, repeat: true, metaKey: true }),
    'down',
  )
  assert.equal(repeat.repeat, true)
  assert.equal(repeat.code, 'ControlLeft')
}

// —— 标签：Mac 味键名 ——
{
  assert.equal(vmKeySpecLabel(VM_KEY_SPECS.metaLeft), '左 Command ⌘')
  assert.equal(vmKeySpecLabel(VM_KEY_SPECS.metaRight), '右 Command ⌘')
  assert.equal(vmKeySpecLabel(VM_KEY_SPECS.altLeft), '左 Option ⌥')
  assert.equal(vmKeySpecLabel(VM_KEY_SPECS.controlLeft), '左 Ctrl')
  assert.equal(vmKeySpecLabel({ key: 'a', code: 'KeyA', keyCode: 65, location: 0 }), 'A')
  assert.equal(vmKeySpecLabel({ key: '1', code: 'Digit1', keyCode: 49, location: 0 }), '1')
  assert.equal(vmKeySpecLabel(VM_KEY_SPECS.delete), 'Delete')
  assert.equal(vmKeySpecLabel(VM_KEY_SPECS.backspace), 'Backspace ⌫')
  assert.equal(vmKeySpecLabel(VM_KEY_SPECS.contextMenu), 'Menu')
  assert.equal(vmKeySpecLabel(VM_KEY_SPECS.enter), '回车')
  assert.equal(vmKeySpecLabel({ key: 'F5', code: 'F5', keyCode: 116, location: 0 }), 'F5')
  assert.equal(vmKeySpecLabel({ key: "'", code: 'IntlBackslash', keyCode: 226, location: 0 }), "'")
}

// —— 归一化：坏条目丢弃、同来源去重、来源=目标丢弃、截断上限 ——
{
  const valid = { from: VM_KEY_SPECS.metaLeft, to: VM_KEY_SPECS.controlLeft }
  assert.deepEqual(normalizeVmKeyMappings(undefined), [])
  assert.deepEqual(normalizeVmKeyMappings('nope'), [])
  assert.deepEqual(normalizeVmKeyMappings([null, 42, {}, { from: valid.from }]), [])
  assert.deepEqual(normalizeVmKeyMappings([{ from: valid.from, to: valid.from }]), [])
  assert.deepEqual(normalizeVmKeyMappings([valid, valid]), [valid])
  const badTarget = { from: valid.from, to: { key: 'Delete', code: 'Delete', keyCode: 'x', location: 0 } }
  assert.deepEqual(normalizeVmKeyMappings([badTarget]), [])
  const many = Array.from({ length: 40 }, (_, index) => ({
    from: { key: String(index), code: `Key${String.fromCodePoint(65 + (index % 26))}${index}`, keyCode: 65 + (index % 26), location: 0 },
    to: VM_KEY_SPECS.delete,
  }))
  assert.equal(normalizeVmKeyMappings(many).length, 24)
}

// —— 合并（设置面板）：同来源覆盖、上限内新增、来源=目标忽略 ——
{
  const current: VmKeyMapping[] = [
    { from: VM_KEY_SPECS.metaLeft, to: VM_KEY_SPECS.controlLeft },
  ]
  const replaced = upsertVmKeyMappings(current, [
    { from: VM_KEY_SPECS.metaLeft, to: VM_KEY_SPECS.delete },
  ])
  assert.equal(replaced.length, 1)
  assert.equal(replaced[0]?.to.code, 'Delete')
  const appended = upsertVmKeyMappings(current, [
    { from: VM_KEY_SPECS.capsLock, to: VM_KEY_SPECS.delete },
  ])
  assert.equal(appended.length, 2)
  assert.deepEqual(upsertVmKeyMappings(current, [current[0]!]), current)
  const full = Array.from({ length: 24 }, (_, index) => ({
    from: { key: String(index), code: `KeyX${index}`, keyCode: 88, location: 0 },
    to: VM_KEY_SPECS.delete,
  }))
  assert.equal(upsertVmKeyMappings(full, [{ from: VM_KEY_SPECS.capsLock, to: VM_KEY_SPECS.delete }]).length, 24)
  assert.equal(
    upsertVmKeyMappings(full, [{ from: full[0]!.from, to: VM_KEY_SPECS.insert }]).length,
    24,
  )
}

// —— 快选与预设健全性 ——
{
  assert.equal(new Set(VM_KEY_QUICK_PICKS.map((pick) => pick.spec.code)).size, VM_KEY_QUICK_PICKS.length)
  for (const pick of VM_KEY_QUICK_PICKS) {
    assert.ok(pick.label.length > 0)
    assert.ok(pick.spec.code.length > 0)
  }
  for (const preset of VM_KEY_MAPPING_PRESETS) {
    assert.ok(preset.mappings.length > 0)
    for (const mapping of preset.mappings) {
      assert.notEqual(
        vmKeySpecIdentity(mapping.from),
        vmKeySpecIdentity(mapping.to),
        `${preset.id} 存在来源=目标`,
      )
    }
  }
}

// —— IME 事件判定（宿主转发与捕获共用）——
{
  assert.equal(isVmImeKeyEvent({ isComposing: true } as KeyboardEvent), true)
  assert.equal(isVmImeKeyEvent({ keyCode: 229 } as KeyboardEvent), true)
  assert.equal(isVmImeKeyEvent({ key: 'Process' } as KeyboardEvent), true)
  assert.equal(isVmImeKeyEvent({ key: 'Unidentified' } as KeyboardEvent), true)
  assert.equal(isVmImeKeyEvent({ key: 'a', keyCode: 65 } as unknown as KeyboardEvent), false)
}

console.log('virtual-machine-keymap: all assertions passed')
