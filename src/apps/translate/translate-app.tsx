import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs } from '../../os/os-context.tsx'
import { FICTIONAL_LANGUAGES, type FictionalLanguageId } from './fictional-languages.ts'
import { generateChineseToFictional, generateFictionalToChinese } from './translate-agent.ts'
import './translate.css'

const SAMPLE_PHRASES = ['你好', '我爱你', '今天天气怎么样', '星星与月亮', '人工智能'] as const

const SYSTEM_LANGUAGE_LABEL = '中文'

type TranslateDirection = 'zh-to-fictional' | 'fictional-to-zh'

export function TranslateApp() {
  const { closeWindowsForApp, minimizeWindow, setAppWindowTitle, windows } = useOs()
  const { showBuiltinAbout } = useAboutApp()

  const [direction, setDirection] = useState<TranslateDirection>('zh-to-fictional')
  const [languageId, setLanguageId] = useState<FictionalLanguageId>('haqiululu')
  const [sourceText, setSourceText] = useState('')
  const [outputText, setOutputText] = useState('')
  const [translating, setTranslating] = useState(false)
  const [error, setError] = useState<string | undefined>()

  const selectedLanguage = useMemo(
    () => FICTIONAL_LANGUAGES.find((language) => language.id === languageId) ?? FICTIONAL_LANGUAGES[0],
    [languageId],
  )

  const sourceLabel =
    direction === 'zh-to-fictional' ? SYSTEM_LANGUAGE_LABEL : `${selectedLanguage?.emoji} ${selectedLanguage?.name}`
  const targetLabel =
    direction === 'zh-to-fictional' ? `${selectedLanguage?.emoji} ${selectedLanguage?.name}` : SYSTEM_LANGUAGE_LABEL

  const directionNote =
    direction === 'zh-to-fictional' ? '中文 → 宇宙语言' : '宇宙语言 → 中文'

  const runTranslate = useCallback(async () => {
    const trimmed = sourceText.trim()
    if (!trimmed) {
      setError('请输入要翻译的内容')
      return
    }

    setTranslating(true)
    setError(undefined)
    setOutputText('')

    try {
      const result =
        direction === 'zh-to-fictional'
          ? await generateChineseToFictional(trimmed, languageId)
          : await generateFictionalToChinese(trimmed)
      setOutputText(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : '翻译失败，请稍后重试')
    } finally {
      setTranslating(false)
    }
  }, [direction, languageId, sourceText])

  const handleSwap = useCallback(() => {
    setDirection((current) => (current === 'zh-to-fictional' ? 'fictional-to-zh' : 'zh-to-fictional'))
    setSourceText(outputText)
    setOutputText(sourceText)
    setError(undefined)
  }, [outputText, sourceText])

  const handleClear = useCallback(() => {
    setSourceText('')
    setOutputText('')
    setError(undefined)
  }, [])

  const handleSample = useCallback((phrase: string) => {
    setDirection('zh-to-fictional')
    setSourceText(phrase)
    setOutputText('')
    setError(undefined)
  }, [])

  useEffect(() => {
    setAppWindowTitle('translate', '翻译')
  }, [setAppWindowTitle])

  const menuBar = useMemo((): MenuDefinition[] => {
    const appWindow = windows.find((window) => window.appId === 'translate' && !window.minimized)

    return [
      {
        label: '翻译',
        items: [
          ...aboutAppMenuPrefix('关于 翻译', () => showBuiltinAbout('translate')),
          {
            type: 'action',
            label: '隐藏翻译',
            shortcut: '⌘H',
            onClick: () => appWindow && minimizeWindow(appWindow.id),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '退出翻译',
            shortcut: '⌘Q',
            onClick: () => closeWindowsForApp('translate'),
          },
        ],
      },
      {
        label: '编辑',
        items: [
          {
            type: 'action',
            label: '清空',
            shortcut: '⌘K',
            onClick: handleClear,
          },
          {
            type: 'action',
            label: '翻译',
            shortcut: '↩',
            onClick: () => void runTranslate(),
          },
        ],
      },
    ]
  }, [closeWindowsForApp, handleClear, minimizeWindow, runTranslate, showBuiltinAbout, windows])

  useAppMenuBar('translate', menuBar)

  return (
    <div class="translate-app">
      <header class="translate-app__toolbar">
        <span class="translate-app__brand">翻译</span>
        <span class="translate-app__hint">{directionNote}</span>
      </header>

      <div class="translate-app__body">
        <div class="translate-app__lang-bar">
          <div class="translate-app__lang-card">
            <span class="translate-app__lang-label">源语言</span>
            {direction === 'zh-to-fictional' ? (
              <div class="translate-app__lang-fixed" aria-label="源语言">
                <span aria-hidden="true">🇨🇳</span>
                <span>{SYSTEM_LANGUAGE_LABEL}</span>
              </div>
            ) : (
              <select
                class="translate-app__lang-control"
                value={languageId}
                onChange={(event) => setLanguageId((event.target as HTMLSelectElement).value as FictionalLanguageId)}
                aria-label="选择宇宙源语言"
              >
                {FICTIONAL_LANGUAGES.map((language) => (
                  <option key={language.id} value={language.id}>
                    {language.emoji} {language.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div class="translate-app__swap-wrap">
            <button
              type="button"
              class="translate-app__swap"
              onClick={handleSwap}
              aria-label="交换翻译方向"
              title="交换方向"
              disabled={translating}
            >
              ⇄
            </button>
          </div>

          <div class="translate-app__lang-card">
            <span class="translate-app__lang-label">目标语言</span>
            {direction === 'zh-to-fictional' ? (
              <select
                class="translate-app__lang-control"
                value={languageId}
                onChange={(event) => setLanguageId((event.target as HTMLSelectElement).value as FictionalLanguageId)}
                aria-label="选择宇宙目标语言"
              >
                {FICTIONAL_LANGUAGES.map((language) => (
                  <option key={language.id} value={language.id}>
                    {language.emoji} {language.name}
                  </option>
                ))}
              </select>
            ) : (
              <div class="translate-app__lang-fixed" aria-label="目标语言">
                <span aria-hidden="true">🇨🇳</span>
                <span>{SYSTEM_LANGUAGE_LABEL}</span>
              </div>
            )}
          </div>
        </div>

        <div class="translate-app__workspace">
          <section class="translate-app__panel">
            <div class="translate-app__panel-header">
              <span class="translate-app__panel-title">{sourceLabel}</span>
              <span class="translate-app__panel-count">{sourceText.length} 字</span>
            </div>
            <div class="translate-app__panel-body">
              <textarea
                class="translate-app__textarea"
                value={sourceText}
                placeholder={direction === 'zh-to-fictional' ? '输入中文…' : '输入宇宙语言文本…'}
                disabled={translating}
                onInput={(event) => setSourceText((event.target as HTMLTextAreaElement).value)}
              />
            </div>
          </section>

          <section class="translate-app__panel">
            <div class="translate-app__panel-header">
              <span class="translate-app__panel-title">{targetLabel}</span>
              <span class="translate-app__panel-count">{outputText.length} 字</span>
            </div>
            <div class="translate-app__panel-body">
              <textarea
                class="translate-app__textarea translate-app__textarea--output"
                value={outputText}
                readOnly
                placeholder={translating ? '' : '翻译结果将显示在这里'}
              />
              {translating && (
                <div class="translate-app__panel-loading" aria-live="polite">
                  <span class="translate-app__spinner" aria-hidden="true" />
                  <span>正在翻译…</span>
                </div>
              )}
            </div>
          </section>
        </div>

        <div class="translate-app__footer">
          <button
            type="button"
            class="translate-app__translate-btn"
            onClick={() => void runTranslate()}
            disabled={translating}
          >
            {translating ? '正在翻译…' : '翻译'}
          </button>
          <button type="button" class="translate-app__clear-btn" onClick={handleClear} disabled={translating}>
            清空
          </button>
          {error && <p class="translate-app__error">{error}</p>}
        </div>

        {direction === 'zh-to-fictional' && selectedLanguage && (
          <p class="translate-app__language-note">
            {selectedLanguage.emoji} {selectedLanguage.name}（{selectedLanguage.nativeName}）— {selectedLanguage.description}
          </p>
        )}

        {direction === 'zh-to-fictional' && (
          <div class="translate-app__samples" aria-label="示例短语">
            {SAMPLE_PHRASES.map((phrase) => (
              <button
                key={phrase}
                type="button"
                class="translate-app__sample"
                onClick={() => handleSample(phrase)}
                disabled={translating}
              >
                {phrase}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
