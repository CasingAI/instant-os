import type * as Monaco from 'monaco-editor'
import { createOpenAiClient } from '../../ai/openai-client.ts'
import { recordOpenAiCompletionUsage } from '../../ai/openai-usage.ts'
import { openAiConfigForVscodeAiModelKey } from './vscode-ai-models.ts'
import { ensureMonacoEnvironment, monaco } from '../../monaco/monaco-setup.ts'
import { fileNameFromPath, monacoLanguageFromFileName } from '../../monaco/monaco-language.ts'

const DEBOUNCE_MS = 500
const PREFIX_MAX = 4000
const SUFFIX_MAX = 1200
const MAX_FILE_CHARS = 200_000

export type VscodeInlineCompletionOptions = {
  enabled: boolean
  getModelKey: () => string | undefined
  getActiveEditor: () =>
    | {
        path: string
        readOnly: boolean
        getPrefixSuffix: () => { prefix: string; suffix: string } | undefined
      }
    | undefined
}

let providerHandle: Monaco.IDisposable | undefined
let debounceTimer: ReturnType<typeof setTimeout> | undefined
let abortController: AbortController | undefined
let optionsRef: VscodeInlineCompletionOptions = {
  enabled: false,
  getModelKey: () => undefined,
  getActiveEditor: () => undefined,
}

function extractCompletionText(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  const fence = trimmed.match(/```[\w]*\n?([\s\S]*?)```/)
  if (fence?.[1]) return fence[1].trimEnd()
  return trimmed.replace(/^\s*```[\w]*\n?/, '').replace(/```\s*$/, '').trimEnd()
}

async function fetchInlineCompletion(
  prefix: string,
  suffix: string,
  language: string,
  modelKey: string | undefined,
): Promise<string> {
  const config = openAiConfigForVscodeAiModelKey(modelKey)
  const client = createOpenAiClient(config, 'text')
  const model = config.defaultModel

  const system = `你是代码补全助手。只输出要插入光标处的后续代码片段，不要解释、不要 markdown 围栏、不要重复已有前缀。语言：${language}。`
  const user = `【光标前】\n${prefix.slice(-PREFIX_MAX)}\n\n【光标后】\n${suffix.slice(0, SUFFIX_MAX)}\n\n请补全光标处后续内容：`

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    max_completion_tokens: 256,
    temperature: 0.2,
  })

  await recordOpenAiCompletionUsage(response, {
    actor: 'vscode',
    behavior: 'inline-completion',
    actorLabel: 'Virtual Studio Code',
    behaviorLabel: '行内补全',
  })

  const text = response.choices[0]?.message?.content ?? ''
  return extractCompletionText(typeof text === 'string' ? text : '')
}

export function setVscodeInlineCompletionOptions(options: VscodeInlineCompletionOptions): void {
  optionsRef = options
}

export function ensureVscodeInlineCompletionProvider(): void {
  if (providerHandle) return
  ensureMonacoEnvironment()

  providerHandle = monaco.languages.registerInlineCompletionsProvider(
    { pattern: '**' },
    {
      provideInlineCompletions: async (model, position, _context, token) => {
        if (!optionsRef.enabled) return { items: [] }
        if (token.isCancellationRequested) return { items: [] }

        const active = optionsRef.getActiveEditor()
        if (!active || active.readOnly) return { items: [] }
        if (active.path !== model.uri.path) return { items: [] }

        const full = model.getValue()
        if (full.length > MAX_FILE_CHARS) return { items: [] }

        const offset = model.getOffsetAt(position)
        const prefix = full.slice(0, offset)
        const suffix = full.slice(offset)

        return new Promise((resolve) => {
          if (debounceTimer) clearTimeout(debounceTimer)
          abortController?.abort()
          abortController = new AbortController()

          debounceTimer = setTimeout(() => {
            void (async () => {
              try {
                if (token.isCancellationRequested) {
                  resolve({ items: [] })
                  return
                }
                const language = monacoLanguageFromFileName(fileNameFromPath(active.path))
                const insertText = await fetchInlineCompletion(
                  prefix,
                  suffix,
                  language,
                  optionsRef.getModelKey(),
                )
                if (!insertText || token.isCancellationRequested) {
                  resolve({ items: [] })
                  return
                }
                const range = new monaco.Range(
                  position.lineNumber,
                  position.column,
                  position.lineNumber,
                  position.column,
                )
                resolve({
                  items: [
                    {
                      insertText,
                      range,
                    },
                  ],
                })
              } catch {
                resolve({ items: [] })
              }
            })()
          }, DEBOUNCE_MS)
        })
      },
      disposeInlineCompletions: () => undefined,
    },
  )
}

export function disposeVscodeInlineCompletionProvider(): void {
  providerHandle?.dispose()
  providerHandle = undefined
  if (debounceTimer) clearTimeout(debounceTimer)
  abortController?.abort()
}
