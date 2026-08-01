declare module 'monaco-editor/esm/vs/base/common/event.js' {
  export const Event: {
    readonly None: { dispose(): void }
  }
}

declare module 'monaco-editor/esm/vs/editor/standalone/browser/standaloneServices.js' {
  export const StandaloneServices: {
    initialize(services: Record<string, unknown>): void
  }
}

declare module 'monaco-editor/esm/vs/language/json/tokenization.js' {
  /** JSON 行内状态（jsonMode.js 内部 JSONState 的结构子集） */
  export type JsonlTokenizerState = {
    clone(): JsonlTokenizerState
    equals(other: JsonlTokenizerState): boolean
  }

  /** 返回按行着色（state tokenizer）的 TokensProvider，与 jsonMode.js 用法一致 */
  export function createTokenizationSupport(supportComments: boolean): {
    getInitialState(): JsonlTokenizerState
    tokenize(line: string, state: JsonlTokenizerState): {
      tokens: { startIndex: number; scopes: string }[]
      endState: JsonlTokenizerState
    }
  }
}
