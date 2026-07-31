/**
 * OS 日期时间 system 段单测。
 * 运行：node --experimental-strip-types src/ai/os-datetime-system-context.test.ts
 */
import assert from 'node:assert/strict'
import {
  OS_DATETIME_SYSTEM_SECTION_MARKER,
  appendOsDateTimeSystemSection,
  buildOsDateTimeSystemSection,
} from './os-datetime-system-context.ts'

{
  const section = buildOsDateTimeSystemSection()
  assert.ok(section.startsWith(OS_DATETIME_SYSTEM_SECTION_MARKER))
  assert.match(section, /\d/)
}

{
  const once = appendOsDateTimeSystemSection('你是助手。')
  assert.ok(once.includes('你是助手。'))
  assert.ok(once.includes(OS_DATETIME_SYSTEM_SECTION_MARKER))
  const twice = appendOsDateTimeSystemSection(once)
  assert.equal(twice, once)
}

{
  const empty = appendOsDateTimeSystemSection('')
  assert.equal(empty, buildOsDateTimeSystemSection())
}

console.log('os-datetime-system-context.test.ts: ok')
