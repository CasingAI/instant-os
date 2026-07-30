/**
 * 终端 / npm 工具结果 spill 单测。
 * 运行：pnpm test:vscode-ai-spill
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { isAgentToolStructuredResult } from '../../ai/agent-tool.ts'
import { resetFilesDbForTests } from '../files/files-storage.ts'
import { ensureTmpSessionDir, terminalTmpDir } from '../files/files-tmp.ts'
import { invalidateFilesVfsPathCaches } from '../files/files-vfs.ts'
import { filesReadText, filesStat } from '../files/files-api.ts'
import {
  TERMINAL_OUTPUT_SPILL_PREVIEW_CHARS,
  TERMINAL_OUTPUT_SPILL_THRESHOLD,
  formatSpillFollowUpHint,
  formatSpillPreview,
  maybeSpillToolOutput,
} from './vscode-ai-output-spill.ts'

async function resetState(): Promise<void> {
  await resetFilesDbForTests()
  invalidateFilesVfsPathCaches()
}

async function testShortTextNoSpill(): Promise<void> {
  await resetState()
  const tmpDir = terminalTmpDir('spill-short')
  await ensureTmpSessionDir(tmpDir)
  const text = 'x'.repeat(TERMINAL_OUTPUT_SPILL_THRESHOLD)
  const result = await maybeSpillToolOutput(text, { tmpDir })
  assert.equal(typeof result, 'string')
  assert.equal(result, text)
  console.log('ok: short text no spill')
}

async function testLongTextSpill(): Promise<void> {
  await resetState()
  const tmpDir = terminalTmpDir('spill-long')
  await ensureTmpSessionDir(tmpDir)
  const total = TERMINAL_OUTPUT_SPILL_THRESHOLD + 500
  const text = 'a'.repeat(total)
  const result = await maybeSpillToolOutput(text, { tmpDir })
  assert.ok(isAgentToolStructuredResult(result))
  assert.match(result.content, new RegExp(`输出过长（${total} 字符），已保存至`))
  assert.match(result.content, /\/tmp\/Terminal\/spill-long\/stdout\/run-/)

  const pathMatch = /已保存至 (.+)$/.exec(result.content)
  assert.ok(pathMatch?.[1])
  const path = pathMatch[1]!
  const st = await filesStat(path)
  assert.ok(st)
  assert.equal(await filesReadText(path), text)

  assert.ok(result.appendMessages)
  assert.equal(result.appendMessages.length, 2)
  const assistant = result.appendMessages[0]!
  assert.equal(assistant.role, 'assistant')
  assert.ok('tool_calls' in assistant && Array.isArray(assistant.tool_calls))
  assert.equal(assistant.tool_calls?.[0]?.function.name, 'run_in_terminal')
  const tool = result.appendMessages[1]!
  assert.equal(tool.role, 'tool')
  assert.ok('content' in tool && typeof tool.content === 'string')
  assert.ok(tool.content.startsWith('（以下仅为文件开头'))
  assert.ok(tool.content.includes('instant.grep'))
  assert.ok(tool.content.includes(path))
  assert.ok(tool.content.includes(formatSpillFollowUpHint(path)))
  assert.ok(tool.content.includes(text.slice(0, TERMINAL_OUTPUT_SPILL_PREVIEW_CHARS)))
  assert.equal(
    tool.content.length,
    formatSpillPreview(text, path).length,
  )

  assert.ok(result.syntheticActivities)
  assert.equal(result.syntheticActivities.length, 1)
  assert.equal(result.syntheticActivities[0]?.toolName, 'run_in_terminal')
  assert.equal(result.syntheticActivities[0]?.result, tool.content)

  console.log('ok: long text spill + synthetic messages')
}

async function main(): Promise<void> {
  await testShortTextNoSpill()
  await testLongTextSpill()
  console.log('vscode-ai-output-spill tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
