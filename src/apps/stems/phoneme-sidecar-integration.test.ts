/**
 * 旁存 sidecar 保存/载入链路集成验证：
 * 用与 App 完全相同的 files-api 调用链（filesStat → filesCreateText → 再 filesStat → filesReadText），
 * 验证「识别后保存 → 重开载入」在真实 VFS 上往返成立。
 * 运行：node --experimental-strip-types src/apps/stems/phoneme-sidecar-integration.test.ts
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { filesCreateBinary, filesCreateText, filesMkdir, filesReadText, filesStat } from '../files/files-api.ts'
import { resolveNodeByAbsolutePath } from '../files/files-vfs.ts'
import { resetFilesDbForTests } from '../files/files-storage.ts'
import { invalidateFilesVfsPathCaches } from '../files/files-vfs.ts'
import {
  buildPhonemeSidecarText,
  parsePhonemeSidecarText,
  phonemeSidecarPath,
} from './phoneme-align-workspace.ts'
import type { AlignedPhone } from './phoneme-types.ts'

async function resetState(): Promise<void> {
  await resetFilesDbForTests()
  invalidateFilesVfsPathCaches()
}

/** 与 phoneme-app.tsx writeTextOrCreate 完全一致 */
async function writeTextOrCreate(path: string, text: string): Promise<void> {
  const existing = await filesStat(path)
  if (existing === undefined) {
    await filesCreateText(path, text)
    return
  }
  if (existing.kind !== 'file') {
    throw new Error(`路径冲突：${path} 不是文件`)
  }
  await filesWriteText(path, text)
}

// 需要真实 filesWriteText
import { filesWriteText } from '../files/files-api.ts'

function makePhones(): AlignedPhone[] {
  return [
    { symbol: 'tɕ', start: 0.1, end: 0.24 },
    { symbol: 'i', start: 0.24, end: 0.42 },
    { symbol: 'n', start: 0.42, end: 0.6 },
    { symbol: '<pad>', start: 0.6, end: 0.8 },
  ]
}

async function testRoundTrip(): Promise<void> {
  await resetState()
  // 造目录与「音频文件」（Musics 是用户标准文件夹，可能已存在）
  if ((await filesStat('/user/Musics')) === undefined) {
    await filesMkdir('/user/Musics')
  }
  await filesCreateBinary('/user/Musics/test.wav', new Uint8Array([1, 2, 3]))

  const audioPath = '/user/Musics/test.wav'
  const sidecarPath = phonemeSidecarPath(audioPath)
  assert.equal(sidecarPath, '/user/Musics/test.phones.tsv')

  // —— 第一次打开：旁存不存在 → 走识别 ——
  assert.equal(await filesStat(sidecarPath), undefined)

  // —— 识别完成 → 保存（App 内 savePhonemeSidecar 的调用链）——
  const phoneList = makePhones()
  await writeTextOrCreate(
    sidecarPath,
    buildPhonemeSidecarText({ duration: 3.2, sampleRate: 16000, provider: 'onnx', phoneList }),
  )

  // —— 第二次打开：旁存应直接命中（App 内 handlePickFile 的调用链）——
  const existing = await filesStat(sidecarPath)
  assert.ok(existing, '旁存文件应存在')
  assert.equal(existing.kind, 'file')
  const parsed = parsePhonemeSidecarText(await filesReadText(sidecarPath))
  assert.ok(parsed.phones.length > 0, '旁存应解析出音素')
  // <pad> 被跳（buildPhonemeWorkspaceFiles 过滤空拼音）
  assert.equal(parsed.phones.length, 3)
  assert.equal(parsed.phones[0].symbol, 'tɕ')
  assert.equal(parsed.duration, 3.2)
  assert.equal(parsed.sampleRate, 16000)

  // —— 覆盖保存（再次识别）也应成功 ——
  await writeTextOrCreate(sidecarPath, buildPhonemeSidecarText({ phoneList: [] }))
  const after = parsePhonemeSidecarText(await filesReadText(sidecarPath))
  assert.equal(after.phones.length, 0)
}

async function runAll(): Promise<void> {
  await testRoundTrip()
  console.log('phoneme-sidecar-integration: 全部通过')
}

runAll().catch((error) => {
  console.error(error)
  process.exit(1)
})
