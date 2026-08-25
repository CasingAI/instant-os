/**
 * less 包的最小类型声明（宿主侧局部）：只声明本系统用到的入口。
 * 真实形状见 icode-less.ts 内的 LessStatic / LessFileManager。
 */
declare module 'less' {
  export const version: string[]
  export function render(
    source: string,
    options: Record<string, unknown>,
  ): Promise<{ css: string; imports?: Record<string, unknown> }>
  export const FileManager: new () => {
    supports(filename: string, currentDirectory: string, options: unknown, environment: unknown): boolean
    supportsSync(): boolean
    loadFile(
      filename: string,
      currentDirectory: string,
      options: unknown,
      environment: unknown,
    ): Promise<{ filename: string; contents: string }>
    tryAppendExtension(path: string, ext: string): string
    extractUrlParts(url: string): unknown
  }
}
