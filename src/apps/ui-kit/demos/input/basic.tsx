import { useState } from 'preact/hooks'
import { Input } from '../../../../ui/input.tsx'
import { DemoVariants, DemoVariant } from '../../ui-kit-demo-shared.tsx'

export default function InputDemo() {
  const [value, setValue] = useState('示例文本')
  const [dictationValue, setDictationValue] = useState('')
  const [textareaValue, setTextareaValue] = useState('第一行\n第二行')

  return (
    <DemoVariants>
      <DemoVariant label="基础" wide>
        <Input
          value={value}
          placeholder="请输入…"
          onInput={(event) => setValue((event.target as HTMLInputElement).value)}
        />
      </DemoVariant>
      <DemoVariant label="多行文本域（Input.TextArea）" wide>
        <Input.TextArea
          rows={3}
          value={textareaValue}
          placeholder="多行输入…"
          onInput={(event) =>
            setTextareaValue((event.target as HTMLTextAreaElement).value)
          }
        />
      </DemoVariant>
      <DemoVariant label="禁用" wide>
        <Input value="不可编辑" disabled />
      </DemoVariant>
      <DemoVariant label="语音听写（需开启开发者选项 → 语音实验室）" wide>
        <Input
          value={dictationValue}
          placeholder="长按空格说话，松手插入…"
          onInput={(event) =>
            setDictationValue((event.target as HTMLInputElement).value)
          }
        />
      </DemoVariant>
    </DemoVariants>
  )
}
