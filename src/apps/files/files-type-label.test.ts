/**
 * 文件列表「类型」列标签纯函数单测。
 * 运行：node --experimental-strip-types src/apps/files/files-type-label.test.ts
 */
import assert from 'node:assert/strict'
import { filesTypeLabel } from './files-type-label.ts'

function testKindFirst(): void {
  // 种类优先于后缀：文件夹 / 应用包 / 符号链接不看扩展名
  assert.equal(filesTypeLabel('folder', '照片'), '文件夹')
  assert.equal(filesTypeLabel('folder', 'backup.img'), '文件夹')
  assert.equal(filesTypeLabel('folder', 'weather.app'), '应用程序')
  assert.equal(filesTypeLabel('symlink', 'alias.png'), '符号链接')
  console.log('ok: 种类优先')
}

function testDiskImage(): void {
  assert.equal(filesTypeLabel('file', 'win98.img'), '虚拟硬盘')
  assert.equal(filesTypeLabel('file', 'FLOPPY.IMA'), '虚拟硬盘')
  assert.equal(filesTypeLabel('file', 'disk.raw'), '虚拟硬盘')
  console.log('ok: 磁盘镜像')
}

function testExtensionCategories(): void {
  assert.equal(filesTypeLabel('file', '头像.png'), '图片')
  assert.equal(filesTypeLabel('file', '扫描件.HEIC'), '图片')
  assert.equal(filesTypeLabel('file', '主题曲.mp3'), '音频')
  assert.equal(filesTypeLabel('file', '歌词.lrc'), '歌词')
  assert.equal(filesTypeLabel('file', '演示.mp4'), '视频')
  assert.equal(filesTypeLabel('file', '角色.glb'), '3D 模型')
  assert.equal(filesTypeLabel('file', '备份.zip'), '压缩包')
  assert.equal(filesTypeLabel('file', '归档.tar.gz'), '压缩包')
  assert.equal(filesTypeLabel('file', '首页.html'), '网页')
  assert.equal(filesTypeLabel('file', '备忘.txt'), '文本')
  assert.equal(filesTypeLabel('file', '说明.md'), 'Markdown')
  assert.equal(filesTypeLabel('file', '海报.pages'), '文稿')
  assert.equal(filesTypeLabel('file', '报告.docx'), '文档')
  console.log('ok: 扩展名归类')
}

function testSourceAndFallback(): void {
  assert.equal(filesTypeLabel('file', 'main.ts'), '源代码')
  assert.equal(filesTypeLabel('file', 'config.json'), '源代码')
  // 无后缀 / 未识别 → 文件
  assert.equal(filesTypeLabel('file', 'Makefile'), '文件')
  assert.equal(filesTypeLabel('file', 'logo.xyz'), '文件')
  console.log('ok: 源代码与兜底')
}

testKindFirst()
testDiskImage()
testExtensionCategories()
testSourceAndFallback()
console.log('files-type-label tests passed')
