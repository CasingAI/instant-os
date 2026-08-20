import type { VmBackendId } from './virtual-machine-types.ts'
import { isVmRuntimeConfigured } from './virtual-machine-runtime-config.ts'

export type VmBackendCatalogEntry = {
  id: VmBackendId
  label: string
  available: boolean
  unavailableReason: string
}

export function getVmBackend(id: VmBackendId): VmBackendCatalogEntry {
  if (id === 'v86') {
    const configured = isVmRuntimeConfigured()
    return {
      id: 'v86',
      label: 'V86',
      available: configured,
      unavailableReason: configured ? '' : '未配置虚拟机运行时',
    }
  }
  return {
    id,
    label: id,
    available: false,
    unavailableReason: '尚未接入模拟器',
  }
}

export function formatVmBackendLabel(id: VmBackendId): string {
  return getVmBackend(id).label
}

export function vmPowerUnavailableMessage(action: 'start' | 'stop' | 'reset'): string {
  const verb = action === 'start' ? '开机' : action === 'stop' ? '关机' : '重置'
  const reason = getVmBackend('v86').unavailableReason || '尚未接入模拟器'
  return `无法${verb}：${reason}`
}
