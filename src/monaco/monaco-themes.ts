/*---------------------------------------------------------------------------------------------
 *  Color values adapted from Visual Studio Code default themes
 *  (extensions/theme-defaults) in microsoft/vscode.
 *
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License.
 *
 *  https://github.com/microsoft/vscode/tree/main/extensions/theme-defaults
 *--------------------------------------------------------------------------------------------*/

import './monaco-nls.ts'
import * as monaco from 'monaco-editor'
import type { editor } from 'monaco-editor'

/** Built-in Monaco themes plus VS Code default theme ports. */
export type MonacoEditorTheme =
  | 'vs'
  | 'vs-dark'
  | 'hc-black'
  | 'dark-plus'
  | 'light-plus'
  | 'dark-modern'
  | 'light-modern'

export const MONACO_EDITOR_THEMES: readonly MonacoEditorTheme[] = [
  'vs-dark',
  'vs',
  'hc-black',
  'dark-plus',
  'light-plus',
  'dark-modern',
  'light-modern',
] as const

export function isMonacoEditorTheme(value: unknown): value is MonacoEditorTheme {
  return typeof value === 'string' && (MONACO_EDITOR_THEMES as readonly string[]).includes(value)
}

const DARK_PLUS_RULES: editor.ITokenThemeRule[] = [
  { token: 'comment', foreground: '6A9955' },
  { token: 'string', foreground: 'CE9178' },
  { token: 'string.sql', foreground: 'FF0000' },
  { token: 'keyword', foreground: '569CD6' },
  { token: 'keyword.flow', foreground: 'C586C0' },
  { token: 'keyword.json', foreground: 'CE9178' },
  { token: 'number', foreground: 'B5CEA8' },
  { token: 'regexp', foreground: 'D16969' },
  { token: 'type', foreground: '4EC9B0' },
  { token: 'class', foreground: '4EC9B0' },
  { token: 'type.identifier', foreground: '4EC9B0' },
  { token: 'identifier', foreground: '9CDCFE' },
  { token: 'delimiter', foreground: 'D4D4D4' },
  { token: 'tag', foreground: '569CD6' },
  { token: 'metatag', foreground: '569CD6' },
  { token: 'attribute.name', foreground: '9CDCFE' },
  { token: 'attribute.value', foreground: 'CE9178' },
  { token: 'variable', foreground: '9CDCFE' },
  { token: 'variable.predefined', foreground: '4FC1FF' },
  { token: 'constant', foreground: '4FC1FF' },
]

const LIGHT_PLUS_RULES: editor.ITokenThemeRule[] = [
  { token: 'comment', foreground: '008000' },
  { token: 'string', foreground: 'A31515' },
  { token: 'string.sql', foreground: 'FF0000' },
  { token: 'keyword', foreground: '0000FF' },
  { token: 'keyword.flow', foreground: 'AF00DB' },
  { token: 'keyword.json', foreground: '0451A5' },
  { token: 'number', foreground: '098658' },
  { token: 'regexp', foreground: '811F3F' },
  { token: 'type', foreground: '267F99' },
  { token: 'class', foreground: '267F99' },
  { token: 'type.identifier', foreground: '267F99' },
  { token: 'identifier', foreground: '001080' },
  { token: 'delimiter', foreground: '000000' },
  { token: 'tag', foreground: '800000' },
  { token: 'metatag', foreground: '800000' },
  { token: 'attribute.name', foreground: 'E50000' },
  { token: 'attribute.value', foreground: '0000FF' },
  { token: 'variable', foreground: '001080' },
  { token: 'variable.predefined', foreground: '0070C1' },
  { token: 'constant', foreground: '0070C1' },
]

/** Plus themes refine token colors on top of classic VS bases. */
const DARK_PLUS: editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: DARK_PLUS_RULES,
  colors: {
    'editor.background': '#1E1E1E',
    'editor.foreground': '#D4D4D4',
    'editor.inactiveSelectionBackground': '#3A3D41',
    'editor.selectionHighlightBackground': '#ADD6FF26',
    'editorIndentGuide.background1': '#404040',
    'editorIndentGuide.activeBackground1': '#707070',
    'editorLineNumber.foreground': '#858585',
    'editorLineNumber.activeForeground': '#C6C6C6',
    'editorCursor.foreground': '#AEAFAD',
    'editorWidget.background': '#252526',
    'editorSuggestWidget.background': '#252526',
    'editorGroupHeader.tabsBackground': '#252526',
  },
}

const LIGHT_PLUS: editor.IStandaloneThemeData = {
  base: 'vs',
  inherit: true,
  rules: LIGHT_PLUS_RULES,
  colors: {
    'editor.background': '#FFFFFF',
    'editor.foreground': '#000000',
    'editor.inactiveSelectionBackground': '#E5EBF1',
    'editor.selectionHighlightBackground': '#ADD6FF80',
    'editorIndentGuide.background1': '#D3D3D3',
    'editorIndentGuide.activeBackground1': '#939393',
    'editorLineNumber.foreground': '#237893',
    'editorLineNumber.activeForeground': '#0B216F',
    'editorCursor.foreground': '#000000',
    'editorWidget.background': '#F3F3F3',
    'editorSuggestWidget.background': '#F3F3F3',
    'editorGroupHeader.tabsBackground': '#F3F3F3',
  },
}

/** Modern themes keep Plus token colors with updated chrome / editor surfaces. */
const DARK_MODERN: editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: DARK_PLUS_RULES,
  colors: {
    'editor.background': '#1F1F1F',
    'editor.foreground': '#CCCCCC',
    'editor.inactiveSelectionBackground': '#3A3D41',
    'editor.selectionHighlightBackground': '#ADD6FF26',
    'editorIndentGuide.background1': '#404040',
    'editorIndentGuide.activeBackground1': '#707070',
    'editorLineNumber.foreground': '#6E7681',
    'editorLineNumber.activeForeground': '#CCCCCC',
    'editorCursor.foreground': '#AEAFAD',
    'editorWidget.background': '#202020',
    'editorSuggestWidget.background': '#202020',
    'editorGroupHeader.tabsBackground': '#181818',
    'editorGroup.border': '#2B2B2B',
  },
}

const LIGHT_MODERN: editor.IStandaloneThemeData = {
  base: 'vs',
  inherit: true,
  rules: LIGHT_PLUS_RULES,
  colors: {
    'editor.background': '#FFFFFF',
    'editor.foreground': '#3B3B3B',
    'editor.inactiveSelectionBackground': '#E5EBF1',
    'editor.selectionHighlightBackground': '#ADD6FF80',
    'editorIndentGuide.background1': '#D3D3D3',
    'editorIndentGuide.activeBackground1': '#939393',
    'editorLineNumber.foreground': '#6E7681',
    'editorLineNumber.activeForeground': '#171184',
    'editorCursor.foreground': '#3B3B3B',
    'editorWidget.background': '#F8F8F8',
    'editorSuggestWidget.background': '#F8F8F8',
    'editorGroupHeader.tabsBackground': '#F8F8F8',
    'editorGroup.border': '#E5E5E5',
  },
}

const CUSTOM_THEMES: Record<
  Extract<MonacoEditorTheme, 'dark-plus' | 'light-plus' | 'dark-modern' | 'light-modern'>,
  editor.IStandaloneThemeData
> = {
  'dark-plus': DARK_PLUS,
  'light-plus': LIGHT_PLUS,
  'dark-modern': DARK_MODERN,
  'light-modern': LIGHT_MODERN,
}

let registered = false

export function registerMonacoThemes(): void {
  if (registered) {
    return
  }
  registered = true
  for (const [id, data] of Object.entries(CUSTOM_THEMES)) {
    monaco.editor.defineTheme(id, data)
  }
}
