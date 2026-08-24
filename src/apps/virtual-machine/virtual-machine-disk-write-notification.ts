import {
  dismissOsNotification,
  getOsNotification,
  postOsNotification,
} from '../../os/os-notifications.ts'

export const VM_DISK_WRITE_FAILED_NOTIFICATION_COPY = {
  subtitle: '硬盘回写失败',
  dismissButton: '忽略',
} as const

const BODY_LEAD = '未能把磁盘改动写入镜像。镜像可能不完整，下次开机不要当作干净底盘。'

export function virtualMachineDiskWriteFailedNotificationId(machineId: string): string {
  return `virtual-machine:disk-write:${machineId}`
}

export function virtualMachineDiskWriteFailedBody(detail: string): string {
  const trimmed = detail.trim()
  if (!trimmed) {
    return BODY_LEAD
  }
  return `${BODY_LEAD}\n\n${trimmed}`
}

export function postVirtualMachineDiskWriteFailedNotification(input: {
  machineId: string
  machineName: string
  detail: string
}): void {
  const id = virtualMachineDiskWriteFailedNotificationId(input.machineId)
  if (getOsNotification(id)) {
    return
  }
  const title = input.machineName.trim() || 'Virtual Machine'
  postOsNotification(
    {
      id,
      title,
      subtitle: VM_DISK_WRITE_FAILED_NOTIFICATION_COPY.subtitle,
      phase: 'failure',
      icon: { kind: 'app', appId: 'virtual-machine' },
      body: virtualMachineDiskWriteFailedBody(input.detail),
      banner: 'once',
      actions: [{ id: 'dismiss', label: VM_DISK_WRITE_FAILED_NOTIFICATION_COPY.dismissButton }],
    },
    {
      onAction: {
        dismiss: () => dismissOsNotification(id),
      },
    },
  )
}
