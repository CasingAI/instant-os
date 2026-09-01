/**
 * ivm-agent.exe 产物校验单测。
 * 运行：node --experimental-strip-types src/apps/virtual-machine/guest/ivm-agent/ivm-agent-binary.test.ts
 *
 * 跑两遍 scripts/build-ivm-agent.sh，对产物做 PE 结构断言：
 *   MZ/PE 签名 → PE32 (0x10b) → i386 → GUI 子系统 → OS/Subsystem 版本 5.01
 *   → 导入表只含白名单 DLL（kernel32/user32/gdi32/advapi32/ole32）→ 体积 < 300KB。
 * 再校验两次独立编译结构等价：zig 的 lld-link 会往 PE 里嵌时间戳，且 zig 拒收
 * -brepro/--timestamp 链接参数，「可重现」只能做到结构等价这一级（见 Makefile 注释）。
 * 环境里没有 zig 时跳过（exit 0），不阻塞无工具链的 CI。
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const AGENT_DIR = dirname(fileURLToPath(import.meta.url))
const BUILD_SCRIPT = join(AGENT_DIR, '..', '..', '..', '..', '..', 'scripts', 'build-ivm-agent.sh')
const GUEST_DIR = join(AGENT_DIR, '..')

/** 导入表白名单：XP 裸机上必须都自带。比较时忽略大小写与 .dll 后缀。
 * kernel32/user32/gdi32：COM1 遥控 + 显示模式切换；advapi32：服务/注册表
 * （关机特权 + 服务调度器 + vmmouse 过滤驱动注册）；ole32/shell32/oleaut32：
 * OLE 剪贴板桥 + 目标文件夹探测/浏览对话框 + BSTR 辅助。 */
const IMPORT_DLL_WHITELIST = new Set(['kernel32', 'user32', 'gdi32', 'advapi32', 'ole32', 'shell32', 'oleaut32'])

const MAX_EXE_BYTES = 300 * 1024

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

  // 节表：导入表里的名字是 RVA，要换算成文件偏移才能读到。
  const sectionTable = optionalHeader + sizeOfOptionalHeader
  const sections: { va: number; span: number; ptr: number }[] = []
  const sectionNames: string[] = []
  for (let i = 0; i < numSections; i++) {
    const s = sectionTable + i * 40
    const virtualAddress = image.readUInt32LE(s + 12)
    sections.push({
      va: virtualAddress,
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
    `build-ivm-agent.sh 失败：\n${result.stdout ?? ''}\n${result.stderr ?? ''}`,
  )
  return readFileSync(join(directory, 'ivm-agent.exe'))
}

function hasZig(): boolean {
  return spawnSync('zig', ['version'], { encoding: 'utf8' }).status === 0
}

function buildAndAssert(directory: string): PeInfo {
  const image = buildInto(directory)
  assert.ok(
    image.length > 0 && image.length <= MAX_EXE_BYTES,
    `EXE 体积应 ≤ 300KB，实际 ${image.length} 字节`,
  )
  const pe = parsePe(image)
  assert.equal(pe.machine, 0x14c, 'CPU 架构必须是 i386（XP 32 位）')
  assert.equal(pe.subsystem, 2, '子系统必须是 GUI（开机自启不闪控制台）')
  assert.equal(pe.osVersion, '5.1', 'OS 版本必须补成 5.01（patch-pe-xp-version.mjs 的目标值）')
  assert.equal(
    pe.subsystemVersion,
    '5.1',
    'Subsystem 版本必须补成 5.01：XP 加载器见到 >= 6 直接拒绝加载',
  )
  assert.notEqual(pe.entryRva, 0, '入口点不能为 0（-nostdlib 自定义入口 ivm_agent_entry）')
  assert.ok(pe.imports.length > 0, '导入表为空，构建疑似坏了')
  for (const dll of pe.imports) {
    const base = dll.replace(/\.dll$/i, '').toLowerCase()
    assert.ok(IMPORT_DLL_WHITELIST.has(base), `导入表出现白名单之外的 DLL：${dll}`)
  }
  // 入口/职责关键字符串必须在产物里：2026-08 事故——源码已加 /mouse-install
  // 分发、产物还是旧构建，bat 调用静默失败还误报成功（build/collect 脚本
  // 有同款防呆，这里在单测层再兜一道）。
  for (const marker of [
    'mouse-install',
    'mouse-check',
    'audio-install',
    'audio-uninstall',
    'audio-check',
    'autostart',
    'VMware Pointing Device',
    'ctlsb16',
    'IVMSnapPreview',
    'InstantVM\\SharedFolder',
  ]) {
    assert.ok(image.includes(marker), `产物缺少关键字符串 "${marker}"（旧构建或链接丢了入口分发）`)
  }
  return pe
}

function main() {
  if (!hasZig()) {
    console.log('SKIP: 未安装 zig（brew install zig），ivm-agent 产物校验只在装了工具链的环境跑')
    return
  }
  // 行数守卫：res-agent v3 放宽到 800，并入合并入口后放宽到 900，v5 加
  // OP_SNAP_EDGE 分发后放宽到 950；剪贴板桥 v4 放宽到 1700（v5 加共享文
  // 件夹收敛钩子一行）；v8 改为桥接管方案（空 CF_HDROP + 目标路径探测 +
  // XP 进度对话框 + 自写文件引擎）放宽到 1900；鼠标安装助手（安装+/
  // mouse-check 诊断+自愈三职责）放宽到 500；声卡驱动助手（三职责+就地提
  // 取+显式自建设备+/audio-uninstall 回滚，v6 加服务解禁+回滚标记+
  // self-heal 冻结，v7 再加根实例 LogConf 启动资源补写）放宽到 950；
  // Aero Snap（钩子+吸附表+预览窗+热键+开关+排查期文件日志）放宽到 800，
  // v7 加注册表中继（读写助手+WM_TIMER 收敛+apply 提取）放宽到 900；共
  // 享文件夹（注册表轮询+幂等 net use 收敛+日志）放宽到 300。
  const sourceLines = (path: string, limit: number, label: string) => {
    const lines = readFileSync(join(GUEST_DIR, path), 'utf8').split('\n').length
    assert.ok(lines < limit, `${label} 应保持 < ${limit} 行，当前 ${lines} 行`)
  }
  sourceLines('res-agent/res-agent.c', 950, 'res-agent.c')
  sourceLines('clipboard-bridge/clipboard-bridge.c', 1900, 'clipboard-bridge.c')
  sourceLines('ivm-agent/ivm-mouse-install.c', 500, 'ivm-mouse-install.c')
  sourceLines('ivm-agent/ivm-audio-install.c', 950, 'ivm-audio-install.c')
  sourceLines('ivm-agent/ivm-aero-snap.c', 900, 'ivm-aero-snap.c')
  sourceLines('ivm-agent/ivm-shared-folder.c', 300, 'ivm-shared-folder.c')

  // 两次独立编译：第一次拿属性基线，第二次验证可重现性。
  const infoA = buildAndAssert(mkdtempSync(join(tmpdir(), 'ivm-agent-a-')))
  const infoB = buildAndAssert(mkdtempSync(join(tmpdir(), 'ivm-agent-b-')))
  assert.deepEqual(infoB.imports, infoA.imports, '两次编译的导入表不一致')
  assert.deepEqual(infoB.sectionNames, infoA.sectionNames, '两次编译的节表不一致')
  assert.deepEqual(infoB.osVersion, infoA.osVersion, '两次编译的 OS 版本不一致')
  assert.deepEqual(infoB.subsystemVersion, infoA.subsystemVersion, '两次编译的 Subsystem 版本不一致')
  // 合并断言：三条职责链依赖的 DLL 必须真实出现在导入表（链接丢了会在实机才暴雷）。
  const importBases = infoA.imports.map((dll) => dll.replace(/\.dll$/i, '').toLowerCase())
  for (const required of ['kernel32', 'user32', 'advapi32', 'ole32']) {
    assert.ok(importBases.includes(required), `导入表缺少依赖 ${required}：${infoA.imports.join(', ')}`)
  }

  console.log(`ivm-agent-binary.test.ts ok (${infoA.imports.join(', ')})`)
}

main()
