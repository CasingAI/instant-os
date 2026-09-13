/**
 * 深链跳转：别的程序打开磁盘工具、跳到某份盘、自动进急救分析。
 * 模式与 os/settings-route-open.ts 一致：模块级 pending 标志（应用未打开时）
 * + CustomEvent（应用已打开时），DiskUtilityApp 挂载后 take/consume。
 */
import { osOpenApp } from '../../os/os-open-app-bridge.ts'

const OPEN_DISK_UTILITY_FIRST_AID_EVENT = 'instant-os:open-disk-utility-first-aid'

let pendingFirstAidImagePath: string | undefined

/** 打开磁盘工具（或已打开时）请求对 imagePath 这份虚拟盘做急救分析。 */
export function openDiskUtilityFirstAid(imagePath: string): void {
  pendingFirstAidImagePath = imagePath
  try {
    osOpenApp('disk-utility')
  } catch {
    // 系统尚未挂载 openApp（极少见）；仍保留 pending，磁盘工具打开后会 take
  }
  window.dispatchEvent(new CustomEvent(OPEN_DISK_UTILITY_FIRST_AID_EVENT, { detail: imagePath }))
}

/** DiskUtilityApp 挂载 effect 里取走待处理的急救请求；没有则 undefined。 */
export function takeDiskUtilityFirstAidRequest(): string | undefined {
  const next = pendingFirstAidImagePath
  pendingFirstAidImagePath = undefined
  return next
}

/** 应用已打开时通过事件接收请求（与 take 殊途同归：都清掉 pending）。 */
export function subscribeDiskUtilityFirstAidRequest(
  handler: (imagePath: string) => void,
): () => void {
  const onEvent = (event: Event) => {
    const detail = (event as CustomEvent<string>).detail
    if (!detail) return
    pendingFirstAidImagePath = undefined
    handler(detail)
  }
  window.addEventListener(OPEN_DISK_UTILITY_FIRST_AID_EVENT, onEvent)
  return () => window.removeEventListener(OPEN_DISK_UTILITY_FIRST_AID_EVENT, onEvent)
}
