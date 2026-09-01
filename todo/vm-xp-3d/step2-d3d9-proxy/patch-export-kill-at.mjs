// 把 DLL 导出表里的 stdcall 修饰名就地截短：Direct3DCreate9@4 → Direct3DCreate9。
// zig 0.16 的 lld-link 不支持 --kill-at / /EXPORT: / .def（三条正名路线实测全堵死），
// dllexport stdcall 必然导出带 @n 的名字，XP 的 GetProcAddress("Direct3DCreate9")
// 查不到。名字串是 NUL 结尾独立串，就地截短安全（长度不存于表内）。
// 用法：node patch-export-kill-at.mjs <file.dll>
import { readFileSync, writeFileSync } from 'node:fs'

const file = process.argv[2]
if (!file) {
  console.error('usage: node patch-export-kill-at.mjs <file.dll>')
  process.exit(1)
}
const image = readFileSync(file)
if (image.readUInt16LE(0) !== 0x5a4d) throw new Error('not an MZ executable')
const peOffset = image.readUInt32LE(0x3c)
if (image.readUInt32LE(peOffset) !== 0x00004550) throw new Error('missing PE signature')
const coff = peOffset + 4
const numSections = image.readUInt16LE(coff + 2)
const optionalSize = image.readUInt16LE(coff + 16)
const optionalHeader = coff + 20
if (image.readUInt16LE(optionalHeader) !== 0x10b) throw new Error('expected PE32 optional header')

// RVA → 文件偏移：遍历段表找包含该 RVA 的段（PointerToRawData + RVA - VirtualAddress）
const sections = []
for (let i = 0; i < numSections; i++) {
  const s = optionalHeader + optionalSize + i * 40
  sections.push({
    vaddr: image.readUInt32LE(s + 12),
    vsize: image.readUInt32LE(s + 8),
    raw: image.readUInt32LE(s + 20),
  })
}
function rvaToOffset(rva) {
  for (const sec of sections) {
    if (rva >= sec.vaddr && rva < sec.vaddr + Math.max(sec.vsize, 1)) {
      return sec.raw + (rva - sec.vaddr)
    }
  }
  throw new Error('rva not in any section: 0x' + rva.toString(16))
}

const exportDirRva = image.readUInt32LE(optionalHeader + 96) // 数据目录[0] = Export
if (exportDirRva === 0) throw new Error('no export directory')
const exportDir = rvaToOffset(exportDirRva)
const numberOfNames = image.readUInt32LE(exportDir + 24)
const namesRva = image.readUInt32LE(exportDir + 32)
const names = rvaToOffset(namesRva)

let patched = 0
for (let i = 0; i < numberOfNames; i++) {
  const nameOff = rvaToOffset(image.readUInt32LE(names + i * 4))
  let end = nameOff
  while (image[end] !== 0) end++
  const name = image.toString('latin1', nameOff, end)
  const m = name.match(/^(.+)@\d+$/)
  if (!m) continue
  image.write(m[1] + '\0', nameOff, 'latin1')
  console.log(`export #${i}: ${name} -> ${m[1]}`)
  patched++
}
if (patched === 0) throw new Error('no decorated export name found - nothing to patch')
writeFileSync(file, image)
console.log(`patched ${patched} export name(s) in ${file}`)
