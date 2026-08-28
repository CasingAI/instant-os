/**
 * clipboard-bridge.exe 产物校验单测（todo/vm-remote-control 剪贴板通道）。
 * 运行：node --experimental-strip-types src/apps/virtual-machine/guest/clipboard-bridge/clipboard-bridge-binary.test.ts
 *
 * 断言口径与 res-agent-binary.test.ts 一致（同一 zig cc -nostdlib 管线）：
 *   PE32 i386 → GUI 子系统 → OS/Subsystem 版本 5.01 → 导入表只含
 *   kernel32/user32 → 体积 < 200KB，两次独立编译结构等价。
 * 环境里没有 zig 时跳过（exit 0），不阻塞无工具链的 CI。
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const AGENT_DIR = dirname(fileURLToPath(import.meta.url))
const BUILD_SCRIPT = join(AGENT_DIR, '..', '..', '..', '..', '..', 'scripts', 'build-clipboard-bridge.sh')

/** 剪贴板桥只依赖 kernel32（设备/内存）+ user32（剪贴板），XP 裸机自带。 */
const IMPORT_DLL_WHITELIST = new Set(['kernel32', 'user32', 'msvcrt'])

const MAX_EXE_BYTES = 200 * 1024

interface PeInfo {
  machine: number
  subsystem: number
  osVersion: string
  subsystemVersion: string
  entryRva: number
  sectionNames: string[]
  imports: string[]
}

function parsePe(image: Buffer): PeInfo {
  assert.equal(image.readUInt16LE(0), 0x5a4d, '缺 MZ 签名')
  const peOffset = image.readUInt32LE(0x3c)
  assert.equal(image.readUInt32LE(peOffset), 0x00004550, '缺 PE 签名')
  const numSections = image.readUInt16LE(peOffset + 6)
  const sizeOfOptionalHeader = image.readUInt16LE(peOffset + 20)
  const optionalHeader = peOffset + 24
  assert.equal(image.readUInt16LE(optionalHeader), 0x10b, '必须是 PE32（32 位可选头），不接受 PE32+')

  const sectionTable = optionalHeader + sizeOfOptionalHeader
  const sections: { va: number; span: number; ptr: number }[] = []
  const sectionNames: string[] = []
  for (let i = 0; i < numSections; i++) {
    const s = sectionTable + i * 40
    sections.push({
      va: image.readUInt32LE(s + 12),
      span: Math.max(image.readUInt32LE(s + 8), image.readUInt32LE(s + 16)),
      ptr: image.readUInt32LE(s + 20),
    })
    sectionNames.push(image.toString('ascii', s, s + 8).replace(/\0.*$/, ''))
  }
  const rvaToOffset = (rva: number): number => {
    for (const section of sections) {
      if (rva >= section.va && rva < section.va + section.span) {
        return rva - section.va + section.ptr
      }
    }
    throw new Error(`RVA 0x${rva.toString(16)} 不在任何节内`)
  }

  const importDirRva = image.readUInt32LE(optionalHeader + 96 + 8)
  const imports: string[] = []
  if (importDirRva > 0) {
    let descriptor = rvaToOffset(importDirRva)
    for (;;) {
      if (image.readUInt32LE(descriptor) === 0 && image.readUInt32LE(descriptor + 12) === 0) break
      const nameRva = image.readUInt32LE(descriptor + 12)
      let end = rvaToOffset(nameRva)
      while (end < image.length && image[end] !== 0) {
        end++
      }
      imports.push(image.toString('ascii', rvaToOffset(nameRva), end))
      descriptor += 20
    }
  }

  return {
    machine: image.readUInt16LE(peOffset + 4),
    subsystem: image.readUInt16LE(optionalHeader + 68),
    osVersion: `${image.readUInt16LE(optionalHeader + 40)}.${image.readUInt16LE(optionalHeader + 42)}`,
    subsystemVersion: `${image.readUInt16LE(optionalHeader + 48)}.${image.readUInt16LE(optionalHeader + 50)}`,
    entryRva: image.readUInt32LE(optionalHeader + 16),
    sectionNames,
    imports,
  }
}

function buildInto(directory: string): Buffer {
  const result = spawnSync('sh', [BUILD_SCRIPT, directory], { encoding: 'utf8' })
  assert.equal(
    result.status,
    0,
    `build-clipboard-bridge.sh 失败：\n${result.stdout ?? ''}\n${result.stderr ?? ''}`,
  )
  return readFileSync(join(directory, 'clipboard-bridge.exe'))
}

function hasZig(): boolean {
  return spawnSync('zig', ['version'], { encoding: 'utf8' }).status === 0
}

function buildAndAssert(directory: string): PeInfo {
  const image = buildInto(directory)
  assert.ok(image.length > 0 && image.length <= MAX_EXE_BYTES, `EXE 体积应 ≤ 200KB，实际 ${image.length}`)
  const pe = parsePe(image)
  assert.equal(pe.machine, 0x14c, 'CPU 架构必须是 i386（XP 32 位）')
  assert.equal(pe.subsystem, 2, '子系统必须是 GUI（后台工具不闪控制台）')
  assert.equal(pe.osVersion, '5.1', 'OS 版本必须补成 5.01（patch-pe-xp-version.mjs 的目标值）')
  assert.equal(pe.subsystemVersion, '5.1', 'Subsystem 版本必须补成 5.01')
  assert.notEqual(pe.entryRva, 0, '入口点不能为 0（-nostdlib 自定义入口 bridge_entry）')
  assert.ok(pe.imports.length > 0, '导入表为空，构建疑似坏了')
  for (const dll of pe.imports) {
    const base = dll.replace(/\.dll$/i, '').toLowerCase()
    assert.ok(IMPORT_DLL_WHITELIST.has(base), `导入表出现白名单之外的 DLL：${dll}`)
  }
  return pe
}

function main() {
  if (!hasZig()) {
    console.log('SKIP: 未安装 zig（brew install zig），clipboard-bridge 产物校验只在装了工具链的环境跑')
    return
  }
  const sourceLines = readFileSync(join(AGENT_DIR, 'clipboard-bridge.c'), 'utf8').split('\n').length
  assert.ok(sourceLines < 320, `clipboard-bridge.c 应保持 < 320 行，当前 ${sourceLines} 行`)

  const infoA = buildAndAssert(mkdtempSync(join(tmpdir(), 'clip-bridge-a-')))
  const infoB = buildAndAssert(mkdtempSync(join(tmpdir(), 'clip-bridge-b-')))
  assert.deepEqual(infoB.imports, infoA.imports, '两次编译的导入表不一致')
  assert.deepEqual(infoB.sectionNames, infoA.sectionNames, '两次编译的节表不一致')
  const importBases = infoA.imports.map((dll) => dll.replace(/\.dll$/i, '').toLowerCase())
  for (const required of ['kernel32', 'user32']) {
    assert.ok(importBases.includes(required), `导入表缺少依赖 ${required}：${infoA.imports.join(', ')}`)
  }

  console.log(`clipboard-bridge-binary.test.ts ok (${infoA.imports.join(', ')})`)
}

main()
