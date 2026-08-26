import {
  INSTANT_VM_MESSAGE_TYPE,
  type InstantVmKeyboardMessage,
} from './virtual-machine-protocol.ts'

/**
 * 「发送按键」：宿主侧合成键盘消息序列，经现有 `instant-vm:keyboard` 通道注入运行时。
 * 不新增协议消息——组合键就是「逐个按下、逆序抬起」的一串键盘消息。
 */

/** 一次物理按键。字段取值与真实 Chrome KeyboardEvent 完全一致，保证运行时按键映射结果相同。 */
export type VmKeyStep = {
  key: string
  code: string
  keyCode: number
  location: number
}

export type VmSendKeyPreset = {
  id: string
  /** 菜单展示名，如「Ctrl+Alt+Del」。 */
  label: string
  /** 组合内的物理键，按真实敲击顺序排列（先按的在前）。 */
  steps: readonly VmKeyStep[]
}

/** 左手侧修饰键与常用键的键值表。 */
const VM_KEYS = {
  control: { key: 'Control', code: 'ControlLeft', keyCode: 17, location: 1 },
  shift: { key: 'Shift', code: 'ShiftLeft', keyCode: 16, location: 1 },
  alt: { key: 'Alt', code: 'AltLeft', keyCode: 18, location: 1 },
  meta: { key: 'Meta', code: 'MetaLeft', keyCode: 91, location: 1 },
  escape: { key: 'Escape', code: 'Escape', keyCode: 27, location: 0 },
  tab: { key: 'Tab', code: 'Tab', keyCode: 9, location: 0 },
  delete: { key: 'Delete', code: 'Delete', keyCode: 46, location: 0 },
  printScreen: { key: 'PrintScreen', code: 'PrintScreen', keyCode: 44, location: 0 },
  keyD: { key: 'd', code: 'KeyD', keyCode: 68, location: 0 },
  keyE: { key: 'e', code: 'KeyE', keyCode: 69, location: 0 },
} as const satisfies Record<string, VmKeyStep>

function functionKeyStep(number_: number): VmKeyStep {
  return { key: `F${number_}`, code: `F${number_}`, keyCode: 111 + number_, location: 0 }
}

/** 组合键预设，菜单里平铺展示。 */
export const VM_COMBO_KEY_PRESETS: readonly VmSendKeyPreset[] = [
  {
    id: 'ctrl-alt-del',
    label: 'Ctrl+Alt+Del',
    steps: [VM_KEYS.control, VM_KEYS.alt, VM_KEYS.delete],
  },
  {
    id: 'ctrl-shift-esc',
    label: 'Ctrl+Shift+Esc',
    steps: [VM_KEYS.control, VM_KEYS.shift, VM_KEYS.escape],
  },
  { id: 'alt-tab', label: 'Alt+Tab', steps: [VM_KEYS.alt, VM_KEYS.tab] },
  { id: 'ctrl-esc', label: 'Ctrl+Esc', steps: [VM_KEYS.control, VM_KEYS.escape] },
  { id: 'esc', label: 'Esc', steps: [VM_KEYS.escape] },
  { id: 'meta', label: 'Win 键', steps: [VM_KEYS.meta] },
  { id: 'meta-d', label: 'Win+D', steps: [VM_KEYS.meta, VM_KEYS.keyD] },
  { id: 'meta-e', label: 'Win+E', steps: [VM_KEYS.meta, VM_KEYS.keyE] },
  { id: 'print-screen', label: 'PrintScreen', steps: [VM_KEYS.printScreen] },
]

/** 功能键预设 F1–F12，菜单里收进子菜单。 */
export const VM_FUNCTION_KEY_PRESETS: readonly VmSendKeyPreset[] = Array.from(
  { length: 12 },
  (_, index) => {
    const number_ = index + 1
    return { id: `f${number_}`, label: `F${number_}`, steps: [functionKeyStep(number_)] }
  },
)

type ModifierState = Pick<
  InstantVmKeyboardMessage,
  'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey'
>

function modifierStateOf(held: readonly VmKeyStep[]): ModifierState {
  const state: ModifierState = { shiftKey: false, ctrlKey: false, altKey: false, metaKey: false }
  for (const step of held) {
    if (step.keyCode === 16) {
      state.shiftKey = true
    } else if (step.keyCode === 17) {
      state.ctrlKey = true
    } else if (step.keyCode === 18) {
      state.altKey = true
    } else if (step.keyCode === 91 || step.keyCode === 92) {
      state.metaKey = true
    }
  }
  return state
}

function keyboardMessage(
  step: VmKeyStep,
  phase: InstantVmKeyboardMessage['phase'],
  held: readonly VmKeyStep[],
): InstantVmKeyboardMessage {
  return {
    type: INSTANT_VM_MESSAGE_TYPE.keyboard,
    phase,
    key: step.key,
    code: step.code,
    keyCode: step.keyCode,
    location: step.location,
    repeat: false,
    ...modifierStateOf(held),
  }
}

/**
 * 把预设展开成与真实敲击一致的键盘消息序列：
 * 先按住顺序逐键 down，再逆序逐键 up。每条消息的修饰键位反映「此刻实际按住的键」
 * （按下某键的那条事件本身就带它自己的修饰位，与 Chrome 行为一致），最后全部松开。
 */
export function buildKeyboardSequence(preset: VmSendKeyPreset): InstantVmKeyboardMessage[] {
  const messages: InstantVmKeyboardMessage[] = []
  preset.steps.forEach((step, index) => {
    messages.push(keyboardMessage(step, 'down', preset.steps.slice(0, index + 1)))
  })
  for (let index = preset.steps.length - 1; index >= 0; index -= 1) {
    messages.push(keyboardMessage(preset.steps[index], 'up', preset.steps.slice(0, index)))
  }
  return messages
}
