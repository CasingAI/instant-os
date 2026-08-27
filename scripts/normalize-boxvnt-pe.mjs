/**
 * boxvideo.sys 链接后 PE 规范化（todo/vm-arbitrary-resolution/ BSOD 排查产物）。
 *
 * 背景：OW 2.0 beta（2026 快照）wlink 的 PE 产出从未在真实 XP 上验证过
 * （上游 2014 年用 OW 1.9 产出并在 XP 验证）。排查发现其产物带三个
 * VirtualSize=0 的段（.reloc/.rsrc/.rdata）且 SubsystemVersion=1.0——
 * 与 DDK/老 OW 时代的 XP 实证形态不符，XP 加载路径在 DriverEntry 之前
 * 蓝屏（STOP 0x50，驱动第一条指令从未执行）。
 *
 * 本脚本把镜像改写成 MS DDK 工具链的保守形态，其余字节原样保留：
 *   1. 每个段 VirtualSize = max(VirtualSize, SizeOfRawData)（消灭 VSize=0）
 *   2. SubsystemVersion 1.0 → 4.0（DDK 对 /subsystem:native 驱动的标准值）
 *   3. 重写导入派发：`call [跳板槽]` → `call rel32 跳板`（见下）
 *   4. 按 PE 标准算法重算 CheckSum
 *
 * 背景（步骤 3）：OW 2.0 beta wlink 把 import 调用生成为
 * `call dword ptr [绝对地址]`，绝对地址指向 TRANSFER CODE 段的 6 字节跳板；
 * 但跳板内容是 jmp 指令字节（FF 25 <IAT>），加载器解析的 IAT 又在别处
 * （.idata 的 FirstThunk）。于是 `call [跳板]` 把"FF 25 xx"指令字节当地址
 * 执行——XP 加载本驱动后第一条 import 调用即跳进垃圾地址蓝屏
 * （五轮崩溃 IP 低 24 位 0x8025FF/0x8825FF = 跳板槽原始字节的指纹）。
 * 跳板本身自洽（jmp [base+IAT_RVA]，操作数重定位正确，IAT 由加载器解析），
 * 所以把间接调用改成 E8 直调跳板 + 删除失效的操作数重定位项即可修复。
 * 纯函数式、确定性：同输入必得同输出（boxvnt-binary.test.ts 的等价断言依赖此）。
 */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'

const [input, output] = process.argv.slice(2)
assert.ok(input && output, '用法: normalize-boxvnt-pe.mjs <in.sys> <out.sys>')

const image = readFileSync(input)
assert.equal(image.readUInt16LE(0), 0x5a4d, '缺 MZ 签名')
const peOffset = image.readUInt32LE(0x3c)
assert.equal(image.readUInt32LE(peOffset), 0x00004550, '缺 PE 签名')
const numSections = image.readUInt16LE(peOffset + 6)
const sizeOfOptionalHeader = image.readUInt16LE(peOffset + 20)
const optionalHeader = peOffset + 24
assert.equal(image.readUInt16LE(optionalHeader), 0x10b, '必须是 PE32')
assert.equal(image.readUInt16LE(peOffset + 4), 0x14c, '必须是 i386')
assert.equal(image.readUInt16LE(optionalHeader + 68), 1, '子系统必须是 native')

const characteristics = image.readUInt16LE(peOffset + 22)
assert.ok(characteristics & 0x0002, '缺 IMAGE_FILE_EXECUTABLE_IMAGE 特征位')

const checksumFieldOffset = optionalHeader + 64
const sectionTable = optionalHeader + sizeOfOptionalHeader

const sections = []
for (let i = 0; i < numSections; i++) {
  const s = sectionTable + i * 40
  sections.push({
    name: image.toString('ascii', s, s + 8).replace(/\0.*$/, ''),
    va: image.readUInt32LE(s + 12),
    vSize: image.readUInt32LE(s + 8),
    ptr: image.readUInt32LE(s + 20),
    rawSize: image.readUInt32LE(s + 16),
    chars: image.readUInt32LE(s + 36),
  })
}

const changes = []

// 1. 段 VirtualSize = max(VirtualSize, SizeOfRawData)
for (let i = 0; i < numSections; i++) {
  const s = sectionTable + i * 40
  const name = image.toString('ascii', s, s + 8).replace(/\0.*$/, '')
  const virtualSize = image.readUInt32LE(s + 8)
  const rawSize = image.readUInt32LE(s + 16)
  const merged = Math.max(virtualSize, rawSize)
  if (merged !== virtualSize) {
    image.writeUInt32LE(merged, s + 8)
    changes.push(`段 ${name || `#${i}`}: VirtualSize 0x${virtualSize.toString(16)} → 0x${merged.toString(16)}`)
  }
}

// 2. SubsystemVersion → 4.0（DDK 对 native 驱动的标准值）
// PE32 布局：+40 OSVersion、+44 ImageVersion、+48 SubsystemVersion（别落在
// +28 ImageBase 上——偏移错一位就把首选基址改成 4，镜像直接报废）。
const subVerOffset = optionalHeader + 48
const [major, minor] = [image.readUInt16LE(subVerOffset), image.readUInt16LE(subVerOffset + 2)]
if (major !== 4 || minor !== 0) {
  image.writeUInt16LE(4, subVerOffset)
  image.writeUInt16LE(0, subVerOffset + 2)
  changes.push(`SubsystemVersion ${major}.${minor} → 4.0`)
}

// 3. 导入派发改写（FF 15 间接调用跳板 → E8 直调跳板），并同步重建 .reloc 表。
const imageBase = image.readUInt32LE(optionalHeader + 28)
const sectionAt = (rva) =>
  sections.find((s) => s.rawSize > 0 && rva >= s.va && rva < s.va + s.rawSize)
const rvaToFileOffset = (rva) => {
  const s = sectionAt(rva)
  return s === undefined ? undefined : s.ptr + (rva - s.va)
}

const codeSections = sections.filter((s) => s.rawSize > 0 && (s.chars & 0x60000000) === 0x60000000)
// 跳板槽 = 所有 FF 15 操作数指向的目标（TRANSFER CODE 段），先收集再校验。
const stubRvas = new Set()
for (const s of codeSections) {
  for (let off = 0; off + 6 <= s.rawSize; off++) {
    if (image[s.ptr + off] !== 0xff || image[s.ptr + off + 1] !== 0x15) continue
    const disp = image.readUInt32LE(s.ptr + off + 2)
    stubRvas.add(disp - imageBase)
  }
}
const stubList = [...stubRvas].sort((a, b) => a - b)
// 真跳板校验：目标处必须是 jmp 指令字节（FF 25）——排除误入的随机 FF 15。
const validStubRvas = new Set(
  stubList.filter((rva) => {
    const fo = rvaToFileOffset(rva)
    return fo !== undefined && image[fo] === 0xff && image[fo + 1] === 0x25
  }),
)

const removedOperandRvas = new Set()
let rewrittenCalls = 0
for (const s of codeSections) {
  for (let off = 0; off + 6 <= s.rawSize; off++) {
    const insnRva = s.va + off
    if (image[s.ptr + off] !== 0xff || image[s.ptr + off + 1] !== 0x15) continue
    const stubRva = image.readUInt32LE(s.ptr + off + 2) - imageBase
    if (!validStubRvas.has(stubRva)) continue
    const rel = stubRva - (insnRva + 5)
    if (rel < -0x80000000 || rel > 0x7fffffff) {
      throw new Error(`E8 rel32 溢出：insn=${insnRva} stub=${stubRva}`)
    }
    image[s.ptr + off] = 0xe8
    image.writeInt32LE(rel, s.ptr + off + 1)
    image[s.ptr + off + 5] = 0x90
    removedOperandRvas.add(insnRva + 2)
    rewrittenCalls++
  }
}
if (rewrittenCalls > 0) {
  // 重建 .reloc：剔除已失效的操作数项（E8 rel32 不得再被加载器加 delta）。
  const baserelocDir = optionalHeader + 96 + 5 * 8
  const relRva = image.readUInt32LE(baserelocDir)
  const relSize = image.readUInt32LE(baserelocDir + 4)
  const relFo = rvaToFileOffset(relRva)
  const kept = []
  let walk = relFo
  const walkEnd = relFo + relSize
  while (walk + 8 <= walkEnd) {
    const page = image.readUInt32LE(walk)
    const blockSize = image.readUInt32LE(walk + 4)
    if (blockSize < 8 || walk + blockSize > walkEnd) break
    for (let e = 8; e + 2 <= blockSize; e += 2) {
      const entry = image.readUInt16LE(walk + e)
      const type = entry >> 12
      const targetRva = page + (entry & 0xfff)
      if (type !== 0 && !removedOperandRvas.has(targetRva)) {
        kept.push({ page, type, off: entry & 0xfff })
      }
    }
    walk += blockSize
  }
  const dropped = removedOperandRvas.size
  kept.sort((a, b) => a.page - b.page || a.off - b.off)
  let w = relFo
  let curPage = -1
  let blockStart = -1
  let count = 0
  const flush = () => {
    if (blockStart < 0) return
    if (count % 2 === 1) {
      image.writeUInt16LE(0, w)
      w += 2
      count++
    }
    image.writeUInt32LE(curPage, blockStart)
    image.writeUInt32LE(8 + count * 2, blockStart + 4)
    blockStart = -1
  }
  for (const { page, type, off } of kept) {
    if (page !== curPage || blockStart < 0) {
      flush()
      curPage = page
      blockStart = w
      w += 8
      count = 0
    }
    image.writeUInt16LE((type << 12) | off, w)
    w += 2
    count++
  }
  flush()
  image.writeUInt32LE(0, w) // 终止块头（page=0,size=0）
  image.writeUInt32LE(0, w + 4)
  w += 8
  if (w > relFo + relSize) {
    throw new Error('重建的 .reloc 表超过原尺寸——不应发生（只减不增）')
  }
  while (w < relFo + relSize) image[w++] = 0
  image.writeUInt32LE(w - relFo, baserelocDir + 4)
  changes.push(`导入派发 ${rewrittenCalls} 处 FF 15 → E8 直调跳板；.reloc 剔除 ${dropped} 项失效操作数并重建`)
}

// 4. PE 标准校验和：16 位字求和进位折叠，校验和字段本身按 0 参与，最后加文件长度
image.writeUInt32LE(0, checksumFieldOffset)
let sum = 0
const padded = image.length + (image.length % 2)
for (let offset = 0; offset < padded; offset += 2) {
  sum += offset + 1 < image.length ? image.readUInt16LE(offset) : image[offset]
  sum = (sum & 0xffff) + (sum >> 16)
}
sum = (sum & 0xffff) + (sum >> 16)
image.writeUInt32LE((sum + image.length) >>> 0, checksumFieldOffset)
changes.push('CheckSum 已按 PE 标准算法重算')

writeFileSync(output, image)
console.log(`normalized: ${output} (${image.length} bytes)`)
for (const line of changes) {
  console.log(`  - ${line}`)
}
