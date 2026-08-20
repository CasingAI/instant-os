export type DockDropTarget = {
  overDock: boolean
  insertIndex: number
}

export function resolveDockDropTarget(clientX: number, clientY: number): DockDropTarget {
  const dock = document.querySelector('.dock')
  if (!dock || !(dock instanceof HTMLElement) || dock.classList.contains('dock--hidden')) {
    return { overDock: false, insertIndex: 0 }
  }

  const dockRect = dock.getBoundingClientRect()
  if (clientY < dockRect.top || clientY > dockRect.bottom) {
    return { overDock: false, insertIndex: 0 }
  }

  const plate = dock.querySelector('.dock__plate')
  if (!plate || !(plate instanceof HTMLElement)) {
    return { overDock: false, insertIndex: 0 }
  }

  const plateRect = plate.getBoundingClientRect()
  if (clientX < plateRect.left || clientX > plateRect.right) {
    return { overDock: false, insertIndex: 0 }
  }

  const pinnedZone = plate.querySelector('.dock__pinned-zone')
  const pinnedItems = (
    pinnedZone
      ? [...pinnedZone.querySelectorAll('.dock__pin-slot')]
      : [...plate.querySelectorAll('.dock__pin-slot')]
  ).filter((item): item is HTMLElement => {
    if (!(item instanceof HTMLElement)) {
      return false
    }
    // 拖拽中整槽已从 DOM 移除；若仍残留则忽略含 dragging 图标的槽
    return !item.querySelector('.dock__item--dragging')
  })

  if (pinnedItems.length === 0) {
    return { overDock: true, insertIndex: 0 }
  }

  let insertIndex = pinnedItems.length
  for (let index = 0; index < pinnedItems.length; index += 1) {
    const item = pinnedItems[index]
    if (!(item instanceof HTMLElement)) {
      continue
    }

    const rect = item.getBoundingClientRect()
    const midX = rect.left + rect.width / 2
    if (clientX < midX) {
      insertIndex = index
      break
    }
  }

  const divider = plate.querySelector('.dock__divider')
  if (divider instanceof HTMLElement) {
    const dividerRect = divider.getBoundingClientRect()
    if (clientX >= dividerRect.left) {
      insertIndex = pinnedItems.length
    }
  }

  return { overDock: true, insertIndex }
}
