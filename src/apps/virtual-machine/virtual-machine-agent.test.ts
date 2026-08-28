/**
 * 虚拟机命令通道宿主侧门面单测。
 * 运行行：node --experimental-strip-types src/apps/virtual-machine/virtual-machine-agent.test.ts
 */
import assert from 'node:assert/strict'
import { createVmAgent, VM_AGENT_METHODS, vmAgentFor } from './virtual-machine-agent.ts'
import { INSTANT_VM_MESSAGE_TYPE, isInstantVmAgentCommandMessage } from './virtual-machine-protocol.ts'

function testMethodWhitelistCoversFacade(): void {
  for (const method of [
    'state',
    'exec',
    'execResult',
    'clipboardWrite',
    'shutdown',
    'reboot',
  ]) {
    assert.ok((VM_AGENT_METHODS as readonly string[]).includes(method), method)
  }
  // 感知层方法（2026-08-29 移除）不得回流白名单
  for (const removed of [
    'readText',
    'screenshot',
    'snapshot',
    'dumpRing',
    'captureStart',
    'captureStop',
    'freeze',
  ]) {
    assert.ok(!(VM_AGENT_METHODS as readonly string[]).includes(removed), removed)
  }
}

async function testFacadePassesMethodAndArgs(): Promise<void> {
  const calls: { method: string; args?: readonly unknown[] }[] = []
  const agent = createVmAgent(async (method, args) => {
    calls.push({ method, args })
    if (method === 'state') {
      return { lastPongAgeMs: 12 }
    }
    if (method === 'execResult') {
      return { ok: true, exitCode: 2, timedOut: false }
    }
    if (method === 'clipboardWrite') {
      return true
    }
    return undefined
  })
  assert.deepEqual(await agent.state(), { lastPongAgeMs: 12 })
  await agent.exec('notepad.exe')
  assert.deepEqual(await agent.execResult('cmd /c exit 2'), {
    ok: true,
    exitCode: 2,
    timedOut: false,
  })
  assert.equal(await agent.clipboardWrite('文本'), true)
  await agent.click(512, 384)
  await agent.shutdown()
  await agent.ping()
  assert.deepEqual(calls, [
    { method: 'state', args: undefined },
    { method: 'exec', args: ['notepad.exe'] },
    { method: 'execResult', args: ['cmd /c exit 2'] },
    { method: 'clipboardWrite', args: ['文本'] },
    { method: 'click', args: [512, 384] },
    { method: 'shutdown', args: undefined },
    { method: 'ping', args: undefined },
  ])
}

async function testVmAgentForBindsMachineId(): Promise<void> {
  const seen: string[] = []
  const agent = vmAgentFor(
    {
      agentCommand(id, method) {
        seen.push(`${id}:${method}`)
        return Promise.resolve('done')
      },
    },
    'machine-7',
  )
  assert.equal(await agent.shutdown(), 'done')
  assert.deepEqual(seen, ['machine-7:shutdown'])
}

async function testFacadeMessagePassesProtocolValidator(): Promise<void> {
  // 门面产生的调用形状必须能通过协议校验（真实发送前宿主侧的最后一道关）
  let captured: unknown
  const agent = createVmAgent(async (method, args) => {
    captured = {
      type: INSTANT_VM_MESSAGE_TYPE.agentCommand,
      requestId: 'ag-test',
      method,
      args: args === undefined ? undefined : [...args],
    }
    return undefined
  })
  await agent.keyEvent({
    type: INSTANT_VM_MESSAGE_TYPE.keyboard,
    phase: 'down',
    key: 'a',
    code: 'KeyA',
    keyCode: 65,
    location: 0,
    repeat: false,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
  })
  assert.equal(isInstantVmAgentCommandMessage(captured), true)
}

testMethodWhitelistCoversFacade()
await testFacadePassesMethodAndArgs()
await testVmAgentForBindsMachineId()
await testFacadeMessagePassesProtocolValidator()
console.log('virtual-machine-agent.test.ts ok')
