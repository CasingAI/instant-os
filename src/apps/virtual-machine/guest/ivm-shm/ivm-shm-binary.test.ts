/**
 * ivm-shm.sys 产物校验单测（todo/vm-remote-control 剪贴板通道底座）。
 * 运行：node --experimental-strip-types src/apps/virtual-machine/guest/ivm-shm/ivm-shm-binary.test.ts
 *
 * 断言口径与 boxvnt-binary.test.ts 一致（同一 wlink + normalize 管线）：
 *   PE32 i386 → native 子系统（内核驱动）→ SubsystemVersion 4.0 → 校验和
 *   自洽 → 入口点非零 → 所有节 VirtualSize 非零 → 导入表只含 NTOSKRNL.EXE
 *   → 无「间接调用跳板槽」残留 → .reloc 链走满目录 → 体积 < 200KB。
 * 环境里没有 Open Watcom（BOXVNT_WATCOM 未指、缓存未建）时跳过（exit 0）。
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DRV_DIR = dirname(fileURLToPath(import.meta.url))
const BUILD_SCRIPT = join(DRV_DIR, '..', '..', '..', '..', '..', 'scripts', 'build-ivm-shm.sh')

/** 内核驱动只允许导入 ntoskrnl（信箱驱动的唯一外部依赖）。 */
const IMPORT_DLL_WHITELIST = new Set(['ntoskrnl'])

const MAX_SYS_BYTES = 200 * 1024

interface PeInfo {
  machine: number
  subsystem: number
  subsystemVersion: [number, number]
  checksumValid: boolean
  entryRva: number
  sectionNames: string[]
  virtualSizes: number[]
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

  const checksumFieldOffset = optionalHeader + 64
  const stored = image.readUInt32LE(checksumFieldOffset)
  const copy = Buffer.from(image)
  copy.writeUInt32LE(0, checksumFieldOffset)
  let sum = 0
  const padded = copy.length + (copy.length % 2)
  for (let offset = 0; offset < padded; offset += 2) {
    sum += offset + 1 < copy.length ? copy.readUInt16LE(offset) : copy[offset]
    sum = (sum & 0xffff) + (sum >> 16)
  }
  sum = (sum & 0xffff) + (sum >> 16)

  return {
    machine: image.readUInt16LE(peOffset + 4),
    subsystem: image.readUInt16LE(optionalHeader + 68),
    subsystemVersion: [image.readUInt16LE(optionalHeader + 48), image.readUInt16LE(optionalHeader + 50)],
    checksumValid: ((sum + copy.length) >>> 0) === stored,
    entryRva: image.readUInt32LE(optionalHeader + 16),
    sectionNames,
    virtualSizes: Array.from({ length: numSections }, (_, i) => image.readUInt32LE(sectionTable + i * 40 + 8)),
    imports,
  }
}

function buildInto(directory: string): Buffer {
  const result = spawnSync('sh', [BUILD_SCRIPT, directory], { encoding: 'utf8' })
  assert.equal(
    result.status,
    0,
    `build-ivm-shm.sh 失败：\n${result.stdout ?? ''}\n${result.stderr ?? ''}`,
  )
  return readFileSync(join(directory, 'ivm-shm.sys'))
}

function hasWatcom(): boolean {
  const ow = process.env.BOXVNT_WATCOM
  if (ow) {
    return existsSync(ow)
  }
  return existsSync(join(homedir(), '.cache', 'boxvnt', 'ow-snapshot'))
}

function buildAndAssert(directory: string): PeInfo {
  const image = buildInto(directory)
  assert.ok(image.length > 0 && image.length <= MAX_SYS_BYTES, `SYS 体积应 ≤ 200KB，实际 ${image.length}`)
  const pe = parsePe(image)
  assert.equal(pe.machine, 0x14c, 'CPU 架构必须是 i386（XP 32 位）')
  assert.equal(pe.subsystem, 1, '子系统必须是 native（内核驱动）')
  assert.deepEqual(
    pe.subsystemVersion,
    [4, 0],
    'SubsystemVersion 应为 4.0（normalize-boxvnt-pe.mjs 对 native 驱动的目标值）',
  )
  assert.ok(pe.checksumValid, 'CheckSum 必须与 PE 标准算法自洽')
  assert.notEqual(pe.entryRva, 0, '入口点不能为 0（DriverEntry）')
  assert.ok(pe.virtualSizes.every((size) => size > 0), '每个节的 VirtualSize 必须非零')
  assert.equal(pe.imports.length, 1, `导入表应只有 ntoskrnl 一项，实际 ${pe.imports.join(', ')}`)
  for (const dll of pe.imports) {
    const base = dll.replace(/\.(exe|sys|dll)$/i, '').toLowerCase()
    assert.ok(IMPORT_DLL_WHITELIST.has(base), `导入表出现白名单之外的模块：${dll}`)
  }
  return pe
}

function main() {
  if (!hasWatcom()) {
    console.log('SKIP: 未安装 Open Watcom（见 scripts/build-ivm-shm.sh 头注释），ivm-shm 产物校验跳过')
    return
  }
  const sourceLines = readFileSync(join(DRV_DIR, 'ivm-shm.c'), 'utf8').split('\n').length
  assert.ok(sourceLines < 260, `ivm-shm.c 应保持 < 260 行，当前 ${sourceLines} 行`)

  const infoA = buildAndAssert(mkdtempSync(join(tmpdir(), 'ivm-shm-a-')))
  const infoB = buildAndAssert(mkdtempSync(join(tmpdir(), 'ivm-shm-b-')))
  assert.deepEqual(infoB.imports, infoA.imports, '两次编译的导入表不一致')
  assert.deepEqual(infoB.sectionNames, infoA.sectionNames, '两次编译的节表不一致')
  assert.deepEqual(infoB.subsystemVersion, infoA.subsystemVersion, '两次编译的 Subsystem 版本不一致')

  console.log(`ivm-shm-binary.test.ts ok (${infoA.imports.join(', ')})`)
}

main()
