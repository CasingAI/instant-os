const snapshots = new Map<string, HTMLElement>()

export function captureFlip3dWindowSnapshot(windowId: string): HTMLElement | undefined {
  const frames = document.querySelectorAll('[data-flip3d-window]')
  let frame: Element | undefined
  for (const node of frames) {
    if (node.getAttribute('data-flip3d-window') === windowId) {
      frame = node
      break
    }
  }
  if (!(frame instanceof HTMLElement)) {
    return undefined
  }
  const source =
    frame.querySelector('.window-frame__chrome') ??
    frame.querySelector('.windowless-app-host__chrome') ??
    frame
  const clone = source.cloneNode(true) as HTMLElement
  clone.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'))
  for (const iframe of clone.querySelectorAll('iframe')) {
    iframe.src = 'about:blank'
  }
  return clone
}

export function storeFlip3dGhostSnapshot(ghostId: string, snapshot: HTMLElement): void {
  snapshots.set(ghostId, snapshot)
}

export function peekFlip3dGhostSnapshot(ghostId: string): HTMLElement | undefined {
  return snapshots.get(ghostId)
}

export function takeFlip3dGhostSnapshot(ghostId: string): HTMLElement | undefined {
  const snapshot = snapshots.get(ghostId)
  snapshots.delete(ghostId)
  return snapshot
}

export function clearFlip3dGhostSnapshots(): void {
  snapshots.clear()
}
