/**
 * Agent / program 来源的脚本：包进严格 IIFE，避免同实例多次 eval 时
 * 顶层 const/let 重复声明；cwd / process 仍由同一 QuickJS 实例保留。
 */
export function wrapTerminalProgramEval(code: string): string {
  return `;(function () {\n"use strict";\n${code}\n})()`
}
