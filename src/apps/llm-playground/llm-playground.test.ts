import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildPlaygroundMessages,
  formatPlaygroundConversation,
  parsePlaygroundStopSequence,
} from './llm-playground-messages.ts'
import { createPlaygroundMessage } from './llm-playground-storage.ts'

test('buildPlaygroundMessages 跳过空内容并保留 role', () => {
  const messages = [
    createPlaygroundMessage('system', '   '),
    createPlaygroundMessage('system', 'You are helpful'),
    createPlaygroundMessage('user', 'Hello'),
    createPlaygroundMessage('assistant', 'Hi there'),
    createPlaygroundMessage('user', '\n  \n'),
  ]
  const built = buildPlaygroundMessages(messages)
  assert.deepEqual(built, [
    { role: 'system', content: 'You are helpful' },
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi there' },
  ])
})

test('buildPlaygroundMessages 空列表返回空数组', () => {
  assert.deepEqual(buildPlaygroundMessages([]), [])
})

test('parsePlaygroundStopSequence 解析逗号分隔并 trim', () => {
  assert.deepEqual(parsePlaygroundStopSequence('</output>, END,  '), ['</output>', 'END'])
  assert.deepEqual(parsePlaygroundStopSequence('单序列'), ['单序列'])
  assert.equal(parsePlaygroundStopSequence('   '), undefined)
  assert.equal(parsePlaygroundStopSequence(''), undefined)
})

test('createPlaygroundMessage 生成唯一 id 与 role', () => {
  const message = createPlaygroundMessage('assistant', 'hello')
  assert.equal(message.role, 'assistant')
  assert.equal(message.content, 'hello')
  assert.ok(message.id.length > 0)
  const another = createPlaygroundMessage('assistant', 'world')
  assert.notEqual(message.id, another.id)
})

test('formatPlaygroundConversation 格式化整个对话', () => {
  const messages = [
    createPlaygroundMessage('system', 'You are helpful'),
    createPlaygroundMessage('user', 'Hello'),
    createPlaygroundMessage('assistant', 'Hi there'),
  ]
  assert.equal(
    formatPlaygroundConversation(messages),
    '[System]\nYou are helpful\n\n[User]\nHello\n\n[Assistant]\nHi there',
  )
})

test('formatPlaygroundConversation 跳过空内容，全空返回空字符串', () => {
  const messages = [
    createPlaygroundMessage('system', '   '),
    createPlaygroundMessage('user', 'Hello'),
    createPlaygroundMessage('assistant', '\n  \n'),
  ]
  assert.equal(formatPlaygroundConversation(messages), '[User]\nHello')
  assert.equal(formatPlaygroundConversation([]), '')
  assert.equal(
    formatPlaygroundConversation([
      createPlaygroundMessage('user', '  '),
      createPlaygroundMessage('assistant', ''),
    ]),
    '',
  )
})
