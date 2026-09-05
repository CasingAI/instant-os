import { useState } from 'preact/hooks'
import { SettingsChoiceField } from '../../../../ui/settings-choice-field.tsx'
import { DemoVariants, DemoVariant } from '../../ui-kit-demo-shared.tsx'

export default function SettingsChoiceFieldBasicDemo() {
  const [theme, setTheme] = useState('auto')
  const [lang, setLang] = useState('zh')
  const [narrow, setNarrow] = useState('medium')

  const themeOptions = [
    { id: 'auto', label: '自动' },
    { id: 'light', label: '浅色' },
    { id: 'dark', label: '深色' },
  ]
  const langOptions = [
    { id: 'zh', label: '中文' },
    { id: 'en', label: 'English' },
    { id: 'ja', label: '日本語' },
  ]
  const sizeOptions = [
    { id: 'small', label: '小' },
    { id: 'medium', label: '中' },
    { id: 'large', label: '大' },
  ]

  return (
    <DemoVariants>
      <DemoVariant label="内置 (form)">
        <SettingsChoiceField
          label="主题"
          value={theme}
          options={themeOptions}
          onChange={setTheme}
          wideLayout={true}
          presentation="form"
          fieldClass="ui-kit-demo__field"
          labelClass="ui-kit-demo__label"
        />
      </DemoVariant>

      <DemoVariant label="内置 (list)">
        <SettingsChoiceField
          label="语言"
          value={lang}
          options={langOptions}
          onChange={setLang}
          wideLayout={true}
          presentation="list"
        />
      </DemoVariant>

      <DemoVariant label="窄屏布局">
        <SettingsChoiceField
          label="字号"
          value={narrow}
          options={sizeOptions}
          onChange={setNarrow}
          wideLayout={false}
          presentation="list"
        />
      </DemoVariant>
    </DemoVariants>
  )
}
