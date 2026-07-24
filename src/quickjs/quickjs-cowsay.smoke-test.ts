/**
 * L2.5.2 全链路：install cowsay → npx cowsay → stdout 含 ASCII 牛。
 * 需联网（registry.npmjs.org）。
 */
import 'fake-indexeddb/auto'
import {
  filesCreateText,
  filesLstat,
  filesMkdir,
  filesRemove,
  filesStat,
  filesSymlink,
  filesWriteText,
} from '../apps/files/files-api.ts'
import { installPackages } from '../packages/package-service.ts'
import { runNpmScript, runNpx } from '../packages/package-run.ts'

const PROJECT = '/user/qjs-cowsay-smoke'

async function ensureDir(path: string): Promise<void> {
  const st = await filesStat(path)
  if (st?.kind === 'folder') return
  if (st) await filesRemove(path)
  const parts = path.split('/').filter(Boolean)
  let cursor = ''
  for (const part of parts) {
    cursor += `/${part}`
    const cur = await filesStat(cursor)
    if (cur?.kind === 'folder') continue
    if (cur) throw new Error(`path occupied: ${cursor}`)
    if (cursor.split('/').filter(Boolean).length <= 1) continue
    await filesMkdir(cursor)
  }
}

async function upsertText(path: string, text: string): Promise<void> {
  const st = await filesStat(path)
  if (st?.kind === 'file') {
    await filesWriteText(path, text)
    return
  }
  if (st) throw new Error(`path occupied: ${path}`)
  await filesCreateText(path, text)
}

async function testCowsayNpx(): Promise<void> {
  const existing = await filesStat(PROJECT)
  if (existing !== undefined) {
    await filesRemove(PROJECT)
  }
  await ensureDir(PROJECT)
  await upsertText(
    `${PROJECT}/package.json`,
    `${JSON.stringify({ name: 'cowsay-smoke', version: '0.0.0', private: true }, null, 2)}\n`,
  )

  const install = await installPackages({
    projectRoot: PROJECT,
    packages: ['cowsay@1.6.0'],
  })
  if (install.status !== 'succeeded') {
    throw new Error(
      `cowsay install failed: ${install.error ?? install.status}\n${install.logs.map((l) => l.message).join('\n')}`,
    )
  }

  const result = await runNpx({
    projectRoot: PROJECT,
    packageSpec: 'cowsay',
    args: ['Hello World'],
  })
  if (!result.ok) {
    throw new Error(`npx cowsay failed: ${JSON.stringify(result)}`)
  }
  const stdout = result.consoleLines
    .filter((line) => line.level === 'log')
    .map((line) => line.text)
    .join('\n')
  if (!stdout.includes('Hello World') || !stdout.includes('(oo)')) {
    throw new Error(`expected cowsay ASCII cow in stdout, got:\n${stdout}`)
  }
  console.log('L2.5.2 npx cowsay smoke passed')
}

/** 覆盖 .bin lstat：npm run 经 symlink 解析到真实入口 */
async function testBinScriptResolve(): Promise<void> {
  const root = '/user/qjs-bin-script-smoke'
  const existing = await filesStat(root)
  if (existing !== undefined) {
    await filesRemove(root)
  }
  await ensureDir(`${root}/node_modules/demo-cli/bin`)
  await ensureDir(`${root}/node_modules/.bin`)
  await upsertText(
    `${root}/package.json`,
    `${JSON.stringify(
      {
        name: 'bin-script-smoke',
        version: '0.0.0',
        scripts: { greet: 'demo-cli' },
      },
      null,
      2,
    )}\n`,
  )
  await upsertText(
    `${root}/node_modules/demo-cli/package.json`,
    `${JSON.stringify({ name: 'demo-cli', version: '1.0.0', bin: { 'demo-cli': 'bin/cli.js' } }, null, 2)}\n`,
  )
  // 相对 require：若 filename 错落在 .bin/，会去找 node_modules/lib/msg.js
  await upsertText(
    `${root}/node_modules/demo-cli/bin/cli.js`,
    `const msg = require('../lib/msg.js')\nconsole.log(msg)\n`,
  )
  await ensureDir(`${root}/node_modules/demo-cli/lib`)
  await upsertText(`${root}/node_modules/demo-cli/lib/msg.js`, `module.exports = 'bin-ok'\n`)

  const linkPath = `${root}/node_modules/.bin/demo-cli`
  const linkSt = await filesLstat(linkPath)
  if (linkSt) await filesRemove(linkPath)
  await filesSymlink('../demo-cli/bin/cli.js', linkPath)

  const run = await runNpmScript({ projectRoot: root, scriptName: 'greet' })
  if (!run.ok) {
    throw new Error(`npm run greet failed: ${JSON.stringify(run)}`)
  }
  if (!run.consoleLines.some((line) => line.text === 'bin-ok')) {
    throw new Error(`expected bin-ok from relative require, got: ${JSON.stringify(run.consoleLines)}`)
  }
  console.log('L2.5 .bin script resolve smoke passed')
  try {
    await filesRemove(root)
  } catch {
    // best-effort
  }
}

async function main() {
  await testBinScriptResolve()
  await testCowsayNpx()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
