import { useState } from 'preact/hooks'
import { List } from '../../../../ui/list.tsx'
import { ListItem, type ListChoiceOption } from '../../../../ui/list-item.tsx'
import { DemoVariants, DemoVariant } from '../../ui-kit-demo-shared.tsx'

const SIZE_OPTIONS: ListChoiceOption[] = [
  { id: 'small', label: '小' },
  { id: 'medium', label: '中' },
  { id: 'large', label: '大' },
]

const LANGUAGE_OPTIONS: ListChoiceOption[] = [
  { id: 'zh', label: '中文' },
  { id: 'en', label: 'English' },
  { id: 'ja', label: '日本語' },
]

export default function ListChoiceDemo() {
  const [size, setSize] = useState('medium')
  const [lang, setLang] = useState('zh')
  const [navigateCount, setNavigateCount] = useState(0)
  const jump = () => setNavigateCount((count) => count + 1)

  return (
    <DemoVariants>
      <DemoVariant label="自动判定（宽容器）" wide>
        <List variant="grouped">
          <ListItem
            label="字号"
            options={SIZE_OPTIONS}
            choiceValue={size}
            onChoiceChange={setSize}
            onChoiceNavigate={jump}
          />
          <ListItem
            label="语言"
            options={LANGUAGE_OPTIONS}
            choiceValue={lang}
            onChoiceChange={setLang}
            onChoiceNavigate={jump}
          />
          <ListItem label="普通行（对照）" onClick={() => {}} accessory="disclosure" />
        </List>
        <p class="ui-kit-demo__status">
          容器宽 ≤520 判窄、≥580 判宽（滞回），点行行为随之切换：宽弹选择菜单、窄走 onChoiceNavigate（演示里只计数，已触发 {navigateCount} 次）
        </p>
      </DemoVariant>

      <DemoVariant label="窄容器（自动判窄）">
        <div style={{ maxWidth: 320 }}>
          <List variant="grouped">
            <ListItem
              label="字号"
              options={SIZE_OPTIONS}
              choiceValue={size}
              onChoiceChange={setSize}
              onChoiceNavigate={jump}
            />
          </List>
        </div>
        <p class="ui-kit-demo__status">
          容器只有 320px，点行不弹菜单，直接触发 onChoiceNavigate（已触发 {navigateCount} 次）——真实用法里这里接 nav.navigate 跳选择子页
        </p>
      </DemoVariant>

      <DemoVariant label="choiceLayout 强制覆盖" wide>
        <div class="ui-kit-demo__row" style={{ alignItems: 'flex-start' }}>
          <div style={{ maxWidth: 320 }}>
            <List variant="grouped" choiceLayout="wide">
              <ListItem
                label="强制宽"
                options={SIZE_OPTIONS}
                choiceValue={size}
                onChoiceChange={setSize}
                onChoiceNavigate={jump}
              />
            </List>
            <p class="ui-kit-demo__status">窄容器也弹菜单</p>
          </div>
          <div style={{ maxWidth: 320 }}>
            <List variant="grouped" choiceLayout="narrow">
              <ListItem
                label="强制窄"
                options={SIZE_OPTIONS}
                choiceValue={size}
                onChoiceChange={setSize}
                onChoiceNavigate={jump}
              />
            </List>
            <p class="ui-kit-demo__status">宽容器也只走回调</p>
          </div>
        </div>
      </DemoVariant>
    </DemoVariants>
  )
}
