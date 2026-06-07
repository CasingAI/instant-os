import type { RefObject } from 'preact'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'

type EditableDetailFieldProps = {
  value: string
  onSave: (value: string) => void
  multiline?: boolean
  class?: string
  disabled?: boolean
}

function countLines(text: string): number {
  if (!text) {
    return 1
  }
  return text.split('\n').length
}

function fitTextareaHeight(element: HTMLTextAreaElement) {
  element.style.height = '0'
  element.style.height = `${element.scrollHeight}px`
}

export function EditableDetailField({
  value,
  onSave,
  multiline,
  class: className,
  disabled,
}: EditableDetailFieldProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>()
  const textareaRef = useRef<HTMLTextAreaElement>()

  useEffect(() => {
    if (!editing) {
      setDraft(value)
    }
  }, [value, editing])

  const resizeTextarea = useCallback(() => {
    const element = textareaRef.current
    if (element) {
      fitTextareaHeight(element)
    }
  }, [])

  useEffect(() => {
    if (!editing) {
      return
    }

    const element = multiline ? textareaRef.current : inputRef.current
    element?.focus()
    if (multiline && element instanceof HTMLTextAreaElement) {
      fitTextareaHeight(element)
      element.setSelectionRange(element.value.length, element.value.length)
    }
  }, [editing, multiline, resizeTextarea])

  useEffect(() => {
    if (editing && multiline) {
      resizeTextarea()
    }
  }, [draft, editing, multiline, resizeTextarea])

  const commit = () => {
    const trimmed = draft.trim()
    if (trimmed !== value.trim()) {
      onSave(trimmed)
    }
    setEditing(false)
  }

  const cancel = () => {
    setDraft(value)
    setEditing(false)
  }

  const editClass = `appstore-detail__edit${multiline ? ' appstore-detail__edit--multiline' : ''}${
    className ? ` ${className}` : ''
  }`

  if (editing) {
    if (multiline) {
      const rows = Math.max(3, countLines(draft))
      return (
        <div class="appstore-detail__edit-wrap">
          <textarea
            ref={textareaRef as RefObject<HTMLTextAreaElement>}
            class={editClass}
            rows={rows}
            value={draft}
            onInput={(event) => {
              setDraft((event.target as HTMLTextAreaElement).value)
              fitTextareaHeight(event.target as HTMLTextAreaElement)
            }}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                cancel()
              }
            }}
          />
          <span class="appstore-detail__edit-actions">失焦保存 · Esc 取消 · Enter 换行</span>
        </div>
      )
    }

    return (
      <input
        ref={inputRef as RefObject<HTMLInputElement>}
        type="text"
        class={`${editClass} appstore-detail__edit--inline`}
        value={draft}
        onInput={(event) => setDraft((event.target as HTMLInputElement).value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            cancel()
          }
        }}
      />
    )
  }

  const editableClass = `appstore-detail__editable${multiline ? ' appstore-detail__editable--multiline' : ''}${
    className ? ` ${className}` : ''
  }${disabled ? '' : ' appstore-detail__editable--active'}`

  const Tag = multiline ? 'div' : 'span'

  return (
    <Tag
      class={editableClass}
      onDblClick={() => {
        if (!disabled) {
          setEditing(true)
        }
      }}
      title={disabled ? undefined : '双击编辑'}
    >
      {value}
    </Tag>
  )
}
