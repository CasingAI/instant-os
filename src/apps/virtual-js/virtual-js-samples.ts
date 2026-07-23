export type VirtualJsSample = {
  id: string
  title: string
  blurb: string
  source: string
}

/**
 * 用例约定（同一 QuickJS 实例可反复点「运行」）：
 * - 脚本用例包在 IIFE 里，避免 const/let 污染全局、也避免 ASI 把 ({…}) 当成函数调用
 * - 需要测「全局保持」的用例除外
 * - ESM 用例保持顶层 import/export（每次 eval 已用独立文件名）
 */
export const VIRTUAL_JS_SAMPLES: VirtualJsSample[] = [
  {
    id: 'path-require',
    title: 'path · require',
    blurb: 'require("path") / node:path；join / dirname / extname',
    source: `(function () {
  var path = require('path')
  var viaNode = require('node:path')

  console.log('same object?', path === viaNode)
  console.log('sep', path.sep, 'delimiter', path.delimiter)
  console.log('join', path.join('/user', 'docs', 'a.txt'))
  console.log('dirname', path.dirname('/user/docs/a.txt'))
  console.log('basename', path.basename('/user/docs/a.txt', '.txt'))
  console.log('extname', path.extname('archive.tar.gz'))
  console.log('isAbsolute', path.isAbsolute('/x'), path.isAbsolute('x'))

  return path.join(process.cwd(), 'out')
})()
`,
  },
  {
    id: 'path-import',
    title: 'path · import',
    blurb: 'ESM import；结果区优先看 default',
    source: `import path from 'path'
import { join, resolve } from 'node:path'

var cwd = process.cwd()
var joined = join(cwd, 'docs', 'readme.md')
process.stdout.write('joined=' + joined)

export default {
  cwd: cwd,
  joined: joined,
  resolved: resolve('rel', 'file.js'),
  posixSep: path.posix.sep,
}
`,
  },
  {
    id: 'path-resolve-chdir',
    title: 'path · resolve / chdir',
    blurb: 'resolve 跟随 process.cwd()；chdir 后再次 resolve',
    source: `(function () {
  var path = require('path')

  console.log('cwd0', process.cwd())
  console.log('resolve0', path.resolve('a'))

  process.chdir('/user/docs')
  console.log('cwd1', process.cwd())
  console.log('resolve1', path.resolve('a'))
  console.log('resolve abs', path.resolve('/tmp', 'x'))

  process.chdir('/user')
  return path.resolve('.', 'docs', '../x')
})()
`,
  },
  {
    id: 'path-parse-relative',
    title: 'path · parse / relative',
    blurb: 'parse / format / normalize / relative',
    source: `(function () {
  var path = require('path')
  var parsed = path.parse('/user/docs/note.md')

  console.log('parse', JSON.stringify(parsed))
  console.log('format', path.format(parsed))
  console.log('normalize', path.normalize('/user//docs/../docs/./a'))
  console.log('relative', path.relative('/user/docs', '/user/docs/a/b'))
  console.log('relative up', path.relative('/user/docs/a', '/user/x'))

  return parsed
})()
`,
  },
  {
    id: 'buffer-basics',
    title: 'Buffer · 编解码',
    blurb: '全局 Buffer；utf8 / hex / base64；Uint8Array 子类',
    source: `(function () {
  var viaRequire = require('buffer').Buffer
  console.log('same as global?', Buffer === viaRequire)
  var buf = Buffer.from('hello')
  console.log('utf8', buf.toString('utf8'))
  console.log('hex', buf.toString('hex'))
  console.log('base64', buf.toString('base64'))
  console.log('isBuffer', Buffer.isBuffer(buf), 'instanceof Uint8Array', buf instanceof Uint8Array)
  process.stdout.write(Buffer.from('stdout via Buffer'))
  return Buffer.from('hi', 'utf8').toString('hex')
})()
`,
  },
  {
    id: 'buffer-import-encoder',
    title: 'Buffer · import + TextEncoder',
    blurb: 'node:buffer 与 TextEncoder/TextDecoder 往返',
    source: `import { Buffer as Buf } from 'node:buffer'

var enc = new TextEncoder()
var bytes = enc.encode('Instant')
var dec = new TextDecoder()
var text = dec.decode(bytes)
var fromBuf = Buf.from(bytes).toString('utf8')

console.log('encoding', enc.encoding)
console.log('roundtrip', text, fromBuf)
console.log('same Buffer?', Buf === Buffer)

export default { text: text, fromBuf: fromBuf, byteLength: bytes.byteLength }
`,
  },
  {
    id: 'process-basics',
    title: 'process · 基础',
    blurb: 'cwd / env / argv / stdout / stderr',
    source: `(function () {
  process.stdout.write('cwd=' + process.cwd())
  process.stdout.write('HOME=' + process.env.HOME)
  process.stderr.write('stderr ok')
  console.log('argv', JSON.stringify(process.argv))
  console.log('USER', process.env.USER)

  return {
    cwd: process.cwd(),
    home: process.env.HOME,
    argv: process.argv,
  }
})()
`,
  },
  {
    id: 'process-exit-code',
    title: 'process · exitCode',
    blurb: '只改 exitCode，不 exit；结果区应显示 exitCode',
    source: `(function () {
  process.exitCode = 7
  console.log('exitCode now', process.exitCode)
  return 'done with code 7'
})()
`,
  },
  {
    id: 'process-exit',
    title: 'process · exit',
    blurb: 'exit 结束本轮；后面代码不应执行；实例可继续用',
    source: `(function () {
  process.stdout.write('before exit')
  process.exit(2)
  process.stdout.write('after exit — should NOT appear')
})()
`,
  },
  {
    id: 'timers-microtask',
    title: '定时器 · microtask',
    blurb: 'queueMicrotask 先于 setTimeout；运行后实例仍在，可再跑',
    source: `(function () {
  var order = []
  console.log('sync start')
  queueMicrotask(function () {
    order.push('micro')
    console.log('microtask', order.join(','))
  })
  setTimeout(function () {
    order.push('timeout')
    console.log('timeout', order.join(','))
  }, 40)
  order.push('sync')
  return order
})()
`,
  },
  {
    id: 'timers-interval-abort',
    title: '定时器 · interval',
    blurb: 'setInterval 持续打点；点「停止」会清掉挂起定时器',
    source: `(function () {
  var n = 0
  var id = setInterval(function () {
    n += 1
    console.log('tick', n)
    if (n >= 5) {
      clearInterval(id)
      console.log('cleared after 5')
    }
  }, 200)
  console.log('interval id', id)
  return 'interval armed'
})()
`,
  },
  {
    id: 'promise-then',
    title: 'Promise · then',
    blurb: 'eval 返回前会排空 Promise jobs（executePendingJobs）',
    source: `(function () {
  var ok = false
  Promise.resolve('hi').then(function (v) {
    ok = true
    console.log('then', v)
  })
  console.log('after schedule, ok=', ok)
  return 'scheduled'
})()
`,
  },
  {
    id: 'globals-persist',
    title: '全局保持',
    blurb: '多次运行累加 __n；重建实例后归零',
    source: `// 刻意不包 IIFE：测全局是否跨 eval 保留
if (typeof __n !== 'number') {
  var __n = 0
}
__n += 1
console.log('__n =', __n)
__n
`,
  },
  {
    id: 'console-levels',
    title: 'console 级别',
    blurb: 'log / info / warn / error 进输出通道',
    source: `(function () {
  console.log('log line', 1)
  console.info('info line')
  console.warn('warn line')
  console.error('error line')
  return 'console ok'
})()
`,
  },
  {
    id: 'require-errors',
    title: 'require 报错',
    blurb: '未实现内建 vs 第三方；应看到清晰错误',
    source: `// 改下面一行分别试：'fs' / 'lodash' / './x.js'
require('fs')
`,
  },
  {
    id: 'path-win32-denied',
    title: 'path/win32 拒绝',
    blurb: 'POSIX-only；path/win32 应失败',
    source: `require('path/win32')
`,
  },
  {
    id: 'blank',
    title: '空白草稿',
    blurb: '从空编辑器随便写；运行=往同一实例塞代码',
    source: `(function () {
  // import path from 'path'  // ESM 请去掉 IIFE，单独写顶层 import
  // var path = require('path')
  // setTimeout(function () { console.log('hi') }, 100)
  return 1 + 1
})()
`,
  },
]

export const DEFAULT_VIRTUAL_JS_SAMPLE_ID = VIRTUAL_JS_SAMPLES[0]!.id

export function getVirtualJsSample(id: string): VirtualJsSample | undefined {
  return VIRTUAL_JS_SAMPLES.find((sample) => sample.id === id)
}
