/**
 * Agent / program 来源的脚本：包进严格 async IIFE，避免同实例多次 eval 时
 * 顶层 const/let 重复声明；并允许脚本内 `await`（如 instant.* / fs.promises）。
 * cwd / process 仍由同一 QuickJS 实例保留。
 */
export function wrapTerminalProgramEval(code: string): string {
  return `;(async function () {\n"use strict";\n${code}\n})()`
}
