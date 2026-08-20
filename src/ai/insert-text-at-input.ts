/**
 * 在 input / textarea 光标（或选区）处插入文本。
 * 通过设置 value 并派发 InputEvent，兼容受控组件。
 */
export function insertTextAtInput(
  el: HTMLInputElement | HTMLTextAreaElement,
  text: string,
): void {
  if (!text) return

  const start = el.selectionStart ?? el.value.length
  const end = el.selectionEnd ?? start
  const before = el.value.slice(0, start)
  const after = el.value.slice(end)
  const next = before + text + after
  const cursor = start + text.length

  el.value = next
  try {
    el.setSelectionRange(cursor, cursor)
  } catch {
    /* 部分 type（如 number）不支持 selection */
  }

  el.dispatchEvent(
    new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: text,
    }),
  )
}
