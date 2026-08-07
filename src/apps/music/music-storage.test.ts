/**
 * 音乐曲库元数据纯函数单测（文件名解析 / 增删 / 时长格式化）。
 * 运行：node --experimental-strip-types src/apps/music/music-storage.test.ts
 */
import assert from 'node:assert/strict'
import {
  addTrackToStore,
  formatTrackDuration,
  findTrackInStore,
  isAudioExtension,
  parseMusicFileName,
  removeTrackFromStore,
} from './music-storage.ts'
import type { MusicTrack } from './music-types.ts'

function sampleTrack(overrides: Partial<MusicTrack> = {}): MusicTrack {
  return {
    id: 'music-test-1',
    title: '夜航星',
    artist: '不才',
    fileName: '不才 - 夜航星.mp3',
    extension: 'mp3',
    mimeType: 'audio/mpeg',
    byteSize: 1024,
    durationSec: 214,
    addedAt: 1,
    ...overrides,
  }
}

function testParseMusicFileName(): void {
  assert.deepEqual(parseMusicFileName('不才 - 夜航星.mp3'), {
    title: '夜航星',
    artist: '不才',
    extension: 'mp3',
  })
  assert.deepEqual(parseMusicFileName('周杰伦--晴天.flac'), {
    title: '晴天',
    artist: '周杰伦',
    extension: 'flac',
  })
  assert.deepEqual(parseMusicFileName('纯音乐.mp3'), {
    title: '纯音乐',
    extension: 'mp3',
  })
  assert.equal(parseMusicFileName('纯音乐.mp3').artist, undefined)
  assert.deepEqual(parseMusicFileName('no-extension'), {
    title: 'no-extension',
    extension: '',
  })
  assert.deepEqual(parseMusicFileName('A - B - C.wav'), {
    title: 'B - C',
    artist: 'A',
    extension: 'wav',
  })
  console.log('ok: parseMusicFileName')
}

function testAudioExtension(): void {
  assert.equal(isAudioExtension('mp3'), true)
  assert.equal(isAudioExtension('flac'), true)
  assert.equal(isAudioExtension('MP3'), false) // 解析后统一小写
  assert.equal(isAudioExtension('txt'), false)
  assert.equal(isAudioExtension(undefined), false)
  console.log('ok: isAudioExtension')
}

function testStoreAddRemove(): void {
  const empty = { tracks: [] as MusicTrack[] }
  const one = addTrackToStore(empty, sampleTrack())
  assert.equal(one.tracks.length, 1)
  assert.equal(findTrackInStore(one, 'music-test-1')?.title, '夜航星')
  assert.equal(findTrackInStore(one, 'missing'), undefined)

  // 新歌排在最前
  const two = addTrackToStore(one, sampleTrack({ id: 'music-test-2', title: '第二首' }))
  assert.equal(two.tracks[0].id, 'music-test-2')

  const removed = removeTrackFromStore(two, 'music-test-1')
  assert.equal(removed.tracks.length, 1)
  assert.equal(removed.tracks[0].id, 'music-test-2')
  console.log('ok: store add/remove')
}

function testFormatDuration(): void {
  assert.equal(formatTrackDuration(214), '3:34')
  assert.equal(formatTrackDuration(65), '1:05')
  assert.equal(formatTrackDuration(0), '--:--')
  assert.equal(formatTrackDuration(Number.NaN), '--:--')
  console.log('ok: formatTrackDuration')
}

testParseMusicFileName()
testAudioExtension()
testStoreAddRemove()
testFormatDuration()
