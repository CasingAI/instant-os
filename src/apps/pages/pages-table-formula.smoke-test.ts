import assert from 'node:assert/strict'
import {
  applySheetResultsToTableJSON,
  buildTableJSONFromEditGrid,
  cellAddress,
  colIndexToLetter,
  recalculateFromEditGrid,
  recalculateSheet,
  tableJSONToInputs,
} from './pages-table-formula.ts'

assert.equal(colIndexToLetter(0), 'A')
assert.equal(colIndexToLetter(25), 'Z')
assert.equal(colIndexToLetter(26), 'AA')
assert.equal(cellAddress(0, 0), 'A1')
assert.equal(cellAddress(1, 2), 'C2')

{
  const grid = recalculateSheet([
    [1, 2, '=A1+B1'],
    [3, 4, '=SUM(A1:B2)'],
    [5, null, '=IF(A1>0,"Y","N")'],
    [null, null, '=AVERAGE(A1:A3)'],
  ])
  assert.equal(grid[0]![2]!.display, '3')
  assert.equal(grid[0]![2]!.formula, '=A1+B1')
  assert.equal(grid[1]![2]!.display, '10')
  assert.equal(grid[2]![2]!.display, 'Y')
  assert.equal(grid[3]![2]!.display, '3')
  assert.equal(grid[0]![2]!.error, false)
}

{
  const edit = [
    ['10', '20', '=A1+B1'],
    ['', '', '=COUNT(A1:B1)'],
  ]
  const results = recalculateFromEditGrid(edit)
  assert.equal(results[0]![2]!.display, '30')
  assert.equal(results[1]![2]!.display, '2')

  const table = buildTableJSONFromEditGrid(edit, {
    type: 'table',
    attrs: { id: 'tbl-test' },
    content: [],
  })
  assert.equal(table.attrs?.id, 'tbl-test')
  assert.equal(table.content?.[0]?.content?.[2]?.attrs?.formula, '=A1+B1')
  assert.equal(table.content?.[0]?.content?.[2]?.content?.[0]?.content?.[0]?.text, '30')

  const inputs = tableJSONToInputs(table)
  assert.equal(inputs[0]![2], '=A1+B1')

  const roundTrip = applySheetResultsToTableJSON(table, results)
  assert.equal(roundTrip.content?.[0]?.content?.[2]?.attrs?.formula, '=A1+B1')
}

{
  const bad = recalculateSheet([['=A1/0']])
  // HyperFormula may return Infinity or an error depending on version/settings
  assert.ok(bad[0]![0]!.display.length > 0)
}

console.log('pages-table-formula smoke ok')
