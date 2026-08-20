/**
 * switch_mode 目标校验单测。
 * 运行：node --experimental-strip-types --test src/apps/vscode/vscode-ai-switch-mode.test.ts
 */
import assert from 'node:assert/strict'
import {
  resolveSwitchModeTarget,
  VSCODE_AI_SWITCH_MODE_TARGETS,
} from './vscode-ai-mode.ts'

assert.deepEqual(VSCODE_AI_SWITCH_MODE_TARGETS.ask, ['plan'])
assert.deepEqual(VSCODE_AI_SWITCH_MODE_TARGETS.plan, ['agent'])
assert.deepEqual(VSCODE_AI_SWITCH_MODE_TARGETS.agent, ['plan'])

assert.deepEqual(resolveSwitchModeTarget('agent', 'plan'), {
  ok: true,
  target: 'plan',
})
assert.deepEqual(resolveSwitchModeTarget('plan', 'agent'), {
  ok: true,
  target: 'agent',
})
assert.deepEqual(resolveSwitchModeTarget('ask', 'plan'), {
  ok: true,
  target: 'plan',
})

assert.equal(resolveSwitchModeTarget('ask', 'agent').ok, false)
assert.equal(resolveSwitchModeTarget('agent', 'agent').ok, false)
assert.equal(resolveSwitchModeTarget('plan', 'plan').ok, false)
assert.equal(resolveSwitchModeTarget('agent', 'ask').ok, false)
assert.equal(resolveSwitchModeTarget('plan', 'ask').ok, false)
assert.equal(resolveSwitchModeTarget('agent', 'debug').ok, false)
assert.equal(resolveSwitchModeTarget('agent', undefined).ok, false)

const askToAgent = resolveSwitchModeTarget('ask', 'agent')
assert.equal(askToAgent.ok, false)
if (!askToAgent.ok) {
  assert.match(askToAgent.error, /Ask/)
  assert.match(askToAgent.error, /plan/)
}

console.log('vscode-ai-switch-mode.test.ts: ok')
