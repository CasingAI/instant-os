/**
 * 音乐 App 工具纯函数单测（文件名解析 / 后缀判断 / 时长格式化）。
 * 运行：node --experimental-strip-types src/apps/music/music-storage.test.ts
 */
import assert from 'node:assert/strict'
import {
  formatTrackDuration,
  isAudioExtension,
  isLyricsExtension,
  parseMusicFileName,
} from './music-storage.ts'

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

function testLyricsExtension(): void {
  assert.equal(isLyricsExtension('lrc'), true)
  assert.equal(isLyricsExtension('LRC'), false)
  assert.equal(isLyricsExtension('txt'), false)
  console.log('ok: isLyricsExtension')
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
testLyricsExtension()
testFormatDuration()
