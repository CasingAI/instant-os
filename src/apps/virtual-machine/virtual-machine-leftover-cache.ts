/**
 * 开机前的残留硬盘缓存处理：异常结束（直接关页面/浏览器崩溃）跳过了关机收尾，
 * `vm-disk-cache` 附加会残留在镜像上。残留 = 上次「写入还是丢弃」的询问从未发生，
 * 所以开机前补上这一问；四种回答里只有 first-aid 会取消本次开机（镜像一旦被 VM
 * 占用，磁盘工具那边就处理不了了）。
 *
 * 合并/丢弃不在这里另起炉灶，全部复用磁盘工具急救的实现；本层只做检测汇总与编排。
 * live（尽快写入）档不参与：残留缓存在注册磁盘流时已自动静默合并
 * （virtual-machine-disk-stream-host.ts 注册入口），无残留可报。
 */
import {
  analyzeVirtualMachineDiskCache,
  discardVirtualMachineDiskCache,
  mergeVirtualMachineDiskCacheIntoImage,
  type VmDiskFirstAidReport,
} from './virtual-machine-disk-first-aid.ts'
import type { VirtualMachineRecord } from './virtual-machine-types.ts'

export type VmLeftoverCacheDecision = 'merge' | 'discard' | 'first-aid' | 'keep'

/**
 * 检出残留缓存并执行用户的选择；返回是否继续开机。
 * - 无残留 / keep（含用户关掉对话框）→ 'proceed'，残留由下次正常关机兜底；
 * - merge / discard → 逐盘执行完再 'proceed'，失败抛错（调用方中止开机）；
 * - first-aid → 什么都不动，'abort'（用户要去磁盘工具，镜像不能被这次开机占用）。
 */
export async function resolveLeftoverDiskCacheBeforeBoot(
  machine: VirtualMachineRecord,
  decide: (reports: readonly VmDiskFirstAidReport[]) => Promise<VmLeftoverCacheDecision>,
  onProgress?: (info: { mergedBytes: number; totalBytes: number }) => void,
): Promise<'proceed' | 'abort'> {
  if (machine.diskWriteMode === 'live') {
    return 'proceed'
  }
  const reports: VmDiskFirstAidReport[] = []
  for (const device of machine.devices) {
    if (device.type !== 'hdd') {
      continue
    }
    const imagePath = device.path.trim()
    if (!imagePath) {
      continue
    }
    try {
      const report = await analyzeVirtualMachineDiskCache(imagePath)
      if (report) {
        reports.push(report)
      }
    } catch {
      // 分析失败（如镜像正被文件挂载占用）不拦开机：占用冲突稍后由开机流程自身报错。
    }
  }
  if (reports.length === 0) {
    return 'proceed'
  }
  const decision = await decide(reports)
  if (decision === 'first-aid') {
    return 'abort'
  }
  if (decision === 'merge') {
    for (const report of reports) {
      await mergeVirtualMachineDiskCacheIntoImage({ imagePath: report.imagePath, onProgress })
    }
  } else if (decision === 'discard') {
    for (const report of reports) {
      await discardVirtualMachineDiskCache(report.imagePath)
    }
  }
  return 'proceed'
}
