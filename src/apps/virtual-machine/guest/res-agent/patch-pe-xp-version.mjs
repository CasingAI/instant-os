// 把 PE 头的 OS/Subsystem 版本改成 5.01（Windows XP）。
// lld 默认写 6.00；XP 加载器见到 Subsystem 版本 >= 6 的 EXE 会拒绝加载
// （「不是有效的 Win32 应用程序」）。zig cc 不透传 /subsystem:windows,5.01，
// 所以构建脚本在链接后用本脚本补一次头。用法：node patch-pe-xp-version.mjs <file.exe>
import { readFileSync, writeFileSync } from 'node:fs'

const file = process.argv[2]
if (!file) {
  console.error('usage: node patch-pe-xp-version.mjs <file.exe>')
  process.exit(1)
}
const image = readFileSync(file)
if (image.readUInt16LE(0) !== 0x5a4d) {
  throw new Error('not an MZ executable')
}
const peOffset = image.readUInt32LE(0x3c)
if (image.readUInt32LE(peOffset) !== 0x00004550) {
  throw new Error('missing PE signature')
}
const optionalHeader = peOffset + 24
if (image.readUInt16LE(optionalHeader) !== 0x10b) {
  throw new Error('expected PE32 (32-bit) optional header')
}
image.writeUInt16LE(5, optionalHeader + 40) // MajorOperatingSystemVersion
image.writeUInt16LE(1, optionalHeader + 42) // MinorOperatingSystemVersion
image.writeUInt16LE(5, optionalHeader + 48) // MajorSubsystemVersion
image.writeUInt16LE(1, optionalHeader + 50) // MinorSubsystemVersion
writeFileSync(file, image)
