/**
 * List 索引条纯逻辑：标签派生、排序键、字母分组、逆序判定。
 * 运行：node --experimental-strip-types src/ui/list-index.test.ts
 */
import assert from 'node:assert/strict'
import {
  compareIndexLabelRank,
  deriveIndexLabel,
  groupByIndexLetter,
  indexSortKey,
} from './list-index.ts'

// 标签派生：ASCII 字母 / 汉字拼音 / 数字符号 → #，与排序键同源。
{
  assert.equal(deriveIndexLabel('阿福'), 'A')
  assert.equal(deriveIndexLabel('Olivia'), 'O')
  assert.equal(deriveIndexLabel('iphone 配件'), 'I')
  assert.equal(deriveIndexLabel('重庆'), 'C', '短语词典消歧多音字')
  assert.equal(deriveIndexLabel('3M 耳机'), '#', '数字开头沉 #')
  assert.equal(deriveIndexLabel('！！！'), '#')
  assert.equal(deriveIndexLabel('   '), '#', '空白视为空')
  assert.equal(deriveIndexLabel(''), '#')
}

// 排序键：全拼连写 + 非 zh 原字符小写；缓存后结果一致。
{
  assert.equal(indexSortKey('李白'), 'libai')
  assert.equal(indexSortKey('重庆'), 'chongqing')
  assert.equal(indexSortKey('3M 耳机'), '3m erji')
  assert.equal(indexSortKey('  阿福  '), 'afu', '首尾空白不影响')
  assert.equal(indexSortKey(''), '')
  assert.equal(indexSortKey('阿福'), indexSortKey('阿福'), '缓存路径返回一致')
}

// 默认词典对姓氏读音不可靠，surname 模式修正；普通词不能默认开姓氏模式。
{
  assert.equal(deriveIndexLabel('曾小明'), 'C', '默认词典：曾读 céng')
  assert.equal(deriveIndexLabel('曾小明', { surname: true }), 'Z')
  assert.equal(deriveIndexLabel('仇英', { surname: true }), 'Q')
  assert.equal(deriveIndexLabel('单雄信', { surname: true }), 'S')
  assert.equal(indexSortKey('曾小明', { surname: true }), 'zengxiaoming')
  assert.equal(
    indexSortKey('曾经沧海', { surname: true }),
    'zengjingcanghai',
    '姓氏模式误伤普通词——这正是它必须显式开启的原因',
  )
}

// 分组：字母升序、# 沉底、组内按排序键、同键保序（稳定）。
{
  const items = [
    { name: '张良' },
    { name: 'olivia' },
    { name: '阿福' },
    { name: '敖丙' },
    { name: '安琪' },
    { name: '3M' },
    { name: '李白' },
  ]
  const groups = groupByIndexLetter(items, (it) => it.name)
  assert.deepEqual(
    groups.map((g) => [g.label, g.items.map((it) => it.name)]),
    [
      ['A', ['阿福', '安琪', '敖丙']],
      ['L', ['李白']],
      ['O', ['olivia']],
      ['Z', ['张良']],
      ['#', ['3M']],
    ],
    'A 组内 afu<anqi<aobing；# 沉底',
  )
}

// 分组姓氏模式：曾归 Z 而不是 C。
{
  const names = ['曾小明', '张良', '曹操']
  const groups = groupByIndexLetter(names, (n) => n, { surname: true })
  assert.deepEqual(
    groups.map((g) => [g.label, g.items]),
    [
      ['C', ['曹操']],
      ['Z', ['曾小明', '张良']],
    ],
  )
}

// 空输入 → 空分组。
{
  assert.deepEqual(groupByIndexLetter([], (n) => n), [])
}

// 逆序判定：仅对 /[A-Z#]/ 单字符判定，自定义标签返回 null 不判。
{
  assert.equal(compareIndexLabelRank('A', 'B'), -1)
  assert.equal(compareIndexLabelRank('B', 'B'), 0)
  assert.ok(compareIndexLabelRank('C', 'A')! > 0, '逆序')
  assert.ok(compareIndexLabelRank('Y', '#')! < 0, '# 秩 27 沉底')
  assert.ok(compareIndexLabelRank('#', 'A')! > 0)
  assert.equal(compareIndexLabelRank('水', 'A'), null, '非单字符标签不判定')
  assert.equal(compareIndexLabelRank('A', '水果'), null)
  assert.equal(compareIndexLabelRank('AB', 'B'), null, '多字符标签不判定')
}

console.log('list-index: ok')
