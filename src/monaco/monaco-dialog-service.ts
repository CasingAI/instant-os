import { Event } from 'monaco-editor/esm/vs/base/common/event.js'
import { StandaloneServices } from 'monaco-editor/esm/vs/editor/standalone/browser/standaloneServices.js'
import { requestMonacoDialog } from './monaco-dialog-store.ts'

type ConfirmArgs = {
  title?: string
  message: string
  detail?: string
  primaryButton?: string
  cancelButton?: string | boolean
}

type PromptButton<T> = {
  label: string
  run: (values: { checkboxChecked?: boolean }) => T | Promise<T>
}

type PromptArgs<T> = {
  type?: number
  message: string
  detail?: string
  buttons?: PromptButton<T>[]
  cancelButton?: string | boolean | PromptButton<T>
}

function stripMnemonic(label: string): string {
  return label.replaceAll('&&', '').replaceAll('&', '')
}

function cancelLabel(cancelButton: ConfirmArgs['cancelButton']): string {
  if (typeof cancelButton === 'string' && cancelButton.trim()) {
    return stripMnemonic(cancelButton)
  }
  return '取消'
}

async function showConfirm(confirmation: ConfirmArgs): Promise<{ confirmed: boolean }> {
  const primary = stripMnemonic(confirmation.primaryButton ?? '确定')
  const cancel = cancelLabel(confirmation.cancelButton)
  const key = await requestMonacoDialog({
    title: confirmation.title?.trim() || '确认',
    message: confirmation.message,
    detail: confirmation.detail,
    buttons: [
      { key: 'cancel', label: cancel, tone: 'secondary' },
      { key: 'primary', label: primary, tone: 'primary' },
    ],
    dismissKey: 'cancel',
  })
  return { confirmed: key === 'primary' }
}

async function showPrompt<T>(prompt: PromptArgs<T>): Promise<{ result: T | undefined }> {
  const buttons: PromptButton<T>[] = [...(prompt.buttons ?? [])]
  let cancelRunner: PromptButton<T> | undefined

  if (prompt.cancelButton && typeof prompt.cancelButton === 'object') {
    cancelRunner = prompt.cancelButton
    buttons.push(prompt.cancelButton)
  }

  if (buttons.length === 0) {
    await requestMonacoDialog({
      title: '提示',
      message: prompt.message,
      detail: prompt.detail,
      buttons: [{ key: 'ok', label: '确定', tone: 'primary' }],
      dismissKey: 'ok',
    })
    return { result: undefined }
  }

  const uiButtons = buttons.map((button, index) => ({
    key: `btn-${index}`,
    label: stripMnemonic(button.label),
    tone:
      button === cancelRunner || (cancelRunner === undefined && index === buttons.length - 1)
        ? ('secondary' as const)
        : index === 0
          ? ('primary' as const)
          : ('secondary' as const),
  }))

  const key = await requestMonacoDialog({
    title: '确认',
    message: prompt.message,
    detail: prompt.detail,
    buttons: uiButtons,
    dismissKey: cancelRunner
      ? `btn-${buttons.indexOf(cancelRunner)}`
      : uiButtons[uiButtons.length - 1]?.key,
  })

  const index = Number(key.replace('btn-', ''))
  const chosen = buttons[index]
  if (!chosen) {
    return { result: undefined }
  }
  const result = await chosen.run({ checkboxChecked: undefined })
  return { result }
}

/** Monaco standalone 对话框服务：走 OS 风格弹窗，不再调用 window.confirm。 */
export function createMonacoDialogService() {
  return {
    onWillShowDialog: Event.None,
    onDidShowDialog: Event.None,

    async confirm(confirmation: ConfirmArgs) {
      const { confirmed } = await showConfirm(confirmation)
      return { confirmed }
    },

    async prompt<T>(prompt: PromptArgs<T>) {
      return showPrompt(prompt)
    },

    async info(message: string, detail?: string) {
      await showPrompt({ type: 1, message, detail })
    },

    async warn(message: string, detail?: string) {
      await showPrompt({ type: 2, message, detail })
    },

    async error(message: string, detail?: string) {
      await showPrompt({
        type: 3,
        message,
        detail,
        buttons: [
          {
            label: '确定',
            run: () => undefined,
          },
        ],
      })
    },

    async input() {
      return { confirmed: false }
    },

    async about() {
      return undefined
    },
  }
}

let dialogServiceInstalled = false

/** 必须在首个编辑器 / StandaloneServices.get 之前调用。 */
export function installMonacoDialogService(): void {
  if (dialogServiceInstalled) return
  dialogServiceInstalled = true
  StandaloneServices.initialize({
    dialogService: createMonacoDialogService(),
  })
}
