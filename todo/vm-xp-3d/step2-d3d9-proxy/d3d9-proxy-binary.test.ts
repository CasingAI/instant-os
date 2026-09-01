/**
 * d3d9-proxy.dll 产物校验单测。
 * 运行：node --experimental-strip-types todo/vm-xp-3d/step2-d3d9-proxy/d3d9-proxy-binary.test.ts
 *
 * 跑 build-d3d9-proxy.sh，对产物做 PE 结构断言：
 *   MZ/PE 签名 → PE32 (0x10b) → i386 → GUI 子系统 → OS/Subsystem 版本 5.01
 *   → 导入表只含 XP 裸机自带的 kernel32/user32 → 导出表恰好一个无修饰名
 *   Direct3DCreate9（patch-export-kill-at.mjs 的成果，XP GetProcAddress 按此查找）
 *   → 体积 < 100KB。
 * 环境里没有 zig 时跳过（exit 0），不阻塞无工具链的机器。
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const BUILD_SCRIPT = join(HERE, 'build-d3d9-proxy.sh')
const OUT_DLL = join(HERE, 'out', 'd3d9-proxy.dll')

/** XP 裸机必须自带的导入白名单（比较忽略大小写与 .dll 后缀）。 */
const IMPORT_DLL_WHITELIST = new Set(['kernel32', 'user32'])
const MAX_DLL_BYTES = 100 * 1024

interface PeInfo {
  machine: number
  subsystem: number
  osVersion: string
  subsystemVersion: string
  imports: string[]
  exports: string[]
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
  for (let i = 0; i < numSections; i++) {
    const s = sectionTable + i * 40
    sections.push({
      va: image.readUInt32LE(s + 12),
      span: Math.max(image.readUInt32LE(s + 8), image.readUInt32LE(s + 16)),
      ptr: image.readUInt32LE(s + 20),
    })
  }
  const rvaToOffset = (rva: number): number => {
    for (const section of sections) {
      if (rva >= section.va && rva < section.va + section.span) {
        return rva - section.va + section.ptr
      }
    }
    throw new Error(`RVA 0x${rva.toString(16)} 不在任何节内`)
  }

  // 导入表
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

  // 导出表（数据目录[0]）：名字必须无 @n 修饰，否则 XP 的 GetProcAddress 查不到
  const exportDirRva = image.readUInt32LE(optionalHeader + 96)
  const exports: string[] = []
  if (exportDirRva > 0) {
    const exportDir = rvaToOffset(exportDirRva)
    const numberOfNames = image.readUInt32LE(exportDir + 24)
    const namesOff = rvaToOffset(image.readUInt32LE(exportDir + 32))
    for (let i = 0; i < numberOfNames; i++) {
      const nameOff = rvaToOffset(image.readUInt32LE(namesOff + i * 4))
      let end = nameOff
      while (end < image.length && image[end] !== 0) {
        end++
      }
      exports.push(image.toString('ascii', nameOff, end))
    }
  }

  return {
    machine: image.readUInt16LE(peOffset + 4),
    subsystem: image.readUInt16LE(optionalHeader + 68),
    osVersion: `${image.readUInt16LE(optionalHeader + 40)}.${image.readUInt16LE(optionalHeader + 42)}`,
    subsystemVersion: `${image.readUInt16LE(optionalHeader + 48)}.${image.readUInt16LE(optionalHeader + 50)}`,
    imports,
    exports,
  }
}

function hasZig(): boolean {
  return spawnSync('zig', ['version'], { encoding: 'utf8' }).status === 0
}

function testProxyDll(): void {
  const build = spawnSync('sh', [BUILD_SCRIPT], { encoding: 'utf8' })
  assert.equal(build.status, 0, `build-d3d9-proxy.sh 失败：\n${build.stdout ?? ''}\n${build.stderr ?? ''}`)
  const image = readFileSync(OUT_DLL)
  assert.ok(image.length > 0 && image.length <= MAX_DLL_BYTES, `DLL 体积应 ≤ 100KB，实际 ${image.length} 字节`)

  const pe = parsePe(image)
  assert.equal(pe.machine, 0x14c, 'CPU 架构必须是 i386（XP 32 位）')
  assert.equal(pe.subsystem, 2, '必须是 GUI 子系统（d3d9.dll 不带控制台）')
  assert.equal(pe.osVersion, '5.1', 'OS 版本必须是 5.1（XP 加载器门槛）')
  assert.equal(pe.subsystemVersion, '5.1', 'Subsystem 版本必须是 5.1')
  const normalized = pe.imports.map((name) => name.toLowerCase().replace(/\.dll$/, ''))
  for (const name of normalized) {
    assert.ok(IMPORT_DLL_WHITELIST.has(name), `导入表出现白名单外的 DLL：${name}`)
  }
  assert.deepEqual(pe.exports, ['Direct3DCreate9'], '导出表必须恰好是无修饰名 Direct3DCreate9')
}

if (!hasZig()) {
  console.log('zig 不可用，跳过 d3d9-proxy.dll 产物校验')
} else {
  testProxyDll()
  console.log('d3d9-proxy-binary.test.ts: 全部断言通过')
}
