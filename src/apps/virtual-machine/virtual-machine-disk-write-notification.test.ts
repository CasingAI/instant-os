/**
 * 硬盘回写失败系统通知：同机归并、详情进 body。
 * 运行：node --experimental-strip-types src/apps/virtual-machine/virtual-machine-disk-write-notification.test.ts
 */
import assert from 'node:assert/strict'
import { dismissOsNotification, getOsNotification } from '../../os/os-notifications.ts'
import {
  postVirtualMachineDiskWriteFailedNotification,
  virtualMachineDiskWriteFailedBody,
  virtualMachineDiskWriteFailedNotificationId,
  VM_DISK_WRITE_FAILED_NOTIFICATION_COPY,
} from './virtual-machine-disk-write-notification.ts'

function testNotificationIdAndBody(): void {
  assert.equal(
    virtualMachineDiskWriteFailedNotificationId('vm-1'),
    'virtual-machine:disk-write:vm-1',
  )
  assert.equal(
    virtualMachineDiskWriteFailedBody('回写硬盘超时'),
    '未能把磁盘改动写入镜像。镜像可能不完整，下次开机不要当作干净底盘。\n\n回写硬盘超时',
  )
  assert.equal(
    virtualMachineDiskWriteFailedBody('  '),
    '未能把磁盘改动写入镜像。镜像可能不完整，下次开机不要当作干净底盘。',
  )
}

function testPostsOncePerMachine(): void {
  const machineId = 'vm-notify-test'
  const id = virtualMachineDiskWriteFailedNotificationId(machineId)
  dismissOsNotification(id)
  postVirtualMachineDiskWriteFailedNotification({
    machineId,
    machineName: 'XP',
    detail: '回写硬盘超时',
  })
  const first = getOsNotification(id)
  assert.equal(first?.title, 'XP')
  assert.equal(first?.subtitle, VM_DISK_WRITE_FAILED_NOTIFICATION_COPY.subtitle)
  assert.equal(first?.phase, 'failure')
  assert.equal(first?.banner, 'once')
  assert.equal(first?.icon.kind, 'app')
  if (first?.icon.kind === 'app') {
    assert.equal(first.icon.appId, 'virtual-machine')
  }
  assert.match(first?.body ?? '', /回写硬盘超时/)
  postVirtualMachineDiskWriteFailedNotification({
    machineId,
    machineName: 'XP',
    detail: '另一条失败',
  })
  const second = getOsNotification(id)
  assert.equal(second?.body, first?.body)
  dismissOsNotification(id)
  postVirtualMachineDiskWriteFailedNotification({
    machineId,
    machineName: 'XP',
    detail: '关掉后再失败',
  })
  const third = getOsNotification(id)
  assert.match(third?.body ?? '', /关掉后再失败/)
  dismissOsNotification(id)
}

testNotificationIdAndBody()
testPostsOncePerMachine()
console.log('virtual-machine-disk-write-notification.test.ts ok')
