import { MonacoEditor } from '../../monaco/monaco-editor.tsx'

type IcodeMonacoEditorProps = {
  value: string
  onChange: (value: string) => void
  active?: boolean
  language?: 'html' | 'json'
}

export function IcodeMonacoEditor({
  value,
  onChange,
  active = true,
  language = 'html',
}: IcodeMonacoEditorProps) {
  return (
    <MonacoEditor
      className="icode__monaco"
      value={value}
      onChange={onChange}
      active={active}
      language={language}
      theme="vs-dark"
      fontSize={12}
      minimap={false}
      wordWrap="on"
    />
  )
}
