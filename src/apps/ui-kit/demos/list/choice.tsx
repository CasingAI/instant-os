import { useCallback, useState } from 'preact/hooks'
import { List } from '../../../../ui/list.tsx'
import { ListItem, type ListChoiceOption } from '../../../../ui/list-item.tsx'
import { Slider } from '../../../../ui/slider.tsx'
import { Nav, useNav } from '../../../../ui/nav.tsx'
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

/** 判定刻度：≤360 判窄、≥420 判宽（滞回），标在滑轨上 */
const CHOICE_MARKS = [
  { value: 360, label: '判窄' },
  { value: 420, label: '判宽' },
]

export default function ListChoiceDemo() {
  const [size, setSize] = useState('medium')
  const [lang, setLang] = useState('zh')
  const [width, setWidth] = useState(560)
  const [page, setPage] = useState('entry')
  const nav = useNav({ narrowPageForState: () => page })

  const openPicker = useCallback(() => {
    setPage('size')
    nav.navigate('size', 'push')
  }, [nav])

  const goBack = useCallback(() => {
    nav.navigate('entry', 'pop', () => setPage('entry'))
  }, [nav])

  const commit = useCallback(
    (next: string) => {
      setSize(next)
      goBack()
    },
    [goBack],
  )

  const renderPage = (target: string) => {
    if (target === 'size') {
      return (
        <Nav.Page title="字号" backLabel="返回" onBack={goBack}>
          <div style={{ padding: '12px 16px' }}>
            <List
              variant="grouped"
              selectionTone="check"
              selectedId={size}
              onSelect={(id) => commit(id)}
            >
              {SIZE_OPTIONS.map((option) => (
                <ListItem key={option.id} id={option.id} label={option.label} accessory="check" />
              ))}
            </List>
          </div>
        </Nav.Page>
      )
    }
    return (
      <Nav.Page title="设置">
        <div style={{ padding: '12px 16px' }}>
          <List variant="grouped">
            <ListItem
              label="字号"
              options={SIZE_OPTIONS}
              choiceValue={size}
              onChoiceChange={setSize}
              onChoiceNavigate={openPicker}
            />
            <ListItem
              label="语言"
              options={LANGUAGE_OPTIONS}
              choiceValue={lang}
              onChoiceChange={setLang}
            />
          </List>
        </div>
      </Nav.Page>
    )
  }

  return (
    <DemoVariants>
      <DemoVariant label="自动判定（拖宽度看两种行为）" wide>
        <div style={{ maxWidth: 480 }}>
          <Slider
            label="容器宽度"
            suffix="px"
            min={240}
            max={800}
            step={4}
            value={width}
            marks={CHOICE_MARKS}
            onChange={setWidth}
          />
        </div>
        <div
          style={{
            width,
            height: 280,
            border: '1px solid #e5e5e5',
            borderRadius: 10,
            overflow: 'hidden',
            background: '#fff',
          }}
        >
          <Nav controller={nav} frames={[]} renderPage={renderPage} />
        </div>
        <p class="ui-kit-demo__status">
          当前 {width}px：
          {width <= 360
            ? '判窄——点「字号」推入子页选择，选完退回、值回填（真实用法里 onChoiceNavigate 接 nav.navigate）'
            : width >= 420
              ? '判宽——点行在行旁弹选择菜单、选中回填'
              : '滞回区（360/420 之间）——保持拖动前的形态不翻转'}
          ；「语言」没传 onChoiceNavigate，窄容器下回退原地弹菜单
        </p>
      </DemoVariant>

      <DemoVariant label="choiceLayout 强制覆盖" wide>
        <div style={{ maxWidth: 320 }}>
          <List variant="grouped" choiceLayout="wide">
            <ListItem
              label="字号"
              options={SIZE_OPTIONS}
              choiceValue={size}
              onChoiceChange={setSize}
            />
          </List>
        </div>
        <p class="ui-kit-demo__status">
          320px 本来会判窄走子页（把上演示拖到最窄就能看到）；choiceLayout=&quot;wide&quot;
          强制原地弹菜单
        </p>
      </DemoVariant>
    </DemoVariants>
  )
}
