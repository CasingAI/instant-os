/**
 * TreeView 纯逻辑模型：可见展平 / 父级映射（键盘导航的基础）。
 * 运行：node --experimental-strip-types src/ui/tree-view.test.ts
 */
import assert from 'node:assert/strict'
import {
  buildTreeParentMap,
  collectTreeIds,
  findRemovalNeighbor,
  flattenVisibleTree,
} from './tree-view-model.ts'

type Node = { id: string; children?: Node[] }

const tree: Node[] = [
  {
    id: 'a',
    children: [
      { id: 'a1', children: [{ id: 'a1i' }, { id: 'a1j' }] },
      { id: 'a2' },
    ],
  },
  { id: 'b', children: [{ id: 'b1' }] },
  { id: 'c' },
]

function ids(nodes: Node[]): string[] {
  return nodes.map((node) => node.id)
}

{
  // 全折叠：只显示根
  assert.deepEqual(ids(flattenVisibleTree(tree, new Set())), ['a', 'b', 'c'])
}

{
  // 展开 a 与 b：子节点进入序列
  assert.deepEqual(ids(flattenVisibleTree(tree, new Set(['a', 'b']))), ['a', 'a1', 'a2', 'b', 'b1', 'c'])
}

{
  // 深层展开：深度优先按显示顺序
  assert.deepEqual(ids(flattenVisibleTree(tree, new Set(['a', 'a1', 'b']))), [
    'a',
    'a1',
    'a1i',
    'a1j',
    'a2',
    'b',
    'b1',
    'c',
  ])
}

{
  // 叶节点带展开 id 无效
  assert.deepEqual(ids(flattenVisibleTree(tree, new Set(['c', 'a1i']))), ['a', 'b', 'c'])
}

{
  // 空树
  assert.deepEqual(flattenVisibleTree([], new Set(['x'])), [])
}

{
  // 父级映射：← 键从子级回父级的基础
  const parents = buildTreeParentMap(tree)
  assert.equal(parents.get('a1')?.id, 'a')
  assert.equal(parents.get('a1i')?.id, 'a1')
  assert.equal(parents.get('b1')?.id, 'b')
  assert.equal(parents.has('c'), false) // 根节点无父
  assert.equal(parents.size, 5)
}

{
  // 全集 id 收集：深度优先、不看展开态（插入/删除动画 diff 用）
  assert.deepEqual(collectTreeIds(tree), ['a', 'a1', 'a1i', 'a1j', 'a2', 'b', 'b1', 'c'])
  assert.deepEqual(collectTreeIds([]), [])
}

// ── findRemovalNeighbor：删除选中行后的自动补选 ──
// 全展开可见序：a → a1 → a1i → a1j → a2 → b → b1 → c
const expanded = new Set(['a', 'a1', 'b'])
const parentMap = buildTreeParentMap(tree)

function neighborOf(
  removedIds: string[],
  selectedId: string,
  preference: 'prefer-previous' | 'prefer-next',
  expandedIds: ReadonlySet<string> = expanded,
): string | undefined {
  const removed = new Set(removedIds)
  const survivors = new Set(collectTreeIds(tree).filter((id) => !removed.has(id)))
  return findRemovalNeighbor(
    flattenVisibleTree(tree, expandedIds),
    parentMap,
    selectedId,
    survivors,
    preference,
  )?.id
}

{
  // prefer-next：删 a1 子树（a1/a1i/a1j 消失）→ 选中可见序下一行 a2
  assert.equal(neighborOf(['a1', 'a1i', 'a1j'], 'a1', 'prefer-next'), 'a2')
}

{
  // prefer-previous：同一删除 → 选中上一行 a
  assert.equal(neighborOf(['a1', 'a1i', 'a1j'], 'a1', 'prefer-previous'), 'a')
}

{
  // prefer-next 到底反向兜底：删末行 c → 回到 b1
  assert.equal(neighborOf(['c'], 'c', 'prefer-next'), 'b1')
}

{
  // prefer-previous 到底反向兜底：删首行 a 整棵子树 → 前进到 b
  assert.equal(neighborOf(['a', 'a1', 'a1i', 'a1j', 'a2'], 'a', 'prefer-previous'), 'b')
}

{
  // 锚点上溯：选中项 a1i 藏在被删的折叠分支里（上一轮只展开 b，a1i 不可见），
  // 沿父链找到首个「已删且此前可见」的祖先 a，再按可见序补选
  assert.equal(neighborOf(['a', 'a1', 'a1i', 'a1j', 'a2'], 'a1i', 'prefer-next', new Set(['b'])), 'b')
}

{
  // 同批多删：a1 子树与 a2 一起删，prefer-next 连跳多个已删行落到 b
  assert.equal(neighborOf(['a1', 'a1i', 'a1j', 'a2'], 'a1', 'prefer-next'), 'b')
}

{
  // 整树删空：无幸存行返回 undefined（组件侧不回调 onSelect）
  const survivors = new Set<string>()
  assert.equal(
    findRemovalNeighbor(flattenVisibleTree(tree, expanded), parentMap, 'c', survivors, 'prefer-next'),
    undefined,
  )
}

{
  // 选中节点未被删：不动声色返回 undefined
  assert.equal(neighborOf(['c'], 'b', 'prefer-next'), undefined)
}

console.log('tree-view.test.ts ok')