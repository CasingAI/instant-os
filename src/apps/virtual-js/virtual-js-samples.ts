export type VirtualJsSample = {
  id: string
  title: string
  blurb: string
  source: string
  /**
   * 「测试全部」：eval 返回后额外等待（给 setTimeout / 异步收尾），默认 0。
   * 同步且脚本内已 process.exit 的用例应保持 0，结束后立刻切下一个。
   */
  suiteSettleMs?: number
}

/**
 * 用例约定（同一 QuickJS 实例可反复点「运行」）：
 * - 脚本用例包在 IIFE 里，避免 const/let 污染全局、也避免 ASI 把 ({…}) 当成函数调用
 * - 需要测「全局保持」的用例除外
 * - ESM 用例保持顶层 import/export（每次 eval 已用独立文件名）
 * - 无定时器/可同步收尾的用例在末尾 process.exit，便于「测试全部」立刻切下一个
 * - 刻意不 exit 的：exitCode 演示、全局保持、空白草稿、期望抛错的用例
 * - **新用例追加在数组末尾**；侧栏按序号倒序展示（最新在最上）
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
  console.log('→', path.join(process.cwd(), 'out'))
  process.exit(0)
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
process.exit(0)
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
  console.log('→', path.resolve('.', 'docs', '../x'))
  process.exit(0)
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
  process.exit(0)
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
  console.log('→', Buffer.from('hi', 'utf8').toString('hex'))
  process.exit(0)
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
console.log('→', JSON.stringify({ text: text, fromBuf: fromBuf, byteLength: bytes.byteLength }))
process.exit(0)
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
  console.log('→', JSON.stringify({
    cwd: process.cwd(),
    home: process.env.HOME,
    argv: process.argv,
  }))
  process.exit(0)
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
    blurb: 'exit 结束本轮；后面代码不应执行',
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
    blurb: 'queueMicrotask 先于 setTimeout；收尾 process.exit',
    suiteSettleMs: 120,
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
    process.exit(0)
  }, 40)
  order.push('sync')
  return order
})()
`,
  },
  {
    id: 'timers-interval-abort',
    title: '定时器 · interval',
    blurb: 'setInterval 打满 5 次后 process.exit；也可点「停止」中断',
    suiteSettleMs: 1200,
    source: `(function () {
  var n = 0
  var id = setInterval(function () {
    n += 1
    console.log('tick', n)
    if (n >= 5) {
      clearInterval(id)
      console.log('cleared after 5')
      process.exit(0)
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
  process.exit(0)
})()
`,
  },
  {
    id: 'require-errors',
    title: 'require 报错',
    blurb: '未实现内建 vs 第三方；应看到清晰错误',
    source: `// 改下面一行分别试：'http' / 'lodash' / './x.js'
require('http')
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
  {
    id: 'fs-promises',
    title: 'fs · promises',
    blurb: '读写追加 / mkdir / readdir；相对 cwd（工作区 /user）',
    suiteSettleMs: 1500,
    source: `(async function () {
  var fs = require('fs/promises')
  var dir = 'virtual-js-fs-demo'
  await fs.mkdir(dir, { recursive: true })
  var file = dir + '/note.txt'
  await fs.writeFile(file, 'hello')
  await fs.appendFile(file, ' world')
  var text = await fs.readFile(file, 'utf8')
  var names = await fs.readdir(dir)
  var st = await fs.stat(file)
  console.log('text', text)
  console.log('names', names.join(','))
  console.log('size', st.size, 'isFile', st.isFile())
  process.exit(0)
})()
`,
  },
  {
    id: 'fs-sync',
    title: 'fs · Sync (Asyncify)',
    blurb: 'guest 侧看起来阻塞；宿主仍异步打 VFS',
    source: `(function () {
  var fs = require('fs')
  var file = 'virtual-js-fs-demo/sync.txt'
  fs.mkdirSync('virtual-js-fs-demo', { recursive: true })
  fs.writeFileSync(file, 'sync-hi')
  var text = fs.readFileSync(file, 'utf8')
  console.log('readFileSync', text)
  console.log('existsSync', fs.existsSync(file))
  process.exit(0)
})()
`,
  },
  {
    id: 'esm-files',
    title: 'ESM · 多文件 import',
    blurb: '先写 VFS，再 dynamic import；须写全 .js（Node ESM）',
    suiteSettleMs: 1500,
    source: `(async function () {
  var fs = require('fs')
  fs.mkdirSync('virtual-js-esm-demo', { recursive: true })
  fs.writeFileSync(
    'virtual-js-esm-demo/lib.js',
    'export const msg = "from-lib";\\nexport default function twice(n) { return n * 2 }\\n',
  )
  var mod = await import('./virtual-js-esm-demo/lib.js')
  console.log('msg', mod.msg)
  console.log('twice(21)', mod.default(21))
  process.exit(0)
})()
`,
  },
  {
    id: 'cjs-files',
    title: 'CJS · require 多文件',
    blurb: '扩展名/index 探测；相对路径相对调用方目录（对齐 Node）',
    source: `(function () {
  var fs = require('fs')
  fs.mkdirSync('virtual-js-cjs-demo/lib', { recursive: true })
  fs.mkdirSync('virtual-js-cjs-demo/pkg', { recursive: true })
  fs.writeFileSync(
    'virtual-js-cjs-demo/lib/b.js',
    'module.exports = { tag: "b", n: 3 }\\n',
  )
  fs.writeFileSync(
    'virtual-js-cjs-demo/lib/a.js',
    'var b = require("./b"); module.exports = { tag: "a", from: b.tag, n: b.n * 2 }\\n',
  )
  fs.writeFileSync(
    'virtual-js-cjs-demo/pkg/index.js',
    'module.exports = { index: true }\\n',
  )
  fs.writeFileSync(
    'virtual-js-cjs-demo/data.json',
    JSON.stringify({ hello: 'cjs' }),
  )
  var a = require('./virtual-js-cjs-demo/lib/a')
  var pkg = require('./virtual-js-cjs-demo/pkg')
  var data = require('./virtual-js-cjs-demo/data')
  console.log('a', a.tag, a.from, a.n)
  console.log('pkg.index', pkg.index)
  console.log('data.hello', data.hello)
  console.log('resolve', require.resolve('./virtual-js-cjs-demo/lib/a.js'))
  process.exit(0)
})()
`,
  },
]

/** 侧栏展示用：带序号，且最新用例在前。 */
export type VirtualJsSampleListItem = VirtualJsSample & {
  /** 创作顺序序号（1 = 最早；越大越新） */
  seq: number
}

/**
 * 侧栏 / 跑全部：按序号倒序（最新在前）。
 * 新用例请追加在 `VIRTUAL_JS_SAMPLES` 末尾。
 */
export const VIRTUAL_JS_SAMPLE_LIST: VirtualJsSampleListItem[] = VIRTUAL_JS_SAMPLES.map(
  (sample, index) => ({
    ...sample,
    seq: index + 1,
  }),
).reverse()

/** 默认打开最新一条用例。 */
export const DEFAULT_VIRTUAL_JS_SAMPLE_ID = VIRTUAL_JS_SAMPLE_LIST[0]!.id

export function getVirtualJsSample(id: string): VirtualJsSample | undefined {
  return VIRTUAL_JS_SAMPLES.find((sample) => sample.id === id)
}

export function formatVirtualJsSampleTitle(
  sample: Pick<VirtualJsSampleListItem, 'seq' | 'title'>,
): string {
  return `#${sample.seq} ${sample.title}`
}
