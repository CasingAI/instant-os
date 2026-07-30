/** Virtual Studio Code Desktop 编辑器组分屏布局（二叉树，可嵌套成多格） */

export type VscodeSplitDirection = 'horizontal' | 'vertical'

export type VscodeSplitEdge = 'left' | 'right' | 'top' | 'bottom'

export type VscodeGroupItem =
  | { kind: 'file'; id: string; tabId: string }
  | { kind: 'preview'; id: string; sourcePath: string }
  | { kind: 'searchEditor'; id: string; sessionId: string }
  | { kind: 'aiChat'; id: string; sessionId: string }
  | { kind: 'subagentDetail'; id: string; runId: string }
  | { kind: 'welcome'; id: string }

export type VscodeEditorGroupState = {
  id: string
  items: VscodeGroupItem[]
  activeItemId: string | undefined
}

export type VscodeLayoutNode =
  | { type: 'leaf'; groupId: string }
  | {
      type: 'branch'
      id: string
      direction: VscodeSplitDirection
      children: [VscodeLayoutNode, VscodeLayoutNode]
      /** 第一个子节点占比 0.15–0.85 */
      ratio: number
    }

export type VscodeEditorLayoutState = {
  root: VscodeLayoutNode
  groups: Record<string, VscodeEditorGroupState>
  focusedGroupId: string
}

export type VscodeEditorDragPayload = {
  itemId: string
  fromGroupId: string
}

export const VSCODE_EDITOR_DRAG_MIME = 'application/x-vscode-editor-item'

/** 拖拽进行中的载荷；避免依赖 text/plain（会落入 Monaco 正文），并补齐 dragover 期间 getData 不可用的问题 */
let activeEditorDrag: VscodeEditorDragPayload | undefined

export function getActiveEditorDrag(): VscodeEditorDragPayload | undefined {
  return activeEditorDrag
}

export function setActiveEditorDrag(payload: VscodeEditorDragPayload | undefined): void {
  activeEditorDrag = payload
}

let groupSeq = 0
let branchSeq = 0
let previewSeq = 0

export function createVscodeGroupId(): string {
  groupSeq += 1
  return `vscode-group-${groupSeq}`
}

function createBranchId(): string {
  branchSeq += 1
  return `vscode-branch-${branchSeq}`
}

export function createVscodePreviewId(): string {
  previewSeq += 1
  return `vscode-preview-${previewSeq}`
}

function clampRatio(ratio: number): number {
  return Math.min(0.85, Math.max(0.15, ratio))
}

export function createEmptyEditorLayout(): VscodeEditorLayoutState {
  const groupId = createVscodeGroupId()
  return {
    root: { type: 'leaf', groupId },
    groups: {
      [groupId]: { id: groupId, items: [], activeItemId: undefined },
    },
    focusedGroupId: groupId,
  }
}

export function createEditorLayoutWithTabs(
  tabIds: readonly string[],
  activeTabId?: string,
): VscodeEditorLayoutState {
  const groupId = createVscodeGroupId()
  const items: VscodeGroupItem[] = tabIds.map((tabId) => ({
    kind: 'file',
    id: tabId,
    tabId,
  }))
  const activeItemId =
    activeTabId && tabIds.includes(activeTabId) ? activeTabId : items[0]?.id
  return {
    root: { type: 'leaf', groupId },
    groups: {
      [groupId]: { id: groupId, items, activeItemId },
    },
    focusedGroupId: groupId,
  }
}

export function listLayoutGroupIds(node: VscodeLayoutNode): string[] {
  if (node.type === 'leaf') return [node.groupId]
  return [...listLayoutGroupIds(node.children[0]), ...listLayoutGroupIds(node.children[1])]
}

export function countLayoutLeaves(node: VscodeLayoutNode): number {
  if (node.type === 'leaf') return 1
  return countLayoutLeaves(node.children[0]) + countLayoutLeaves(node.children[1])
}

export function findGroupIdForItem(
  layout: VscodeEditorLayoutState,
  itemId: string,
): string | undefined {
  for (const group of Object.values(layout.groups)) {
    if (group.items.some((item) => item.id === itemId)) return group.id
  }
  return undefined
}

export function findGroupIdForTab(
  layout: VscodeEditorLayoutState,
  tabId: string,
): string | undefined {
  for (const group of Object.values(layout.groups)) {
    if (group.items.some((item) => item.kind === 'file' && item.tabId === tabId)) {
      return group.id
    }
  }
  return undefined
}

export function findPreviewForPath(
  layout: VscodeEditorLayoutState,
  sourcePath: string,
): { groupId: string; item: Extract<VscodeGroupItem, { kind: 'preview' }> } | undefined {
  for (const group of Object.values(layout.groups)) {
    const item = group.items.find(
      (entry): entry is Extract<VscodeGroupItem, { kind: 'preview' }> =>
        entry.kind === 'preview' && entry.sourcePath === sourcePath,
    )
    if (item) return { groupId: group.id, item }
  }
  return undefined
}

export function getGroupActiveItem(
  group: VscodeEditorGroupState | undefined,
): VscodeGroupItem | undefined {
  if (!group) return undefined
  return group.items.find((item) => item.id === group.activeItemId) ?? group.items[0]
}

/** 聚焦组当前应关联的文件 tab（预览则回源文件） */
export function getFocusedFileTabId(layout: VscodeEditorLayoutState): string | undefined {
  const group = layout.groups[layout.focusedGroupId]
  const item = getGroupActiveItem(group)
  if (!item) return undefined
  if (item.kind === 'file') return item.tabId
  return undefined
}

export function getFocusedCloseTarget(
  layout: VscodeEditorLayoutState,
):
  | { kind: 'file'; tabId: string }
  | { kind: 'preview'; itemId: string }
  | { kind: 'searchEditor'; itemId: string }
  | { kind: 'aiChat'; itemId: string }
  | { kind: 'subagentDetail'; itemId: string }
  | { kind: 'welcome'; itemId: string }
  | undefined {
  const group = layout.groups[layout.focusedGroupId]
  const item = getGroupActiveItem(group)
  if (!item) return undefined
  if (item.kind === 'file') return { kind: 'file', tabId: item.tabId }
  if (item.kind === 'searchEditor') return { kind: 'searchEditor', itemId: item.id }
  if (item.kind === 'aiChat') return { kind: 'aiChat', itemId: item.id }
  if (item.kind === 'subagentDetail') return { kind: 'subagentDetail', itemId: item.id }
  if (item.kind === 'welcome') return { kind: 'welcome', itemId: item.id }
  return { kind: 'preview', itemId: item.id }
}

/** 同组内除 keepItemId 外的标签数（用于「关闭其他」是否可用） */
export function countOtherItemsInGroup(
  layout: VscodeEditorLayoutState,
  groupId: string,
  keepItemId: string,
): number {
  const group = layout.groups[groupId]
  if (!group) return 0
  return group.items.filter((item) => item.id !== keepItemId).length
}

function replaceLeaf(
  node: VscodeLayoutNode,
  groupId: string,
  replacement: VscodeLayoutNode,
): VscodeLayoutNode {
  if (node.type === 'leaf') {
    return node.groupId === groupId ? replacement : node
  }
  return {
    ...node,
    children: [
      replaceLeaf(node.children[0], groupId, replacement),
      replaceLeaf(node.children[1], groupId, replacement),
    ],
  }
}

function removeLeaf(node: VscodeLayoutNode, groupId: string): VscodeLayoutNode | undefined {
  if (node.type === 'leaf') {
    return node.groupId === groupId ? undefined : node
  }
  const left = removeLeaf(node.children[0], groupId)
  const right = removeLeaf(node.children[1], groupId)
  if (!left && !right) return undefined
  if (!left) return right
  if (!right) return left
  return { ...node, children: [left, right] }
}

function pruneUnusedGroups(layout: VscodeEditorLayoutState): VscodeEditorLayoutState {
  const liveIds = new Set(listLayoutGroupIds(layout.root))
  const groups: Record<string, VscodeEditorGroupState> = {}
  for (const id of liveIds) {
    const group = layout.groups[id]
    if (group) groups[id] = group
  }
  let focusedGroupId = layout.focusedGroupId
  if (!groups[focusedGroupId]) {
    focusedGroupId = liveIds.values().next().value ?? createVscodeGroupId()
    if (!groups[focusedGroupId]) {
      const fallback = createEmptyEditorLayout()
      return fallback
    }
  }
  return { ...layout, groups, focusedGroupId }
}

function withGroupActive(
  group: VscodeEditorGroupState,
  preferredId?: string,
): VscodeEditorGroupState {
  if (group.items.length === 0) {
    return { ...group, activeItemId: undefined }
  }
  if (preferredId && group.items.some((item) => item.id === preferredId)) {
    return { ...group, activeItemId: preferredId }
  }
  if (group.activeItemId && group.items.some((item) => item.id === group.activeItemId)) {
    return group
  }
  return { ...group, activeItemId: group.items[0]?.id }
}

function takeItem(
  layout: VscodeEditorLayoutState,
  itemId: string,
): { layout: VscodeEditorLayoutState; item: VscodeGroupItem } | undefined {
  const fromGroupId = findGroupIdForItem(layout, itemId)
  if (!fromGroupId) return undefined
  const fromGroup = layout.groups[fromGroupId]
  if (!fromGroup) return undefined
  const item = fromGroup.items.find((entry) => entry.id === itemId)
  if (!item) return undefined

  const nextItems = fromGroup.items.filter((entry) => entry.id !== itemId)
  let nextLayout: VscodeEditorLayoutState = {
    ...layout,
    groups: {
      ...layout.groups,
      [fromGroupId]: withGroupActive(
        { ...fromGroup, items: nextItems },
        fromGroup.activeItemId === itemId ? undefined : fromGroup.activeItemId,
      ),
    },
  }

  if (nextItems.length === 0) {
    const nextRoot = removeLeaf(nextLayout.root, fromGroupId)
    if (!nextRoot) {
      const empty = createEmptyEditorLayout()
      return { layout: empty, item }
    }
    nextLayout = pruneUnusedGroups({ ...nextLayout, root: nextRoot })
  }

  return { layout: nextLayout, item }
}

export function focusEditorItem(
  layout: VscodeEditorLayoutState,
  groupId: string,
  itemId: string,
): VscodeEditorLayoutState {
  const group = layout.groups[groupId]
  if (!group || !group.items.some((item) => item.id === itemId)) return layout
  if (layout.focusedGroupId === groupId && group.activeItemId === itemId) return layout
  return {
    ...layout,
    focusedGroupId: groupId,
    groups: {
      ...layout.groups,
      [groupId]: { ...group, activeItemId: itemId },
    },
  }
}

export function focusEditorTab(
  layout: VscodeEditorLayoutState,
  tabId: string,
): VscodeEditorLayoutState {
  const groupId = findGroupIdForTab(layout, tabId)
  if (!groupId) return layout
  return focusEditorItem(layout, groupId, tabId)
}

export function focusEditorGroup(
  layout: VscodeEditorLayoutState,
  groupId: string,
): VscodeEditorLayoutState {
  if (!layout.groups[groupId]) return layout
  if (layout.focusedGroupId === groupId) return layout
  return { ...layout, focusedGroupId: groupId }
}

export function addFileTabToFocusedGroup(
  layout: VscodeEditorLayoutState,
  tabId: string,
): VscodeEditorLayoutState {
  const existingGroupId = findGroupIdForTab(layout, tabId)
  if (existingGroupId) {
    return focusEditorItem(layout, existingGroupId, tabId)
  }

  let focusedGroupId = layout.focusedGroupId
  let group = layout.groups[focusedGroupId]
  if (!group) {
    const fresh = createEmptyEditorLayout()
    focusedGroupId = fresh.focusedGroupId
    group = fresh.groups[focusedGroupId]!
    layout = fresh
  }

  const item: VscodeGroupItem = { kind: 'file', id: tabId, tabId }
  return {
    ...layout,
    focusedGroupId,
    groups: {
      ...layout.groups,
      [focusedGroupId]: {
        ...group,
        items: [...group.items, item],
        activeItemId: tabId,
      },
    },
  }
}

export function openSearchEditorInFocusedGroup(
  layout: VscodeEditorLayoutState,
  sessionId: string,
): VscodeEditorLayoutState {
  for (const group of Object.values(layout.groups)) {
    const existing = group.items.find(
      (item) => item.kind === 'searchEditor' && item.sessionId === sessionId,
    )
    if (existing) {
      return focusEditorItem(layout, group.id, existing.id)
    }
  }

  let focusedGroupId = layout.focusedGroupId
  let group = layout.groups[focusedGroupId]
  if (!group) {
    const fresh = createEmptyEditorLayout()
    focusedGroupId = fresh.focusedGroupId
    group = fresh.groups[focusedGroupId]!
    layout = fresh
  }

  const itemId = `search-editor-item-${sessionId}`
  const item: VscodeGroupItem = { kind: 'searchEditor', id: itemId, sessionId }
  return {
    ...layout,
    focusedGroupId,
    groups: {
      ...layout.groups,
      [focusedGroupId]: {
        ...group,
        items: [...group.items, item],
        activeItemId: itemId,
      },
    },
  }
}

export function findAiChatItem(
  layout: VscodeEditorLayoutState,
  sessionId: string,
): { groupId: string; item: Extract<VscodeGroupItem, { kind: 'aiChat' }> } | undefined {
  for (const group of Object.values(layout.groups)) {
    const item = group.items.find(
      (entry): entry is Extract<VscodeGroupItem, { kind: 'aiChat' }> =>
        entry.kind === 'aiChat' && entry.sessionId === sessionId,
    )
    if (item) return { groupId: group.id, item }
  }
  return undefined
}

export function openAiChatInFocusedGroup(
  layout: VscodeEditorLayoutState,
  sessionId: string,
): VscodeEditorLayoutState {
  const existing = findAiChatItem(layout, sessionId)
  if (existing) {
    return focusEditorItem(layout, existing.groupId, existing.item.id)
  }

  let focusedGroupId = layout.focusedGroupId
  let group = layout.groups[focusedGroupId]
  if (!group) {
    const fresh = createEmptyEditorLayout()
    focusedGroupId = fresh.focusedGroupId
    group = fresh.groups[focusedGroupId]!
    layout = fresh
  }

  const itemId = `ai-chat-item-${sessionId}`
  const item: VscodeGroupItem = { kind: 'aiChat', id: itemId, sessionId }
  return {
    ...layout,
    focusedGroupId,
    groups: {
      ...layout.groups,
      [focusedGroupId]: {
        ...group,
        items: [...group.items, item],
        activeItemId: itemId,
      },
    },
  }
}

export function findSubagentDetailItem(
  layout: VscodeEditorLayoutState,
  runId: string,
): { groupId: string; item: VscodeGroupItem & { kind: 'subagentDetail' } } | undefined {
  for (const group of Object.values(layout.groups)) {
    const item = group.items.find(
      (item): item is VscodeGroupItem & { kind: 'subagentDetail' } =>
        item.kind === 'subagentDetail' && item.runId === runId,
    )
    if (item) return { groupId: group.id, item }
  }
  return undefined
}

export function openSubagentDetailInFocusedGroup(
  layout: VscodeEditorLayoutState,
  runId: string,
): VscodeEditorLayoutState {
  const existing = findSubagentDetailItem(layout, runId)
  if (existing) {
    return focusEditorItem(layout, existing.groupId, existing.item.id)
  }

  let focusedGroupId = layout.focusedGroupId
  let group = layout.groups[focusedGroupId]
  if (!group) {
    const fresh = createEmptyEditorLayout()
    focusedGroupId = fresh.focusedGroupId
    group = fresh.groups[focusedGroupId]!
    layout = fresh
  }

  const itemId = `subagent-detail-${runId}`
  const item: VscodeGroupItem = { kind: 'subagentDetail', id: itemId, runId }
  return {
    ...layout,
    focusedGroupId,
    groups: {
      ...layout.groups,
      [focusedGroupId]: {
        ...group,
        items: [...group.items, item],
        activeItemId: itemId,
      },
    },
  }
}

export function removeFileTabFromLayout(
  layout: VscodeEditorLayoutState,
  tabId: string,
  sourcePath?: string,
): VscodeEditorLayoutState {
  let next = layout
  const groupId = findGroupIdForTab(next, tabId)
  if (groupId) {
    const taken = takeItem(next, tabId)
    if (taken) next = taken.layout
  }

  if (sourcePath) {
    const preview = findPreviewForPath(next, sourcePath)
    if (preview) {
      const taken = takeItem(next, preview.item.id)
      if (taken) next = taken.layout
    }
  }

  return next
}

export function removeEditorItem(
  layout: VscodeEditorLayoutState,
  itemId: string,
): VscodeEditorLayoutState {
  const taken = takeItem(layout, itemId)
  return taken ? taken.layout : layout
}

export function moveEditorItemToGroup(
  layout: VscodeEditorLayoutState,
  itemId: string,
  targetGroupId: string,
  targetIndex?: number,
): VscodeEditorLayoutState {
  if (!layout.groups[targetGroupId]) return layout
  const fromGroupId = findGroupIdForItem(layout, itemId)
  if (!fromGroupId) return layout

  if (fromGroupId === targetGroupId) {
    const group = layout.groups[targetGroupId]!
    const currentIndex = group.items.findIndex((item) => item.id === itemId)
    if (currentIndex < 0) return layout
    const item = group.items[currentIndex]!
    const without = group.items.filter((entry) => entry.id !== itemId)
    let insertAt = targetIndex ?? without.length
    if (currentIndex < insertAt) insertAt -= 1
    insertAt = Math.max(0, Math.min(without.length, insertAt))
    const nextItems = [...without.slice(0, insertAt), item, ...without.slice(insertAt)]
    return {
      ...layout,
      focusedGroupId: targetGroupId,
      groups: {
        ...layout.groups,
        [targetGroupId]: withGroupActive(
          { ...group, items: nextItems },
          itemId,
        ),
      },
    }
  }

  const taken = takeItem(layout, itemId)
  if (!taken) return layout
  let next = taken.layout
  const target = next.groups[targetGroupId]
  if (!target) {
    // 目标组在 take 后被折叠掉了（拖到自己且是唯一项的极端情况）
    return addItemAsNewSplit(layout, itemId, layout.focusedGroupId, 'right')
  }

  const insertAt = Math.max(0, Math.min(target.items.length, targetIndex ?? target.items.length))
  const nextItems = [
    ...target.items.slice(0, insertAt),
    taken.item,
    ...target.items.slice(insertAt),
  ]
  return {
    ...next,
    focusedGroupId: targetGroupId,
    groups: {
      ...next.groups,
      [targetGroupId]: withGroupActive({ ...target, items: nextItems }, taken.item.id),
    },
  }
}

function edgeToSplit(
  edge: VscodeSplitEdge,
): { direction: VscodeSplitDirection; placeNewFirst: boolean } {
  if (edge === 'left') return { direction: 'horizontal', placeNewFirst: true }
  if (edge === 'right') return { direction: 'horizontal', placeNewFirst: false }
  if (edge === 'top') return { direction: 'vertical', placeNewFirst: true }
  return { direction: 'vertical', placeNewFirst: false }
}

function addItemAsNewSplit(
  layout: VscodeEditorLayoutState,
  itemId: string,
  targetGroupId: string,
  edge: VscodeSplitEdge,
): VscodeEditorLayoutState {
  const taken = takeItem(layout, itemId)
  if (!taken) return layout
  let next = taken.layout

  // 若 take 后目标组消失，挂到当前任意存活组
  let anchorId = targetGroupId
  if (!next.groups[anchorId]) {
    anchorId = next.focusedGroupId
  }
  if (!next.groups[anchorId]) {
    const freshId = createVscodeGroupId()
    next = {
      root: { type: 'leaf', groupId: freshId },
      groups: {
        [freshId]: {
          id: freshId,
          items: [taken.item],
          activeItemId: taken.item.id,
        },
      },
      focusedGroupId: freshId,
    }
    return next
  }

  const newGroupId = createVscodeGroupId()
  const newGroup: VscodeEditorGroupState = {
    id: newGroupId,
    items: [taken.item],
    activeItemId: taken.item.id,
  }
  const { direction, placeNewFirst } = edgeToSplit(edge)
  const oldLeaf: VscodeLayoutNode = { type: 'leaf', groupId: anchorId }
  const newLeaf: VscodeLayoutNode = { type: 'leaf', groupId: newGroupId }
  const branch: VscodeLayoutNode = {
    type: 'branch',
    id: createBranchId(),
    direction,
    ratio: 0.5,
    children: placeNewFirst ? [newLeaf, oldLeaf] : [oldLeaf, newLeaf],
  }

  return pruneUnusedGroups({
    ...next,
    root: replaceLeaf(next.root, anchorId, branch),
    focusedGroupId: newGroupId,
    groups: {
      ...next.groups,
      [newGroupId]: newGroup,
    },
  })
}

export function splitEditorWithItem(
  layout: VscodeEditorLayoutState,
  itemId: string,
  targetGroupId: string,
  edge: VscodeSplitEdge,
): VscodeEditorLayoutState {
  const fromGroupId = findGroupIdForItem(layout, itemId)
  if (!fromGroupId) return layout

  // 同组且仅一项：在目标边缘拆出空组再放该项 → 仍只有一项时无意义，改为对目标组拆分
  const fromGroup = layout.groups[fromGroupId]
  if (fromGroupId === targetGroupId && fromGroup && fromGroup.items.length <= 1) {
    return layout
  }

  return addItemAsNewSplit(layout, itemId, targetGroupId, edge)
}

/** 将聚焦组当前项拆到右侧 / 下方（复制视图：移动到新组） */
export function splitFocusedEditor(
  layout: VscodeEditorLayoutState,
  edge: 'right' | 'bottom',
): VscodeEditorLayoutState {
  const group = layout.groups[layout.focusedGroupId]
  const item = getGroupActiveItem(group)
  if (!item || !group || group.items.length <= 1) return layout
  return splitEditorWithItem(layout, item.id, layout.focusedGroupId, edge)
}

export function openMarkdownPreviewToSide(
  layout: VscodeEditorLayoutState,
  sourcePath: string,
  besideGroupId: string,
): VscodeEditorLayoutState {
  const existing = findPreviewForPath(layout, sourcePath)
  if (existing) {
    return focusEditorItem(layout, existing.groupId, existing.item.id)
  }

  const previewId = createVscodePreviewId()
  const item: VscodeGroupItem = { kind: 'preview', id: previewId, sourcePath }
  const anchorId = layout.groups[besideGroupId] ? besideGroupId : layout.focusedGroupId
  if (!layout.groups[anchorId]) {
    const fresh = createEmptyEditorLayout()
    const groupId = fresh.focusedGroupId
    return {
      ...fresh,
      groups: {
        [groupId]: {
          id: groupId,
          items: [item],
          activeItemId: previewId,
        },
      },
    }
  }

  const newGroupId = createVscodeGroupId()
  const newGroup: VscodeEditorGroupState = {
    id: newGroupId,
    items: [item],
    activeItemId: previewId,
  }
  const oldLeaf: VscodeLayoutNode = { type: 'leaf', groupId: anchorId }
  const newLeaf: VscodeLayoutNode = { type: 'leaf', groupId: newGroupId }
  const branch: VscodeLayoutNode = {
    type: 'branch',
    id: createBranchId(),
    direction: 'horizontal',
    ratio: 0.5,
    children: [oldLeaf, newLeaf],
  }

  return {
    ...layout,
    root: replaceLeaf(layout.root, anchorId, branch),
    focusedGroupId: newGroupId,
    groups: {
      ...layout.groups,
      [newGroupId]: newGroup,
    },
  }
}

export function setBranchRatio(
  layout: VscodeEditorLayoutState,
  branchId: string,
  ratio: number,
): VscodeEditorLayoutState {
  const nextRatio = clampRatio(ratio)

  const mapNode = (node: VscodeLayoutNode): VscodeLayoutNode => {
    if (node.type === 'leaf') return node
    if (node.id === branchId) {
      return { ...node, ratio: nextRatio }
    }
    return {
      ...node,
      children: [mapNode(node.children[0]), mapNode(node.children[1])],
    }
  }

  return { ...layout, root: mapNode(layout.root) }
}

export function layoutHasItems(layout: VscodeEditorLayoutState): boolean {
  return Object.values(layout.groups).some((group) => group.items.length > 0)
}

export function openWelcomeInFocusedGroup(
  layout: VscodeEditorLayoutState,
): VscodeEditorLayoutState {
  // 检查是否已经存在欢迎tab
  for (const group of Object.values(layout.groups)) {
    const existing = group.items.find((item) => item.kind === 'welcome')
    if (existing) {
      return focusEditorItem(layout, group.id, existing.id)
    }
  }

  let focusedGroupId = layout.focusedGroupId
  let group = layout.groups[focusedGroupId]
  if (!group) {
    const fresh = createEmptyEditorLayout()
    focusedGroupId = fresh.focusedGroupId
    group = fresh.groups[focusedGroupId]!
    layout = fresh
  }

  const itemId = 'welcome-tab'
  const item: VscodeGroupItem = { kind: 'welcome', id: itemId }
  return {
    ...layout,
    focusedGroupId,
    groups: {
      ...layout.groups,
      [focusedGroupId]: {
        ...group,
        items: [...group.items, item],
        activeItemId: itemId,
      },
    },
  }
}

export function removeWelcomeFromLayout(
  layout: VscodeEditorLayoutState,
): VscodeEditorLayoutState {
  let changed = false
  const nextGroups = { ...layout.groups }
  for (const group of Object.values(nextGroups)) {
    const welcomeIndex = group.items.findIndex((item) => item.kind === 'welcome')
    if (welcomeIndex !== -1) {
      changed = true
      const nextItems = [...group.items]
      nextItems.splice(welcomeIndex, 1)
      nextGroups[group.id] = {
        ...group,
        items: nextItems,
        activeItemId: group.activeItemId === 'welcome-tab'
          ? nextItems[nextItems.length - 1]?.id
          : group.activeItemId,
      }
    }
  }
  return changed ? { ...layout, groups: nextGroups } : layout
}
