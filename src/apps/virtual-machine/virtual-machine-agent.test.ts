/**
 * 虚拟机控制面宿主侧门面单测。
 * 运行：node --experimental-strip-types src/apps/virtual-machine/virtual-machine-agent.test.ts
 */
import assert from 'node:assert/strict'
import { createVmAgent, VM_AGENT_METHODS, vmAgentFor } from './virtual-machine-agent.ts'
import { INSTANT_VM_MESSAGE_TYPE, isInstantVmAgentCommandMessage } from './virtual-machine-protocol.ts'

function testMethodWhitelistCoversFacade(): void {
  for (const method of [
    'readText',
    'screenshot',
    'state',
    'exec',
    'click',
    'dblclick',
    'shutdown',
    'reboot',
    'snapshot',
    'dumpRing',
  ]) {
    assert.ok((VM_AGENT_METHODS as readonly string[]).includes(method), method)
  }
}

async function testFacadePassesMethodAndArgs(): Promise<void> {
  const calls: { method: string; args?: readonly unknown[] }[] = []
  const agent = createVmAgent(async (method, args) => {
    calls.push({ method, args })
    if (method === 'readText') {
      return 'SeaBIOS\nBooting from Hard Disk...'
    }
    if (method === 'screenshot') {
      return 'data:image/png;base64,AAAA'
    }
    return undefined
  })
  assert.equal(await agent.readText(), 'SeaBIOS\nBooting from Hard Disk...')
  assert.equal(await agent.screenshot(), 'data:image/png;base64,AAAA')
  await agent.exec('notepad.exe')
  await agent.click(512, 384)
  await agent.shutdown()
  await agent.ping()
  await agent.dumpRing()
  await agent.dumpRing('bsod')
  assert.deepEqual(calls, [
    { method: 'readText', args: undefined },
    { method: 'screenshot', args: undefined },
    { method: 'exec', args: ['notepad.exe'] },
    { method: 'click', args: [512, 384] },
    { method: 'shutdown', args: undefined },
    { method: 'ping', args: undefined },
    { method: 'dumpRing', args: ['manual'] },
    { method: 'dumpRing', args: ['bsod'] },
  ])
}

async function testFreezeGetAndSet(): Promise<void> {
  let frozen = true
  const agent = createVmAgent(async (method, args) => {
    assert.equal(method, 'freeze')
    if (args === undefined || args.length === 0) {
      return frozen
    }
    frozen = args[0] as boolean
    return frozen
  })
  assert.equal(await agent.freeze(), true)
  assert.equal(await agent.freeze(false), false)
  assert.equal(await agent.freeze(), false)
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
  assert.equal(await agent.readText(), 'done')
  assert.deepEqual(seen, ['machine-7:readText'])
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
await testFreezeGetAndSet()
await testVmAgentForBindsMachineId()
await testFacadeMessagePassesProtocolValidator()
console.log('virtual-machine-agent.test.ts ok')
