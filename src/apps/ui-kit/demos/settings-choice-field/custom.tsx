import { useState } from 'preact/hooks'
import { SettingsChoiceField } from '../../../../ui/settings-choice-field.tsx'
import { DemoVariants, DemoVariant } from '../../ui-kit-demo-shared.tsx'

export default function SettingsChoiceFieldCustomDemo() {
  const [region, setRegion] = useState('cn')
  const [sort, setSort] = useState('name')

  const regionOptions = [
    { id: 'cn', label: '中国大陆' },
    { id: 'hk', label: '中国香港' },
    { id: 'us', label: '美国' },
  ]
  const sortOptions = [
    { id: 'name', label: '按名称' },
    { id: 'date', label: '按日期' },
    { id: 'size', label: '按大小' },
  ]

  return (
    <DemoVariants>
      <DemoVariant label="自定义 children">
        <SettingsChoiceField
          label="地区"
          value={region}
          options={regionOptions}
          onChange={setRegion}
          wideLayout={true}
        >
          {({ open, setOpen, triggerRef, displayValue }) => (
            <button
              ref={triggerRef}
              type="button"
              onClick={() => setOpen(!open)}
              class="ui-kit-demo__custom-trigger"
            >
              🌍 {displayValue}
              <span class="ui-kit-demo__custom-trigger-caret">{open ? '▲' : '▼'}</span>
            </button>
          )}
        </SettingsChoiceField>
      </DemoVariant>

      <DemoVariant label="自定义 + dark">
        <SettingsChoiceField
          label="排序"
          value={sort}
          options={sortOptions}
          onChange={setSort}
          wideLayout={true}
          dark
        >
          {({ open, setOpen, triggerRef, displayValue }) => (
            <button
              ref={triggerRef}
              type="button"
              onClick={() => setOpen(!open)}
              class="ui-kit-demo__custom-trigger ui-kit-demo__custom-trigger--accent"
            >
              {displayValue}
              <span class="ui-kit-demo__custom-trigger-caret">{open ? '▲' : '▼'}</span>
            </button>
          )}
        </SettingsChoiceField>
      </DemoVariant>
    </DemoVariants>
  )
}
