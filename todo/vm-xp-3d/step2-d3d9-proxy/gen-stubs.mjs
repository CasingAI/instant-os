// 从 zig 自带的 d3d9.h 生成 IDirect3DDevice9 全量虚表 stub（d3d9-proxy-stubs.h）。
// 为什么生成：118 个方法每个都填合法实现（stdcall 槽位签名不匹配 = 栈失衡崩掉），
// 手抄易错；本脚本从 DECLARE_INTERFACE_ 块的 STDMETHOD 声明机械提取精确签名。
// 用法：node gen-stubs.mjs [d3d9.h路径] ；产物写在本目录 d3d9-proxy-stubs.h。
// REAL 集合里的方法由 d3d9-proxy.c 提供真实现并在 vtbl_init 后覆盖。
import { readFileSync, writeFileSync } from 'node:fs'

const header = process.argv[2] ??
  '/opt/homebrew/Cellar/zig/0.16.0_1/lib/zig/libc/include/any-windows-any/d3d9.h'
const text = readFileSync(header, 'latin1')

// 提取 #define INTERFACE IDirect3DDevice9 ... #undef INTERFACE 块（vtbl 声明在宏里）
const begin = text.indexOf('#define INTERFACE IDirect3DDevice9')
const end = text.indexOf('#undef INTERFACE', begin)
if (begin < 0 || end < 0) throw new Error('IDirect3DDevice9 interface block not found')
const block = text.slice(begin, end)

// 拼接多行声明，按 PURE; 切分（STDMETHOD(...) 默认 HRESULT，STDMETHOD_(ret, ...) 带返回值）
const decls = block.replace(/\\\n/g, ' ').match(/\bSTDMETHOD_?\([^;]*?\) PURE/g) ?? []
if (decls.length < 100) throw new Error(`only ${decls.length} methods parsed - parse pattern broken`)

function parseDecl(raw) {
  let m = raw.match(/^STDMETHOD\(([A-Za-z_][A-Za-z0-9_]*)\)\((.*)\)\s*PURE$/s)
  if (m) return { ret: 'HRESULT', name: m[1], params: m[2] }
  m = raw.match(/^STDMETHOD_\(\s*([^,]+?)\s*,\s*([A-Za-z_][A-Za-z0-9_]*)\)\((.*)\)\s*PURE$/s)
  if (m) return { ret: m[1].trim(), name: m[2], params: m[3] }
  throw new Error('unparsed decl: ' + raw.slice(0, 100))
}

// REAL：d3d9-proxy.c 提供真实现的方法（生成器跳过，主文件在 vtbl_init 后覆盖）
const REAL = new Set([
  'QueryInterface', 'AddRef', 'Release',
  'TestCooperativeLevel', 'BeginScene', 'EndScene', 'Clear',
  'Present', 'Reset', 'GetDirect3D',
])

const parsed = decls.map(parseDecl)

const out = []
out.push('/* 由 gen-stubs.mjs 从 zig 自带 d3d9.h 生成——不要手改，重跑生成器。')
out.push(' * IDirect3DDevice9 全量虚表 stub：每个槽位都有签名正确的函数，')
out.push(' * 未实现的方法记录一次日志后返回 D3D_OK。真实现见 d3d9-proxy.c。 */')
out.push('#pragma once\n')
out.push('/* 真实现（d3d9-proxy.c）提供：同名去 stub 前缀的 10 个方法 + 本回调。 */')
out.push('static void proxy_stub_hit(const char *name);\n')

let generated = 0
for (const { ret, name, params } of parsed) {
  if (REAL.has(name)) continue
  // 非 HRESULT 返回的已知成员：都是 4 字节（含 float 的 GetNPatchMode——x86 上
  // 调用方从 ST(0) 读浮点，读到的垃圾值对实验无害），stub 统一返回 0；
  // void 返回则不写 return。
  if (!['HRESULT', 'ULONG', 'UINT', 'INT', 'BOOL', 'WINBOOL', 'float', 'void'].includes(ret)) {
    throw new Error(`stub ${name}: unexpected return ${ret}`)
  }
  const argList = params === 'THIS' ? 'struct IDirect3DDevice9 *This'
    : params.replace(/^THIS_\s*/, 'struct IDirect3DDevice9 *This, ')
  out.push(`static ${ret} STDMETHODCALLTYPE dev_${name}( ${argList} )`)
  out.push('{')
  out.push(`    (void)This;`)
  out.push(`    proxy_stub_hit("${name}");`)
  if (ret !== 'void') out.push(`    return (${ret})0;`)
  out.push('}\n')
  generated++
}

out.push('static void dev_vtbl_init(IDirect3DDevice9Vtbl *vt)')
out.push('{')
for (const { name } of parsed) {
  if (!REAL.has(name)) out.push(`    vt->${name} = dev_${name};`)
}
out.push('}\n')

writeFileSync(new URL('./d3d9-proxy-stubs.h', import.meta.url), out.join('\n') + '\n')
console.log(`parsed ${parsed.length} methods, generated ${generated} stubs (${REAL.size} real impls in d3d9-proxy.c) -> d3d9-proxy-stubs.h`)
