/**
 * iCode 类型检查 Worker（第五期）：在用户浏览器里跑完整 TypeScript 检查器。
 * 核心逻辑在 icode-type-check-core.ts（与 Node 单测共用）；本文件只装配
 * 随宿主静态资源 / node_modules 打包的支撑文件（TS lib + 系统 Preact 声明）。
 */
import libEs5 from '../../../node_modules/typescript/lib/lib.es5.d.ts?raw'
import libEs2015 from '../../../node_modules/typescript/lib/lib.es2015.d.ts?raw'
import libEs2016 from '../../../node_modules/typescript/lib/lib.es2016.d.ts?raw'
import libEs2017 from '../../../node_modules/typescript/lib/lib.es2017.d.ts?raw'
import libEs2018 from '../../../node_modules/typescript/lib/lib.es2018.d.ts?raw'
import libEs2019 from '../../../node_modules/typescript/lib/lib.es2019.d.ts?raw'
import libEs2020 from '../../../node_modules/typescript/lib/lib.es2020.d.ts?raw'
import libDom from '../../../node_modules/typescript/lib/lib.dom.d.ts?raw'
import libDomIterable from '../../../node_modules/typescript/lib/lib.dom.iterable.d.ts?raw'
import libDomAsyncIterable from '../../../node_modules/typescript/lib/lib.dom.asynciterable.d.ts?raw'
import libScriptHost from '../../../node_modules/typescript/lib/lib.scripthost.d.ts?raw'
import libWebWorkerImportScripts from '../../../node_modules/typescript/lib/lib.webworker.importscripts.d.ts?raw'
import preactIndexDts from '../../../node_modules/preact/src/index.d.ts?raw'
import preactDomDts from '../../../node_modules/preact/src/dom.d.ts?raw'
import preactJsxDts from '../../../node_modules/preact/src/jsx.d.ts?raw'
import preactInternalDts from '../../../node_modules/preact/src/internal.d.ts?raw'
import preactHooksIndexDts from '../../../node_modules/preact/hooks/src/index.d.ts?raw'
import preactHooksInternalDts from '../../../node_modules/preact/hooks/src/internal.d.ts?raw'
import preactJsxRuntimeIndexDts from '../../../node_modules/preact/jsx-runtime/src/index.d.ts?raw'
import {
  buildPreactPackageJsons,
  runTypeCheck,
  type IcodeTypeCheckRequest,
  type IcodeTypeCheckResponse,
} from './icode-type-check-core.ts'

const LIB_FILES: Record<string, string> = {
  'lib.es5.d.ts': libEs5,
  'lib.es2015.d.ts': libEs2015,
  'lib.es2016.d.ts': libEs2016,
  'lib.es2017.d.ts': libEs2017,
  'lib.es2018.d.ts': libEs2018,
  'lib.es2019.d.ts': libEs2019,
  'lib.es2020.d.ts': libEs2020,
  'lib.dom.d.ts': libDom,
  'lib.dom.iterable.d.ts': libDomIterable,
  'lib.dom.asynciterable.d.ts': libDomAsyncIterable,
  'lib.scripthost.d.ts': libScriptHost,
  'lib.webworker.importscripts.d.ts': libWebWorkerImportScripts,
}

const SYSTEM_TYPE_FILES: Record<string, string> = {
  ...buildPreactPackageJsons(),
  'node_modules/preact/src/index.d.ts': preactIndexDts,
  'node_modules/preact/src/dom.d.ts': preactDomDts,
  'node_modules/preact/src/jsx.d.ts': preactJsxDts,
  'node_modules/preact/src/internal.d.ts': preactInternalDts,
  'node_modules/preact/hooks/src/index.d.ts': preactHooksIndexDts,
  'node_modules/preact/hooks/src/internal.d.ts': preactHooksInternalDts,
  'node_modules/preact/jsx-runtime/src/index.d.ts': preactJsxRuntimeIndexDts,
}

self.onmessage = (event: MessageEvent<IcodeTypeCheckRequest>) => {
  const request = event.data
  if (!request || request.type !== 'instant-os-icode-type-check') {
    return
  }
  const result = runTypeCheck(request, { libs: LIB_FILES, systemTypes: SYSTEM_TYPE_FILES })
  const response: IcodeTypeCheckResponse = { ...result, runId: request.runId }
  self.postMessage(response)
}
