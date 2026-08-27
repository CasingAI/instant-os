import {
  INSTANT_VM_MESSAGE_TYPE,
  type InstantVmKeyboardMessage,
} from './virtual-machine-protocol.ts'

/**
 * 按键映射（Key Mapping）核心：键位规格、编译与事件翻译。
 * 宿主在把键盘事件注入客机前原地改写；协议消息、运行时、v86 均不感知。
 * 物理身份用 `event.code`（布局无关、位置确定）；`code` 为空的事件不做映射。
 */

/** 一次按键的完整描述，字段与真实 Chrome KeyboardEvent 一致（同 virtual-machine-send-keys 约定）。 */
export type VmKeySpec = {
  key: string
  code: string
  keyCode: number
  location: number
}

export type VmKeyMapping = {
  from: VmKeySpec
  to: VmKeySpec
}

/** 单台虚拟机最多允许的映射条数，防列表失控。 */
export const VM_KEY_MAPPINGS_LIMIT = 24

/** 常用键规格表。数值均对齐真实 Chrome（macOS）上报值，保证与物理按键不可区分。 */
export const VM_KEY_SPECS = {
  controlLeft: { key: 'Control', code: 'ControlLeft', keyCode: 17, location: 1 },
  controlRight: { key: 'Control', code: 'ControlRight', keyCode: 17, location: 2 },
  shiftLeft: { key: 'Shift', code: 'ShiftLeft', keyCode: 16, location: 1 },
  shiftRight: { key: 'Shift', code: 'ShiftRight', keyCode: 16, location: 2 },
  altLeft: { key: 'Alt', code: 'AltLeft', keyCode: 18, location: 1 },
  altRight: { key: 'Alt', code: 'AltRight', keyCode: 18, location: 2 },
  metaLeft: { key: 'Meta', code: 'MetaLeft', keyCode: 91, location: 1 },
  metaRight: { key: 'Meta', code: 'MetaRight', keyCode: 93, location: 2 },
  escape: { key: 'Escape', code: 'Escape', keyCode: 27, location: 0 },
  tab: { key: 'Tab', code: 'Tab', keyCode: 9, location: 0 },
  backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8, location: 0 },
  enter: { key: 'Enter', code: 'Enter', keyCode: 13, location: 0 },
  space: { key: ' ', code: 'Space', keyCode: 32, location: 0 },
  capsLock: { key: 'CapsLock', code: 'CapsLock', keyCode: 20, location: 0 },
  insert: { key: 'Insert', code: 'Insert', keyCode: 45, location: 0 },
  delete: { key: 'Delete', code: 'Delete', keyCode: 46, location: 0 },
  home: { key: 'Home', code: 'Home', keyCode: 36, location: 0 },
  end: { key: 'End', code: 'End', keyCode: 35, location: 0 },
  pageUp: { key: 'PageUp', code: 'PageUp', keyCode: 33, location: 0 },
  pageDown: { key: 'PageDown', code: 'PageDown', keyCode: 34, location: 0 },
  printScreen: { key: 'PrintScreen', code: 'PrintScreen', keyCode: 44, location: 0 },
  pause: { key: 'Pause', code: 'Pause', keyCode: 19, location: 0 },
  scrollLock: { key: 'ScrollLock', code: 'ScrollLock', keyCode: 145, location: 0 },
  contextMenu: { key: 'ContextMenu', code: 'ContextMenu', keyCode: 93, location: 0 },
} as const satisfies Record<string, VmKeySpec>

export type VmKeyMappingPreset = {
  id: string
  label: string
  description: string
  mappings: readonly VmKeyMapping[]
}

/** Mac → Windows 最常用的两组改法；同来源会被并入覆盖。 */
export const VM_KEY_MAPPING_PRESETS: readonly VmKeyMappingPreset[] = [
  {
    id: 'cmd-as-ctrl',
    label: '⌘ 当 Ctrl 用',
    description: 'Command 改写成 Ctrl，其余不变。⌘C/⌘V 等快捷键肌肉记忆直迁。',
    mappings: [
      { from: VM_KEY_SPECS.metaLeft, to: VM_KEY_SPECS.controlLeft },
      { from: VM_KEY_SPECS.metaRight, to: VM_KEY_SPECS.controlRight },
    ],
  },
  {
    id: 'cmd-ctrl-swap',
    label: '⌘ 与 Ctrl 互换',
    description: 'Command ↔ Ctrl 双向互换（Parallels 默认行为）。',
    mappings: [
      { from: VM_KEY_SPECS.metaLeft, to: VM_KEY_SPECS.controlLeft },
      { from: VM_KEY_SPECS.metaRight, to: VM_KEY_SPECS.controlRight },
      { from: VM_KEY_SPECS.controlLeft, to: VM_KEY_SPECS.metaLeft },
      { from: VM_KEY_SPECS.controlRight, to: VM_KEY_SPECS.metaRight },
    ],
  },
]

/** 目标键快选：Mac 键盘上没有或不顺手的 PC 键。 */
export const VM_KEY_QUICK_PICKS: readonly { spec: VmKeySpec; label: string }[] = [
  { spec: VM_KEY_SPECS.controlLeft, label: 'Ctrl' },
  { spec: VM_KEY_SPECS.altLeft, label: 'Alt' },
  { spec: VM_KEY_SPECS.metaLeft, label: 'Win' },
  { spec: VM_KEY_SPECS.delete, label: 'Delete' },
  { spec: VM_KEY_SPECS.insert, label: 'Insert' },
  { spec: VM_KEY_SPECS.home, label: 'Home' },
  { spec: VM_KEY_SPECS.end, label: 'End' },
  { spec: VM_KEY_SPECS.pageUp, label: 'PageUp' },
  { spec: VM_KEY_SPECS.pageDown, label: 'PageDown' },
  { spec: VM_KEY_SPECS.printScreen, label: 'PrintScreen' },
  { spec: VM_KEY_SPECS.pause, label: 'Pause' },
  { spec: VM_KEY_SPECS.contextMenu, label: 'Menu' },
]

type VmModifierFamily = 'shift' | 'ctrl' | 'alt' | 'meta'

/** 修饰键族看 `code`（ContextMenu 的 keyCode 也是 93，不能按 keyCode 归族）。 */
const MODIFIER_FAMILIES_BY_CODE: Record<string, VmModifierFamily> = {
  ShiftLeft: 'shift',
  ShiftRight: 'shift',
  ControlLeft: 'ctrl',
  ControlRight: 'ctrl',
  AltLeft: 'alt',
  AltRight: 'alt',
  MetaLeft: 'meta',
  MetaRight: 'meta',
}

/** `code` 缺失时兜底（合成事件 / 异常环境）。 */
const MODIFIER_FAMILIES_BY_KEY: Record<string, VmModifierFamily> = {
  Shift: 'shift',
  Control: 'ctrl',
  Alt: 'alt',
  Meta: 'meta',
}

function modifierFamilyOfSpec(spec: VmKeySpec): VmModifierFamily | undefined {
  return MODIFIER_FAMILIES_BY_CODE[spec.code] ?? MODIFIER_FAMILIES_BY_KEY[spec.key]
}

const KEY_LABELS_BY_CODE: Record<string, string> = {
  Escape: 'Esc',
  Tab: 'Tab',
  Backspace: 'Backspace ⌫',
  Enter: '回车',
  Space: '空格',
  CapsLock: 'CapsLock',
  Insert: 'Insert',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  PrintScreen: 'PrintScreen',
  Pause: 'Pause',
  ScrollLock: 'ScrollLock',
  ContextMenu: 'Menu',
  NumLock: 'NumLock',
  ArrowLeft: '←',
  ArrowUp: '↑',
  ArrowRight: '→',
  ArrowDown: '↓',
  Control: 'Ctrl',
  Shift: 'Shift',
  Alt: 'Option ⌥',
  Meta: 'Command ⌘',
}

function labelBaseFromCode(code: string): string | undefined {
  if (/^Key[A-Z]$/.test(code)) {
    return code.slice(3)
  }
  if (/^Digit\d$/.test(code)) {
    return code.slice(5)
  }
  if (/^F([1-9]|1[0-2])$/.test(code)) {
    return code
  }
  if (/^Numpad/.test(code)) {
    return `小键盘 ${code.slice(6)}`
  }
  return undefined
}

/** 面向 Mac 用户的键名：Meta/Alt 用 Command/Option，修饰键带左右。 */
export function vmKeySpecLabel(spec: VmKeySpec): string {
  const family = modifierFamilyOfSpec(spec)
  const base =
    KEY_LABELS_BY_CODE[spec.code] ??
    labelBaseFromCode(spec.code) ??
    KEY_LABELS_BY_CODE[spec.key] ??
    (spec.key || spec.code)
  if (!family) {
    return base
  }
  return `${spec.location === 2 ? '右' : '左'} ${base}`
}

/** 映射表里的物理身份：优先 code；code 为空退回 key（如某些合成环境）。 */
export function vmKeySpecIdentity(spec: VmKeySpec): string {
  return spec.code ? `code:${spec.code}` : `key:${spec.key}`
}

export type VmCompiledKeymap = {
  readonly targets: ReadonlyMap<string, VmKeySpec>
  /**
   * 有映射「进出」的修饰键族。这些族的事件位从按住集合重算（来源键与目标键都可能
   * 改变修饰位归属）；未涉及的族沿用事件自带位，非修饰键映射零扰动。
   */
  readonly touchedFamilies: ReadonlySet<VmModifierFamily>
}

const EMPTY_COMPILED_KEYMAP: VmCompiledKeymap = {
  targets: new Map(),
  touchedFamilies: new Set(),
}

export function compileVmKeyMappings(
  mappings: readonly VmKeyMapping[] | undefined,
): VmCompiledKeymap {
  if (!mappings || mappings.length === 0) {
    return EMPTY_COMPILED_KEYMAP
  }
  const targets = new Map<string, VmKeySpec>()
  const touchedFamilies = new Set<VmModifierFamily>()
  for (const mapping of mappings) {
    targets.set(vmKeySpecIdentity(mapping.from), mapping.to)
    for (const spec of [mapping.from, mapping.to]) {
      const family = modifierFamilyOfSpec(spec)
      if (family) {
        touchedFamilies.add(family)
      }
    }
  }
  return { targets, touchedFamilies }
}

type VmKeyboardEventFields = Pick<
  KeyboardEvent,
  'key' | 'code' | 'keyCode' | 'location' | 'repeat' | 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey'
>

export function vmKeySpecFromEventFields(
  event: Pick<KeyboardEvent, 'key' | 'code' | 'keyCode' | 'location'>,
): VmKeySpec {
  return {
    key: event.key,
    code: event.code,
    keyCode: event.keyCode,
    location: event.location,
  }
}

/** 捕获用：真实 KeyboardEvent → 规格。code 为空（IME 中间态等）由调用方过滤。 */
export function vmKeySpecFromKeyboardEvent(event: KeyboardEvent): VmKeySpec {
  return vmKeySpecFromEventFields(event)
}

export function isVmImeKeyEvent(event: KeyboardEvent): boolean {
  return (
    event.isComposing ||
    event.keyCode === 229 ||
    event.key === 'Process' ||
    event.key === 'Unidentified'
  )
}

/**
 * 把宿主键盘事件翻译成注入客机的键盘消息。
 * - 被按下键的四个身份字段整体替换为目标规格；未命中原样透传。
 * - 涉及修饰键的映射按「翻译后的按住集合」重算四个修饰位，保证
 *   ⌘→Ctrl 后 ⌘C 以标准 Ctrl+C 进入客机；修饰键自身 keyup 位自然复位
 *   （down 入集后算、up 出集后算，与 UI Events 时序一致）。
 * - 无映射时输出与原始事件逐字段一致（存量用户零行为变化）。
 */
export class VmKeyboardTranslator {
  private compiled: VmCompiledKeymap = EMPTY_COMPILED_KEYMAP
  /** 按住的物理键（只跟踪与修饰键相关的），identity → 物理规格。 */
  private readonly heldIdentities = new Map<string, VmKeySpec>()

  setKeymap(next: VmCompiledKeymap): void {
    if (next === this.compiled) {
      return
    }
    this.compiled = next
    this.heldIdentities.clear()
  }

  /** 清空按住集合：失焦 / 释放键盘 / 切换显示的虚拟机时调用，防粘键位。 */
  reset(): void {
    this.heldIdentities.clear()
  }

  translate(event: VmKeyboardEventFields, phase: InstantVmKeyboardMessage['phase']): InstantVmKeyboardMessage {
    const physical = vmKeySpecFromEventFields(event)
    const identity = vmKeySpecIdentity(physical)
    const target = this.compiled.targets.get(identity)
    const pressed = target ?? physical

    // 只有与修饰键相关（自身是修饰键，或被映射成修饰键）的键才需要进按住集合。
    const physicalFamily = modifierFamilyOfSpec(physical)
    const targetFamily = target === undefined ? undefined : modifierFamilyOfSpec(target)
    if (physicalFamily !== undefined || targetFamily !== undefined) {
      if (phase === 'down') {
        this.heldIdentities.set(identity, physical)
      } else {
        this.heldIdentities.delete(identity)
      }
    }

    return {
      type: INSTANT_VM_MESSAGE_TYPE.keyboard,
      phase,
      key: pressed.key,
      code: pressed.code,
      keyCode: pressed.keyCode,
      location: pressed.location,
      repeat: event.repeat,
      shiftKey: this.familyFlag(event.shiftKey, 'shift'),
      ctrlKey: this.familyFlag(event.ctrlKey, 'ctrl'),
      altKey: this.familyFlag(event.altKey, 'alt'),
      metaKey: this.familyFlag(event.metaKey, 'meta'),
    }
  }

  /** 未被映射触碰的族沿用事件自带位（Chrome 的真实按住状态）；触碰过的族查按住集合。 */
  private familyFlag(eventBit: boolean, family: VmModifierFamily): boolean {
    if (!this.compiled.touchedFamilies.has(family)) {
      return eventBit
    }
    for (const physical of this.heldIdentities.values()) {
      const translated = this.compiled.targets.get(vmKeySpecIdentity(physical)) ?? physical
      if (modifierFamilyOfSpec(translated) === family) {
        return true
      }
    }
    return false
  }
}

export function normalizeVmKeySpec(raw: unknown): VmKeySpec | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined
  }
  const record = raw as Record<string, unknown>
  if (typeof record.key !== 'string' || record.key.length === 0) {
    return undefined
  }
  if (typeof record.code !== 'string') {
    return undefined
  }
  const keyCode = record.keyCode
  if (typeof keyCode !== 'number' || !Number.isInteger(keyCode) || keyCode < 0 || keyCode > 255) {
    return undefined
  }
  if (record.location !== 0 && record.location !== 1 && record.location !== 2) {
    return undefined
  }
  return { key: record.key, code: record.code, keyCode, location: record.location }
}

/** 存储读入归一化：坏条目丢弃、同来源去重（先见者留）、来源=目标丢弃、截断到上限。 */
export function normalizeVmKeyMappings(raw: unknown): VmKeyMapping[] {
  if (!Array.isArray(raw)) {
    return []
  }
  const mappings: VmKeyMapping[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (mappings.length >= VM_KEY_MAPPINGS_LIMIT) {
      break
    }
    if (!item || typeof item !== 'object') {
      continue
    }
    const record = item as Record<string, unknown>
    const from = normalizeVmKeySpec(record.from)
    const to = normalizeVmKeySpec(record.to)
    if (!from || !to) {
      continue
    }
    const fromIdentity = vmKeySpecIdentity(from)
    if (fromIdentity === vmKeySpecIdentity(to) || seen.has(fromIdentity)) {
      continue
    }
    seen.add(fromIdentity)
    mappings.push({ from, to })
  }
  return mappings
}

/** 设置面板写入用：同来源覆盖、来源=目标丢弃、超上限的新增丢弃。 */
export function upsertVmKeyMappings(
  current: readonly VmKeyMapping[],
  additions: readonly VmKeyMapping[],
): VmKeyMapping[] {
  const map = new Map(current.map((mapping) => [vmKeySpecIdentity(mapping.from), mapping]))
  for (const addition of additions) {
    const fromIdentity = vmKeySpecIdentity(addition.from)
    if (fromIdentity === vmKeySpecIdentity(addition.to)) {
      continue
    }
    if (map.size >= VM_KEY_MAPPINGS_LIMIT && !map.has(fromIdentity)) {
      continue
    }
    map.set(fromIdentity, addition)
  }
  return [...map.values()]
}
