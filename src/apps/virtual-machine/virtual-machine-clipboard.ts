/**
 * 虚拟机剪贴板双向同步的决策逻辑（纯函数，无 DOM 依赖）。
 *
 * 两个方向的防环都以「来源指纹」判断：
 * - 宿主剪贴板轮询发现变化：与最近一次「客机送来的文本」相同 → 是客机文本
 *   落地的回声，不回推；否则视为用户在宿主复制 → 推给客机。
 * - 客机送来文本：写入宿主剪贴板，并把它同时记为「宿主已见」，
 *   下一轮宿主轮询就不会把它当新变化。
 * XP 桥自身的 lastSelfText 拦截了大部分回环，这里是宿主侧第二道防线
 * （应对写宿主剪贴板失败、宿主侧其他写入者等场景）。
 *
 * 空文本两个方向都不参与同步（与客机桥「空文本：不覆盖剪贴板」、VMware
 * 等远程桌面的惯例一致）：宿主剪贴板是图片/富文本时 readText() 返回 ""，
 * 不该清掉客机文本；客机剪贴板变空也不清掉宿主文本，两侧各自保留上次内容。
 */

export type VmClipboardSyncState = {
  /** 最近一次客机送来的文本（回声判定基准）。 */
  lastReceivedFromGuest: string | null
  /** 最近一次宿主剪贴板轮询见到的文本（变化检测基准）。 */
  lastSeenHostText: string | null
}

export function createVmClipboardSyncState(): VmClipboardSyncState {
  return { lastReceivedFromGuest: null, lastSeenHostText: null }
}

/**
 * 换行归一（宿主→客机）：宿主剪贴板是裸 \n（macOS/浏览器惯例），XP 程序
 * （记事本等）只认 \r\n——推给客机前统一转 CRLF（\r\n 保留原样，孤立
 * \r/\n 都补成 \r\n）。幂等：客机桥自己也转，两侧叠加结果一致。必须在
 * onHostClipboardChanged 之后调用：lastSeenHostText 要记宿主剪贴板的原文，
 * 否则下一轮轮询会把归一差异当成新变化，无限回推。
 */
export function normalizeHostClipboardTextForGuest(text: string): string {
  return text.replace(/\r\n|\r|\n/g, '\r\n')
}

/**
 * 换行归一（客机→宿主）：客机（Windows）文本是 \r\n，写进宿主剪贴板前
 * 归一成 \n，防终端/编辑器里出现 ^M。必须在 onGuestClipboardReceived 之前
 * 调用：防环指纹要与实际写入宿主剪贴板的内容一致，否则回环判定失配。
 */
export function normalizeGuestClipboardText(text: string): string {
  return text.replace(/\r\n/g, '\n')
}

/**
 * 宿主剪贴板轮询 tick。返回应推给客机的文本（无变化 / 是回声时返回 null）。
 */
export function onHostClipboardChanged(
  state: VmClipboardSyncState,
  hostText: string,
): string | null {
  if (hostText === state.lastSeenHostText) {
    return null
  }
  state.lastSeenHostText = hostText
  // 空文本仍记为「已见」，只是不推送——否则图片剪贴板每次轮询都白走一遍。
  if (hostText === '') {
    return null
  }
  if (hostText === state.lastReceivedFromGuest) {
    return null
  }
  return hostText
}

/**
 * 客机剪贴板文本到达。返回应写入宿主剪贴板的文本（重复时返回 null）。
 * 写入动作本身由调用方做（需要浏览器 Clipboard API）。
 */
export function onGuestClipboardReceived(
  state: VmClipboardSyncState,
  guestText: string,
): string | null {
  // 空文本直接忽略且不记指纹：宿主剪贴板并未被写入，保持原指纹，
  // 下一轮轮询读到真实内容时靠「与 lastSeenHostText 相同」自然拦截。
  if (guestText === '') {
    return null
  }
  if (guestText === state.lastReceivedFromGuest) {
    return null
  }
  state.lastReceivedFromGuest = guestText
  // 客机文本即将落进宿主剪贴板：先记为已见，避免下一轮轮询当成宿主新变化。
  state.lastSeenHostText = guestText
  return guestText
}
