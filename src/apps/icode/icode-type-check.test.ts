/**
 * 类型检查（第五期）单测：Node 里直接跑核心，验证 Preact 白名单命中与诊断定位。
 * 运行：node --experimental-strip-types src/apps/icode/icode-type-check.test.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import {
  buildPreactPackageJsons,
  runTypeCheck,
  TYPE_CHECK_SUPPORT_PATHS,
} from './icode-type-check-core.ts'

function readNodeModule(relative: string): string {
  return readFileSync(
    resolvePath('node_modules', relative.replace(/^node_modules\//, '')),
    'utf8',
  )
}

function buildSupport() {
  const libs: Record<string, string> = {}
  for (const name of TYPE_CHECK_SUPPORT_PATHS.libNames) {
    libs[name] = readNodeModule(`typescript/lib/${name}`)
  }
  const systemTypes: Record<string, string> = { ...buildPreactPackageJsons() }
  for (const name of TYPE_CHECK_SUPPORT_PATHS.systemTypeNames) {
    systemTypes[name] = readNodeModule(name)
  }
  return { libs, systemTypes }
}

async function testPreactResolvesClean(): Promise<void> {
  const support = buildSupport()
  const response = runTypeCheck(
    {
      files: {
        'main.tsx': `import { render } from 'preact'\nimport { useState } from 'preact/hooks'\nimport App from './App'\nrender(<App />, document.body)\n`,
        'App.tsx': `import { useState } from 'preact/hooks'\nexport default function App() {\n  const [n] = useState(0)\n  return <div className="app">{n}</div>\n}\n`,
      },
      entryPath: 'main.tsx',
    },
    support,
  )
  assert.equal(response.error, undefined, response.error ?? '')
  assert.deepEqual(
    response.diagnostics.filter((item) => item.file === 'main.tsx' || item.file === 'App.tsx'),
    [],
    JSON.stringify(response.diagnostics, null, 2),
  )
}

async function testTypeErrorReportsLocation(): Promise<void> {
  const support = buildSupport()
  const response = runTypeCheck(
    {
      files: {
        'main.tsx': `const count: number = "not a number"\ncount\n`,
      },
      entryPath: 'main.tsx',
    },
    support,
  )
  const errors = response.diagnostics.filter((item) => item.category === 'error')
  assert.ok(errors.length > 0)
  const first = errors[0]!
  assert.equal(first.file, 'main.tsx')
  assert.equal(first.line, 1)
  assert.ok(first.message.includes('string') || first.message.includes('number'))
}

async function testUnknownBareImportFails(): Promise<void> {
  const support = buildSupport()
  const response = runTypeCheck(
    {
      files: {
        'main.tsx': `import x from 'lodash'\nx\n`,
      },
      entryPath: 'main.tsx',
    },
    support,
  )
  assert.ok(
    response.diagnostics.some((item) => item.message.includes('lodash') || item.message.includes("Cannot find module")),
  )
}

async function testCssImportAllowed(): Promise<void> {
  const support = buildSupport()
  const response = runTypeCheck(
    {
      files: {
        'main.tsx': `import './styles/app.css'\nimport logo from './img/logo.png'\nconsole.log(logo)\n`,
      },
      entryPath: 'main.tsx',
    },
    support,
  )
  assert.deepEqual(response.diagnostics, [])
}

async function main(): Promise<void> {
  await testPreactResolvesClean()
  await testTypeErrorReportsLocation()
  await testUnknownBareImportFails()
  await testCssImportAllowed()
  console.log('icode-type-check.test: all passed')
}

void main()
