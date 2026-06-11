import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useWindowModal } from '../../window/window-modal-context.tsx'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import {
  decodeStorageValue,
  encodeStorageValue,
  storageValueKindLabel,
  summarizeStorageValue,
  type StorageValueKind,
} from './icode-app-data-value.ts'
import { IcodeMonacoEditor } from './icode-monaco-editor.tsx'

type IcodeAppDataEditorProps = {
  value: Record<string, string>
  onChange: (value: Record<string, string>) => void
  active: boolean
  onInvalidChange: (invalid: boolean) => void
  narrowLayout: boolean
}

export function IcodeAppDataEditor({
  value,
  onChange,
  active,
  onInvalidChange,
  narrowLayout,
}: IcodeAppDataEditorProps) {
  const modal = useWindowModal()
  const sortedKeys = useMemo(() => Object.keys(value).sort(), [value])
  const [selectedKey, setSelectedKey] = useState<string | undefined>()
  const [editKind, setEditKind] = useState<StorageValueKind>('text')
  const [editBuffer, setEditBuffer] = useState('')
  const [editInvalid, setEditInvalid] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const editingRef = useRef(false)
  const prevNarrowLayoutRef = useRef(narrowLayout)

  useEffect(() => {
    const wasNarrow = prevNarrowLayoutRef.current
    prevNarrowLayoutRef.current = narrowLayout

    if (!wasNarrow && narrowLayout && selectedKey) {
      setDetailOpen(true)
    }
  }, [narrowLayout, selectedKey])

  useEffect(() => {
    if (sortedKeys.length === 0) {
      setSelectedKey(undefined)
      return
    }

    if (!selectedKey || !(selectedKey in value)) {
      setSelectedKey(sortedKeys[0])
    }
  }, [selectedKey, sortedKeys, value])

  useEffect(() => {
    if (!selectedKey || !(selectedKey in value)) {
      setEditKind('text')
      setEditBuffer('')
      setEditInvalid(false)
      onInvalidChange(false)
      return
    }

    if (editingRef.current) {
      return
    }

    const decoded = decodeStorageValue(value[selectedKey] ?? '')
    setEditKind(decoded.kind)
    setEditBuffer(decoded.display)
    setEditInvalid(false)
    onInvalidChange(false)
  }, [onInvalidChange, selectedKey, selectedKey ? value[selectedKey] : undefined])

  const commitBuffer = useCallback(
    (buffer: string, kind: StorageValueKind, key: string) => {
      const encoded = encodeStorageValue(kind, buffer)
      if (encoded === undefined) {
        setEditInvalid(true)
        onInvalidChange(true)
        return
      }

      setEditInvalid(false)
      onInvalidChange(false)
      if (value[key] === encoded) {
        return
      }

      onChange({
        ...value,
        [key]: encoded,
      })
    },
    [onChange, onInvalidChange, value],
  )

  const handleBufferChange = useCallback(
    (next: string) => {
      editingRef.current = true
      setEditBuffer(next)
      if (!selectedKey) {
        return
      }
      commitBuffer(next, editKind, selectedKey)
    },
    [commitBuffer, editKind, selectedKey],
  )

  const finishEditing = useCallback(() => {
    editingRef.current = false
  }, [])

  const openAddDialog = useCallback(async () => {
    const trimmed = await modal.prompt({
      title: '添加 localStorage 键',
      label: '键名',
      placeholder: '例如：userSettings',
      validate: (draft) => {
        const next = draft.trim()
        if (!next) {
          return '键名不能为空'
        }
        if (next in value) {
          return '该键已存在'
        }
        return undefined
      },
    })

    if (!trimmed) {
      return
    }

    editingRef.current = false
    onChange({
      ...value,
      [trimmed]: '',
    })
    setSelectedKey(trimmed)
    if (narrowLayout) {
      setDetailOpen(true)
    }
  }, [modal, narrowLayout, onChange, value])

  const handleDeleteKey = useCallback(() => {
    if (!selectedKey) {
      return
    }

    editingRef.current = false
    const next = { ...value }
    delete next[selectedKey]
    onChange(next)
    setEditInvalid(false)
    onInvalidChange(false)
  }, [onChange, onInvalidChange, selectedKey, value])

  const selectedRaw = selectedKey ? value[selectedKey] : undefined

  return (
    <div
      class={`icode__data-editor${narrowLayout ? ' icode__data-editor--narrow' : ''}${narrowLayout && detailOpen ? ' icode__data-editor--detail-open' : ''}`}
    >
      <div class="icode__data-keys">
        <div class="icode__data-keys-scroll">
          {sortedKeys.length === 0 ? (
            <p class="icode__data-keys-empty">暂无 localStorage 键</p>
          ) : (
            sortedKeys.map((key) => {
              const decoded = decodeStorageValue(value[key] ?? '')
              return (
                <button
                  key={key}
                  type="button"
                  class={`icode__data-key${selectedKey === key ? ' icode__data-key--selected' : ''}`}
                  onClick={() => {
                    editingRef.current = false
                    setSelectedKey(key)
                    if (narrowLayout) {
                      setDetailOpen(true)
                    }
                  }}
                >
                  <span class="icode__data-key-name">{key}</span>
                  <span class="icode__data-key-meta">
                    <span class={`icode__data-kind icode__data-kind--${decoded.kind}`}>
                      {storageValueKindLabel(decoded.kind)}
                    </span>
                    <span class="icode__data-key-preview">{summarizeStorageValue(value[key] ?? '')}</span>
                  </span>
                </button>
              )
            })
          )}
        </div>
        <div class="icode__data-keys-add">
          <button type="button" class="icode__panel-action icode__data-keys-add-button" onClick={() => void openAddDialog()}>
            添加键
          </button>
        </div>
      </div>

      <div class="icode__data-detail">
        {!selectedKey || selectedRaw === undefined ? (
          <p class="icode__data-detail-empty">选择左侧键以编辑其值，或添加新键。</p>
        ) : (
          <>
            <div class="icode__data-detail-header">
              {narrowLayout && (
                <IosNavBackButton
                  class="icode__data-detail-back"
                  label="键列表"
                  aria-label="返回键列表"
                  onClick={() => setDetailOpen(false)}
                />
              )}
              <div class="icode__data-detail-title">
                <span class="icode__data-detail-key">{selectedKey}</span>
                <span class={`icode__data-kind icode__data-kind--${editKind}`}>
                  {storageValueKindLabel(editKind)}
                </span>
              </div>
              <button type="button" class="icode__panel-action icode__panel-action--danger" onClick={handleDeleteKey}>
                删除键
              </button>
            </div>

            {editInvalid && (
              <p class="icode__data-detail-error">当前值格式无效，修正后才能应用。</p>
            )}

            {editKind === 'json' ? (
              <IcodeMonacoEditor
                value={editBuffer}
                onChange={handleBufferChange}
                active={active}
                language="json"
              />
            ) : editKind === 'boolean' ? (
              <div class="icode__data-scalar">
                <label class="icode__data-boolean">
                  <input
                    type="checkbox"
                    checked={editBuffer === 'true'}
                    onChange={(event) => {
                      handleBufferChange((event.currentTarget as HTMLInputElement).checked ? 'true' : 'false')
                    }}
                  />
                  {editBuffer === 'true' ? 'true' : 'false'}
                </label>
              </div>
            ) : editKind === 'number' ? (
              <div class="icode__data-scalar">
                <input
                  type="text"
                  class="icode__data-scalar-input"
                  value={editBuffer}
                  spellcheck={false}
                  inputMode="decimal"
                  onInput={(event) => handleBufferChange((event.currentTarget as HTMLInputElement).value)}
                  onBlur={finishEditing}
                />
              </div>
            ) : (
              <div class="icode__data-scalar icode__data-scalar--text">
                <textarea
                  class="icode__data-scalar-textarea"
                  value={editBuffer}
                  spellcheck={false}
                  onInput={(event) =>
                    handleBufferChange((event.currentTarget as HTMLTextAreaElement).value)
                  }
                  onBlur={finishEditing}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
