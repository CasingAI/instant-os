/** 「在文件中显示」等跨应用定位请求：带 nonce，可重复触发同一路径 */

type FilesRevealRequest = {
  path: string
  nonce: number
}

let pending: FilesRevealRequest | undefined
let nonceSeq = 0
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function requestFilesReveal(path: string): void {
  const trimmed = path.trim()
  if (!trimmed) return
  nonceSeq += 1
  pending = { path: trimmed, nonce: nonceSeq }
  emit()
}

export function takeFilesRevealRequest(): FilesRevealRequest | undefined {
  const current = pending
  pending = undefined
  if (current) emit()
  return current
}

export function subscribeFilesRevealRequests(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
