/**
 * boxvideo.sys 产物校验单测（todo/vm-arbitrary-resolution/ §5）。
 * 运行：node --experimental-strip-types src/apps/virtual-machine/guest/boxvnt/boxvnt-binary.test.ts
 *
 * 跑两遍 scripts/build-boxvnt.sh，对产物做 PE 结构断言：
 *   MZ/PE 签名 → PE32 (0x10b) → i386 → native 子系统（内核驱动）
 *   → SubsystemVersion 4.0 → 校验和与标准算法自洽（wlink 产物经
 *   scripts/normalize-boxvnt-pe.mjs 规范化后的形态）→ 入口点非零
 *   → 所有节 VirtualSize 非零 → 导入表只含 VIDEOPRT.SYS → 体积 < 200KB。
 * NT 驱动的入口是 PE entry point（makefile option start='_DriverEntry@8'），
 * 没有导出表——计划初稿写的「导出 DriverEntry@8」按此修正。
 * 再校验两次独立编译结构等价（wlink 嵌时间戳，等价级别同 res-agent）。
 * 环境里没有 Open Watcom（BOXVNT_WATCOM 未指、缓存未建）时跳过（exit 0），
 * 不阻塞无工具链的环境；首次构建请先跑一次 scripts/build-boxvnt.sh。
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DRV_DIR = dirname(fileURLToPath(import.meta.url))
const BUILD_SCRIPT = join(DRV_DIR, '..', '..', '..', '..', '..', 'scripts', 'build-boxvnt.sh')

/** 内核驱动只能导入 video 端口驱动（boxvnt 唯一的外部依赖）。 */
const IMPORT_DLL_WHITELIST = new Set(['videoprt.sys'])

const MAX_SYS_BYTES = 200 * 1024

interface PeInfo {
  machine: number
  subsystem: number
  subsystemVersion: [number, number]
  checksum: number
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

  return {
    machine: image.readUInt16LE(peOffset + 4),
    subsystem: image.readUInt16LE(optionalHeader + 68),
    subsystemVersion: [image.readUInt16LE(optionalHeader + 48), image.readUInt16LE(optionalHeader + 50)],
    checksum: image.readUInt32LE(optionalHeader + 64),
    checksumValid: verifyChecksum(image, optionalHeader + 64),
    entryRva: image.readUInt32LE(optionalHeader + 16),
    sectionNames,
    virtualSizes: Array.from({ length: numSections }, (_, i) => image.readUInt32LE(sectionTable + i * 40 + 8)),
    imports,
  }
}

/** PE 标准校验和算法（scripts/normalize-boxvnt-pe.mjs 同款）：字段置 0 求和折叠，末尾加文件长度。 */
function verifyChecksum(image: Buffer, checksumFieldOffset: number): boolean {
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
  return ((sum + copy.length) >>> 0) === stored
}

/**
 * 是否残留「FF 15 间接调用 → FF 25 跳板槽」的自相矛盾导入派发。
 * 判定：可执行节里的 FF 15，其操作数（减 ImageBase 后）指向的字节
 * 恰是 FF 25——即把跳板槽的指令字节当地址去调用。wlink-2026-beta
 * 的原始产物正是这种形态（XP 加载即蓝屏）；normalize-boxvnt-pe.mjs
 * 必须已把它们全部改写为 E8 直调，此函数应恒为 false。
 */
function hasIndirectCallsIntoJumpThunks(image: Buffer): boolean {
  const peOffset = image.readUInt32LE(0x3c)
  const numSections = image.readUInt16LE(peOffset + 6)
  const sizeOfOptionalHeader = image.readUInt16LE(peOffset + 20)
  const optionalHeader = peOffset + 24
  const imageBase = image.readUInt32LE(optionalHeader + 28)
  const sectionTable = optionalHeader + sizeOfOptionalHeader
  const sections: { va: number; rawSize: number; ptr: number; chars: number }[] = []
  for (let i = 0; i < numSections; i++) {
    const s = sectionTable + i * 40
    sections.push({
      va: image.readUInt32LE(s + 12),
      rawSize: image.readUInt32LE(s + 16),
      ptr: image.readUInt32LE(s + 20),
      chars: image.readUInt32LE(s + 36),
    })
  }
  const rvaToOffset = (rva: number): number => {
    for (const section of sections) {
      if (rva >= section.va && rva < section.va + section.rawSize) {
        return section.ptr + (rva - section.va)
      }
    }
    return -1
  }
  for (const section of sections) {
    if ((section.chars & 0x60000000) !== 0x60000000) continue
    for (let off = 0; off + 6 <= section.rawSize; off++) {
      if (image[section.ptr + off] !== 0xff || image[section.ptr + off + 1] !== 0x15) continue
      const targetRva = image.readUInt32LE(section.ptr + off + 2) - imageBase
      const targetOff = rvaToOffset(targetRva)
      if (targetOff >= 0 && image[targetOff] === 0xff && image[targetOff + 1] === 0x25) {
        return true
      }
    }
  }
  return false
}

/**
 * .reloc 目录结构校验：PE 重定位目录没有「终止块」，加载器按 SizeOfBlock
 * 链式走表直到目录末尾。链中任何 SizeOfBlock=0 或越界的块都会让 XP 拒载
 * （DriverEntry 不执行，StartService 干净失败）。要求：链恰好走满目录尺寸。
 */
function relocChainIsWellFormed(image: Buffer): boolean {
  const peOffset = image.readUInt32LE(0x3c)
  const sizeOfOptionalHeader = image.readUInt16LE(peOffset + 20)
  const optionalHeader = peOffset + 24
  const baserelocDir = optionalHeader + 96 + 5 * 8
  const dirRva = image.readUInt32LE(baserelocDir)
  const dirSize = image.readUInt32LE(baserelocDir + 4)
  if (dirSize === 0) return true
  const numSections = image.readUInt16LE(peOffset + 6)
  const sectionTable = optionalHeader + sizeOfOptionalHeader
  let tableOffset = -1
  for (let i = 0; i < numSections; i++) {
    const s = sectionTable + i * 40
    const va = image.readUInt32LE(s + 12)
    const rawSize = image.readUInt32LE(s + 16)
    if (dirRva >= va && dirRva < va + rawSize) {
      tableOffset = image.readUInt32LE(s + 20) + (dirRva - va)
      break
    }
  }
  if (tableOffset < 0) return false
  let walk = 0
  while (walk < dirSize) {
    if (walk + 8 > dirSize) return false
    const blockSize = image.readUInt32LE(tableOffset + walk + 4)
    if (blockSize < 8 || blockSize % 4 !== 0 || walk + blockSize > dirSize) return false
    walk += blockSize
  }
  return walk === dirSize
}

function buildInto(directory: string): string {
  const result = spawnSync('sh', [BUILD_SCRIPT, directory], { encoding: 'utf8' })
  assert.equal(
    result.status,
    0,
    `build-boxvnt.sh 失败：\n${result.stdout ?? ''}\n${result.stderr ?? ''}`,
  )
  return join(directory, 'boxvideo.sys')
}

/** OW 就绪 = BOXVNT_WATCOM 指向可用树，或默认缓存已建好（首次构建后存在）。 */
function hasOpenWatcom(): boolean {
  const candidates = [
    process.env.BOXVNT_WATCOM,
    join(homedir(), '.cache', 'boxvnt', 'ow-snapshot'),
    join(process.env.XDG_CACHE_HOME ?? '', 'boxvnt', 'ow-snapshot'),
  ].filter((value): value is string => Boolean(value))
  const toolDirs = ['armo64', 'bino64', 'binl64', 'binl']
  for (const root of candidates) {
    if (toolDirs.some((dir) => existsSync(join(root, dir, 'wcc386')))) {
      return true
    }
  }
  return false
}

function buildAndAssert(directory: string): PeInfo {
  const sysPath = buildInto(directory)
  const image = readFileSync(sysPath)
  assert.ok(
    image.length > 0 && image.length <= MAX_SYS_BYTES,
    `驱动体积应 ≤ 200KB，实际 ${image.length} 字节`,
  )
  const pe = parsePe(image)
  assert.equal(pe.machine, 0x14c, 'CPU 架构必须是 i386（XP 32 位）')
  assert.equal(pe.subsystem, 1, '子系统必须是 native（IMAGE_SUBSYSTEM_NATIVE 内核驱动）')
  assert.deepEqual(pe.subsystemVersion, [4, 0], 'SubsystemVersion 必须是 DDK 标准的 4.0（normalize-boxvnt-pe.mjs 改写）')
  assert.notEqual(pe.checksum, 0, '校验和字段非零')
  assert.ok(pe.checksumValid, '校验和必须与 PE 标准算法自洽（跳过规范化步骤会挂这条）')
  assert.notEqual(pe.entryRva, 0, '入口点非零（DriverEntry，NT 驱动无导出表）')
  assert.ok(pe.virtualSizes.every((vs) => vs > 0), '所有节的 VirtualSize 必须非零——wlink 原始产物的 VSize=0 段是 XP 加载蓝屏的嫌疑形态（normalize-boxvnt-pe.mjs 负责消灭）')
  assert.ok(!hasIndirectCallsIntoJumpThunks(image), '禁止 FF 15 间接调用指向 FF 25 跳板槽——wlink 原始产物的自相矛盾导入派发，会把跳板指令字节当地址调用（XP 加载即蓝屏，normalize-boxvnt-pe.mjs 改写为 E8 直调）')
  assert.ok(relocChainIsWellFormed(image), '.reloc 链必须恰好走满目录尺寸——链中的零尺寸/越界块会让 XP 拒载（无蓝屏、DriverEntry 不执行的干净失败，FAILED 2001 现象）')
  assert.ok(pe.imports.length > 0, '导入表为空，构建疑似坏了')
  for (const dll of pe.imports) {
    assert.ok(IMPORT_DLL_WHITELIST.has(dll.toLowerCase()), `导入表出现白名单之外的模块：${dll}`)
  }
  // INF 随产物一起拷出；硬伤 #1/#2（R6/R7）的回归守卫。
  const inf = readFileSync(join(directory, 'vidmini.inf'), 'utf8')
  assert.ok(inf.includes('PCI\\VEN_1234&DEV_1111'), 'INF 必须含 v86 的 PCI 设备 ID')
  assert.ok(inf.includes('boxvideo.sys'), 'INF SourceDisksFiles 必须引用真实产物文件名')
  // 串口黑匣子（vmplog.c）：行头与引导首条 tag 必须编进产物——崩在加载早期时，
  // 宿主 serial0 输出里最后一条 [IVM] 行就是崩溃点（ARCHITECTURE.md triage）。
  assert.ok(image.includes(Buffer.from('[IVM]', 'ascii')), '串口日志行头 [IVM] 必须编进产物')
  assert.ok(image.includes(Buffer.from('VLD1', 'ascii')), '引导首条日志 tag VLD1 必须编进产物')
  return pe
}

function main() {
  if (!hasOpenWatcom()) {
    console.log('SKIP: 未就绪 Open Watcom（先跑一次 scripts/build-boxvnt.sh 建缓存，或设 BOXVNT_WATCOM）')
    return
  }
  const infoA = buildAndAssert(mkdtempSync(join(tmpdir(), 'boxvnt-a-')))
  const infoB = buildAndAssert(mkdtempSync(join(tmpdir(), 'boxvnt-b-')))
  assert.deepEqual(infoB.imports, infoA.imports, '两次编译的导入表不一致')
  assert.deepEqual(infoB.sectionNames, infoA.sectionNames, '两次编译的节表不一致')
  assert.equal(infoB.entryRva, infoA.entryRva, '两次编译的入口点不一致')
  assert.equal(infoB.checksum, infoA.checksum, '两次编译的校验和不一致（源码应决定性）')

  console.log(`boxvnt-binary.test.ts ok (imports=${infoA.imports.join(', ')}, entry=0x${infoA.entryRva.toString(16)})`)
}

main()
