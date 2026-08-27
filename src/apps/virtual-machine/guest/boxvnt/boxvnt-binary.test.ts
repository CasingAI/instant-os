/**
 * boxvideo.sys 产物校验单测（todo/vm-arbitrary-resolution/ §5）。
 * 运行：node --experimental-strip-types src/apps/virtual-machine/guest/boxvnt/boxvnt-binary.test.ts
 *
 * 跑两遍 scripts/build-boxvnt.sh，对产物做 PE 结构断言：
 *   MZ/PE 签名 → PE32 (0x10b) → i386 → native 子系统（内核驱动）
 *   → 校验和字段非零（wlink option checksum）→ 入口点非零
 *   → 导入表只含 VIDEOPRT.SYS → 体积 < 200KB。
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
  checksum: number
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
    checksum: image.readUInt32LE(optionalHeader + 64),
    entryRva: image.readUInt32LE(optionalHeader + 16),
    sectionNames,
    imports,
  }
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
  assert.notEqual(pe.checksum, 0, '校验和字段非零（wlink option checksum）')
  assert.notEqual(pe.entryRva, 0, '入口点非零（DriverEntry，NT 驱动无导出表）')
  assert.ok(pe.imports.length > 0, '导入表为空，构建疑似坏了')
  for (const dll of pe.imports) {
    assert.ok(IMPORT_DLL_WHITELIST.has(dll.toLowerCase()), `导入表出现白名单之外的模块：${dll}`)
  }
  // INF 随产物一起拷出；硬伤 #1/#2（R6/R7）的回归守卫。
  const inf = readFileSync(join(directory, 'vidmini.inf'), 'utf8')
  assert.ok(inf.includes('PCI\\VEN_1234&DEV_1111'), 'INF 必须含 v86 的 PCI 设备 ID')
  assert.ok(inf.includes('boxvideo.sys'), 'INF SourceDisksFiles 必须引用真实产物文件名')
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
