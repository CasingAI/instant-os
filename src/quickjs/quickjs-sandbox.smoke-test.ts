import { createQuickJsInstance } from './quickjs-instance.ts'
import { runQuickJsSandbox } from './quickjs-sandbox.ts'

async function testSandbox() {
  const add = await runQuickJsSandbox('1 + 2 * 3')
  if (!add.ok || add.value !== 7) {
    throw new Error(`unexpected add result: ${JSON.stringify(add)}`)
  }

  const withGlobals = await runQuickJsSandbox('NAME + "!"', {
    globals: { NAME: 'QuickJS' },
  })
  if (!withGlobals.ok || withGlobals.value !== 'QuickJS!') {
    throw new Error(`unexpected globals result: ${JSON.stringify(withGlobals)}`)
  }

  const failure = await runQuickJsSandbox('throw new Error("boom")')
  if (failure.ok || !failure.error.includes('boom')) {
    throw new Error(`unexpected failure result: ${JSON.stringify(failure)}`)
  }

  console.log('quickjs-sandbox smoke test passed')
}

async function testInstance() {
  const instance = await createQuickJsInstance()

  const host = instance.getHostConfig()
  if (host.workspaceRoot !== undefined) {
    throw new Error(`expected no workspaceRoot by default, got ${host.workspaceRoot}`)
  }
  if (host.argv[0] !== 'instant-node') {
    throw new Error(`unexpected default argv: ${JSON.stringify(host.argv)}`)
  }
  if (host.env.HOME !== '/user' || host.env.USER !== 'user') {
    throw new Error(`unexpected default env: ${JSON.stringify(host.env)}`)
  }
  if (host.permissions.network !== false) {
    throw new Error('expected network permission false')
  }
  if (host.permissions.fsReadRoots.length !== 0 || host.permissions.fsWriteRoots.length !== 0) {
    throw new Error(`expected empty fs roots without workspace, got ${JSON.stringify(host.permissions)}`)
  }

  const withRoot = await createQuickJsInstance({
    workspaceRoot: '/user/project',
    env: { FOO: 'bar' },
    argv: ['instant-node', '/user/project/main.js'],
  })
  const rooted = withRoot.getHostConfig()
  if (rooted.workspaceRoot !== '/user/project') {
    throw new Error(`unexpected workspaceRoot: ${rooted.workspaceRoot}`)
  }
  if (rooted.env.FOO !== 'bar' || rooted.env.HOME !== undefined) {
    throw new Error(`env should be whole-table replace when passed: ${JSON.stringify(rooted.env)}`)
  }
  if (
    rooted.permissions.fsReadRoots.length !== 1 ||
    rooted.permissions.fsReadRoots[0] !== '/user/project'
  ) {
    throw new Error(`unexpected fs roots: ${JSON.stringify(rooted.permissions)}`)
  }
  withRoot.destroy()

  let invalidRootThrew = false
  try {
    await createQuickJsInstance({ workspaceRoot: 'relative/path' })
  } catch {
    invalidRootThrew = true
  }
  if (!invalidRootThrew) {
    throw new Error('expected invalid workspaceRoot to throw')
  }

  const first = await instance.eval('var __alive = 41; __alive')
  if (!first.ok || first.value !== 41) {
    throw new Error(`unexpected first eval: ${JSON.stringify(first)}`)
  }

  const second = await instance.eval('__alive = __alive + 1; __alive')
  if (!second.ok || second.value !== 42) {
    throw new Error(`unexpected second eval (globals should persist): ${JSON.stringify(second)}`)
  }

  const logged = await instance.eval('console.log("hello", 1); "ok"')
  if (!logged.ok || logged.value !== 'ok') {
    throw new Error(`unexpected console eval: ${JSON.stringify(logged)}`)
  }
  if (!logged.consoleLines.some((line) => line.level === 'log' && line.text.includes('hello'))) {
    throw new Error(`expected console line, got: ${JSON.stringify(logged.consoleLines)}`)
  }
  if (logged.exited || logged.exitCode !== 0) {
    throw new Error(`unexpected exit fields on console eval: ${JSON.stringify(logged)}`)
  }

  const snapBeforeProcess = instance.getSnapshot()
  if (snapBeforeProcess.cwd !== '/user' || snapBeforeProcess.exitCode !== 0) {
    throw new Error(`unexpected default process snapshot: ${JSON.stringify(snapBeforeProcess)}`)
  }

  const processBasics = await instance.eval(`
    process.stdout.write("out:" + process.env.HOME);
    process.stderr.write("err");
    process.chdir("/user/docs");
    process.cwd()
  `)
  if (!processBasics.ok || processBasics.value !== '/user/docs') {
    throw new Error(`unexpected process basics: ${JSON.stringify(processBasics)}`)
  }
  if (!processBasics.consoleLines.some((line) => line.level === 'log' && line.text.includes('out:/user'))) {
    throw new Error(`expected stdout line, got: ${JSON.stringify(processBasics.consoleLines)}`)
  }
  if (!processBasics.consoleLines.some((line) => line.level === 'error' && line.text === 'err')) {
    throw new Error(`expected stderr line, got: ${JSON.stringify(processBasics.consoleLines)}`)
  }
  if (instance.getSnapshot().cwd !== '/user/docs') {
    throw new Error(`cwd should persist after chdir: ${JSON.stringify(instance.getSnapshot())}`)
  }

  const exitCodeOnly = await instance.eval('process.exitCode = 7; "done"')
  if (!exitCodeOnly.ok || exitCodeOnly.exited || exitCodeOnly.exitCode !== 7) {
    throw new Error(`unexpected exitCode-only result: ${JSON.stringify(exitCodeOnly)}`)
  }

  const exited = await instance.eval('process.stdout.write("before-exit"); process.exit(2); process.stdout.write("after-exit")')
  if (!exited.ok || !exited.exited || exited.exitCode !== 2) {
    throw new Error(`unexpected process.exit result: ${JSON.stringify(exited)}`)
  }
  if (exited.consoleLines.some((line) => line.text.includes('after-exit'))) {
    throw new Error(`code after process.exit should not run: ${JSON.stringify(exited.consoleLines)}`)
  }
  if (instance.getSnapshot().destroyed) {
    throw new Error('process.exit must not destroy the instance')
  }

  const afterExit = await instance.eval('process.cwd()')
  if (!afterExit.ok || afterExit.value !== '/user/docs' || afterExit.exited) {
    throw new Error(`instance should remain usable after exit: ${JSON.stringify(afterExit)}`)
  }
  if (afterExit.exitCode !== 2) {
    throw new Error(`exitCode should persist across evals: ${JSON.stringify(afterExit)}`)
  }

  const rootedCwd = await createQuickJsInstance({ workspaceRoot: '/user/project' })
  const cwdFromRoot = await rootedCwd.eval('process.cwd()')
  if (!cwdFromRoot.ok || cwdFromRoot.value !== '/user/project') {
    throw new Error(`expected cwd from workspaceRoot: ${JSON.stringify(cwdFromRoot)}`)
  }
  rootedCwd.destroy()

  const snapshot = instance.getSnapshot()
  if (snapshot.destroyed || snapshot.busy) {
    throw new Error(`unexpected snapshot before destroy: ${JSON.stringify(snapshot)}`)
  }

  instance.destroy()

  if (!instance.getSnapshot().destroyed) {
    throw new Error('expected destroyed snapshot after destroy')
  }

  let threw = false
  try {
    await instance.eval('1')
  } catch {
    threw = true
  }
  if (!threw) {
    throw new Error('expected eval after destroy to throw')
  }

  console.log('quickjs-instance smoke test passed')
}

async function main() {
  await testSandbox()
  await testInstance()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
