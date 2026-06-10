import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
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
}

export function IcodeAppDataEditor({
  value,
  onChange,
  active,
  onInvalidChange,
}: IcodeAppDataEditorProps) {
  const sortedKeys = useMemo(() => Object.keys(value).sort(), [value])
  const [selectedKey, setSelectedKey] = useState<string | undefined>()
  const [editKind, setEditKind] = useState<StorageValueKind>('text')
  const [editBuffer, setEditBuffer] = useState('')
  const [editInvalid, setEditInvalid] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [newKeyError, setNewKeyError] = useState<string | undefined>()
  const editingRef = useRef(false)

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

  const handleAddKey = useCallback(() => {
    const trimmed = newKeyName.trim()
    if (!trimmed) {
      setNewKeyError('键名不能为空')
      return
    }
    if (trimmed in value) {
      setNewKeyError('该键已存在')
      return
    }

    editingRef.current = false
    setNewKeyError(undefined)
    setNewKeyName('')
    onChange({
      ...value,
      [trimmed]: '',
    })
    setSelectedKey(trimmed)
  }, [newKeyName, onChange, value])

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
    <div class="icode__data-editor">
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
          <input
            type="text"
            class="icode__data-key-input"
            value={newKeyName}
            placeholder="新键名"
            spellcheck={false}
            onInput={(event) => {
              setNewKeyName((event.currentTarget as HTMLInputElement).value)
              setNewKeyError(undefined)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                handleAddKey()
              }
            }}
          />
          <button type="button" class="icode__panel-action" onClick={handleAddKey}>
            添加
          </button>
        </div>
        {newKeyError && <p class="icode__data-key-error">{newKeyError}</p>}
      </div>

      <div class="icode__data-detail">
        {!selectedKey || selectedRaw === undefined ? (
          <p class="icode__data-detail-empty">选择左侧键以编辑其值，或添加新键。</p>
        ) : (
          <>
            <div class="icode__data-detail-header">
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
