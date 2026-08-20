import type { ComponentChildren } from 'preact'
import { createContext } from 'preact'
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import {
  WindowModal,
  WindowModalOverlayContext,
  type WindowModalAction,
  type WindowModalActionTone,
} from './window-modal.tsx'

type PromptOptions = {
  title: string
  label?: string
  placeholder?: string
  initialValue?: string
  /** 显示在输入框右侧的固定后缀（不可编辑） */
  suffix?: string
  inputType?: 'text' | 'password'
  requireValue?: boolean
  confirmLabel?: string
  cancelLabel?: string
  themeColor?: string
  validate?: (value: string) => string | undefined
}

type ConfirmOptions = {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  confirmTone?: WindowModalActionTone
  themeColor?: string
}

type AlertOptions = {
  title: string
  message: string
  confirmLabel?: string
  themeColor?: string
}

type PromptState = {
  options: PromptOptions
  draft: string
  error?: string
  resolve: (value: string | undefined) => void
}

type WindowModalContextValue = {
  prompt: (options: PromptOptions) => Promise<string | undefined>
  confirm: (options: ConfirmOptions) => Promise<boolean>
  alert: (options: AlertOptions) => Promise<void>
  setThemeColor: (themeColor: string | undefined) => void
  themeColor: string | undefined
}

const WindowModalContext = createContext<WindowModalContextValue | undefined>(undefined)

export function WindowModalProvider({ children }: { children: ComponentChildren }) {
  const [defaultThemeColor, setDefaultThemeColor] = useState<string | undefined>(undefined)
  const [promptState, setPromptState] = useState<PromptState | undefined>(undefined)
  const [confirmState, setConfirmState] = useState<
    | {
        options: ConfirmOptions
        resolve: (value: boolean) => void
      }
    | undefined
  >(undefined)
  const [alertState, setAlertState] = useState<
    | {
        options: AlertOptions
        resolve: () => void
      }
    | undefined
  >(undefined)
  const promptInputRef = useRef<HTMLInputElement | null>(null)
  const [overlayRoot, setOverlayRoot] = useState<HTMLDivElement | undefined>(undefined)

  const resolveThemeColor = useCallback(
    (override?: string) => override ?? defaultThemeColor,
    [defaultThemeColor],
  )

  const prompt = useCallback((options: PromptOptions) => {
    return new Promise<string | undefined>((resolve) => {
      setPromptState({
        options,
        draft: options.initialValue ?? '',
        resolve,
      })
    })
  }, [])

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setConfirmState({ options, resolve })
    })
  }, [])

  const alert = useCallback((options: AlertOptions) => {
    return new Promise<void>((resolve) => {
      setAlertState({ options, resolve })
    })
  }, [])

  const setThemeColor = useCallback((themeColor: string | undefined) => {
    setDefaultThemeColor(themeColor)
  }, [])

  const closePrompt = useCallback((value: string | undefined) => {
    setPromptState((current) => {
      current?.resolve(value)
      return undefined
    })
  }, [])

  const closeConfirm = useCallback((value: boolean) => {
    setConfirmState((current) => {
      current?.resolve(value)
      return undefined
    })
  }, [])

  const closeAlert = useCallback(() => {
    setAlertState((current) => {
      current?.resolve()
      return undefined
    })
  }, [])

  useEffect(() => {
    if (!promptState) {
      return
    }
    promptInputRef.current?.focus()
  }, [promptState])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }
      if (promptState) {
        event.preventDefault()
        event.stopImmediatePropagation()
        closePrompt(undefined)
        return
      }
      if (confirmState) {
        event.preventDefault()
        event.stopImmediatePropagation()
        closeConfirm(false)
        return
      }
      if (alertState) {
        event.preventDefault()
        event.stopImmediatePropagation()
        closeAlert()
      }
    }

    if (!promptState && !confirmState && !alertState) {
      return
    }

    // capture：先于系统打开对话框等外层 Escape 处理，避免整层被关掉
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [alertState, closeAlert, closeConfirm, closePrompt, confirmState, promptState])

  const submitPrompt = useCallback(() => {
    if (!promptState) {
      return
    }

    const error = promptState.options.validate?.(promptState.draft)
    if (error) {
      setPromptState({
        ...promptState,
        error,
      })
      return
    }

    closePrompt(promptState.draft.trim())
  }, [closePrompt, promptState])

  const value = useMemo(
    () => ({
      prompt,
      confirm,
      alert,
      setThemeColor,
      themeColor: defaultThemeColor,
    }),
    [alert, confirm, defaultThemeColor, prompt, setThemeColor],
  )

  const promptTheme = promptState ? resolveThemeColor(promptState.options.themeColor) : undefined
  const confirmTheme = confirmState ? resolveThemeColor(confirmState.options.themeColor) : undefined
  const alertTheme = alertState ? resolveThemeColor(alertState.options.themeColor) : undefined

  const promptActions = useMemo((): WindowModalAction[] => {
    if (!promptState) {
      return []
    }

    return [
      {
        key: 'cancel',
        label: promptState.options.cancelLabel ?? '取消',
        tone: 'secondary',
        onClick: () => closePrompt(undefined),
      },
      {
        key: 'confirm',
        label: promptState.options.confirmLabel ?? '确定',
        tone: 'primary',
        disabled: promptState.options.requireValue !== false && !promptState.draft.trim(),
        onClick: () => {
          submitPrompt()
          return false
        },
      },
    ]
  }, [closePrompt, promptState, submitPrompt])

  const confirmActions = useMemo((): WindowModalAction[] => {
    if (!confirmState) {
      return []
    }

    return [
      {
        key: 'cancel',
        label: confirmState.options.cancelLabel ?? '取消',
        tone: 'secondary',
        onClick: () => closeConfirm(false),
      },
      {
        key: 'confirm',
        label: confirmState.options.confirmLabel ?? '确定',
        tone: confirmState.options.confirmTone ?? 'primary',
        onClick: () => closeConfirm(true),
      },
    ]
  }, [closeConfirm, confirmState])

  const alertActions = useMemo((): WindowModalAction[] => {
    if (!alertState) {
      return []
    }

    return [
      {
        key: 'confirm',
        label: alertState.options.confirmLabel ?? '好',
        tone: 'primary',
        onClick: () => closeAlert(),
      },
    ]
  }, [alertState, closeAlert])

  return (
    <WindowModalContext.Provider value={value}>
      <WindowModalOverlayContext.Provider value={overlayRoot}>
        {children}
        <div
          ref={(node) => setOverlayRoot(node instanceof HTMLDivElement ? node : undefined)}
          class="window-modal-overlay-root"
        >
          <WindowModal
            open={!!promptState}
            title={promptState?.options.title ?? ''}
            themeColor={promptTheme}
            onClose={() => closePrompt(undefined)}
            actions={promptActions}
          >
            {promptState && (
              <>
                <div class="window-modal__field">
                  {promptState.options.label && (
                    <label for="window-modal-prompt-input">{promptState.options.label}</label>
                  )}
                  {(() => {
                    const input = (
                      <input
                        ref={promptInputRef}
                        id="window-modal-prompt-input"
                        type={promptState.options.inputType ?? 'text'}
                        value={promptState.draft}
                        placeholder={promptState.options.placeholder}
                        autoComplete="off"
                        spellcheck={false}
                        onInput={(event) => {
                          const next = (event.currentTarget as HTMLInputElement).value
                          setPromptState({
                            ...promptState,
                            draft: next,
                            error: undefined,
                          })
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            submitPrompt()
                          }
                        }}
                      />
                    )
                    if (!promptState.options.suffix) return input
                    return (
                      <div class="window-modal__input-with-suffix">
                        {input}
                        <span class="window-modal__input-suffix" aria-hidden="true">
                          {promptState.options.suffix}
                        </span>
                      </div>
                    )
                  })()}
                </div>
                {promptState.error && <p class="window-modal__error">{promptState.error}</p>}
              </>
            )}
          </WindowModal>
          <WindowModal
            open={!!confirmState}
            title={confirmState?.options.title ?? ''}
            role="alertdialog"
            themeColor={confirmTheme}
            onClose={() => closeConfirm(false)}
            actions={confirmActions}
          >
            {confirmState && <p class="window-modal__message">{confirmState.options.message}</p>}
          </WindowModal>
          <WindowModal
            open={!!alertState}
            title={alertState?.options.title ?? ''}
            role="alertdialog"
            themeColor={alertTheme}
            onClose={() => closeAlert()}
            actions={alertActions}
          >
            {alertState && <p class="window-modal__message">{alertState.options.message}</p>}
          </WindowModal>
        </div>
      </WindowModalOverlayContext.Provider>
    </WindowModalContext.Provider>
  )
}

export function WindowModalTheme({ themeColor }: { themeColor?: string }) {
  const modal = useWindowModal()

  useEffect(() => {
    modal.setThemeColor(themeColor)
    return () => modal.setThemeColor(undefined)
  }, [modal, themeColor])

  return undefined
}

export function useWindowModal() {
  const context = useContext(WindowModalContext)
  if (!context) {
    throw new Error('useWindowModal must be used within WindowModalProvider')
  }
  return context
}

export function useWindowModalTheme(override?: string): string | undefined {
  const modal = useWindowModal()
  return override ?? modal.themeColor
}
