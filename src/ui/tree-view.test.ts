/**
 * TreeView 纯逻辑模型：可见展平 / 父级映射（键盘导航的基础）。
 * 运行：node --experimental-strip-types src/ui/tree-view.test.ts
 */
import assert from 'node:assert/strict'
import { buildTreeParentMap, flattenVisibleTree } from './tree-view-model.ts'

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

console.log('tree-view.test.ts ok')