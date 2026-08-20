export type MonacoDialogButton = {
  key: string
  label: string
  tone?: 'primary' | 'secondary' | 'danger'
}

export type MonacoDialogRequest = {
  title: string
  message: string
  detail?: string
  buttons: MonacoDialogButton[]
  /** 点遮罩 / Esc 时选用的按钮 key；缺省视为取消 */
  dismissKey?: string
}

type PendingDialog = {
  request: MonacoDialogRequest
  resolve: (buttonKey: string) => void
}

const queue: PendingDialog[] = []
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function getPendingMonacoDialog(): MonacoDialogRequest | undefined {
  return queue[0]?.request
}

export function subscribeMonacoDialog(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 弹出 OS 风格确认；可排队，按 FIFO 展示。 */
export function requestMonacoDialog(request: MonacoDialogRequest): Promise<string> {
  return new Promise<string>((resolve) => {
    queue.push({
      request,
      resolve: (buttonKey) => {
        resolve(buttonKey)
      },
    })
    emit()
  })
}

export function resolveMonacoDialog(buttonKey: string): void {
  const current = queue.shift()
  if (!current) return
  current.resolve(buttonKey)
  emit()
}
