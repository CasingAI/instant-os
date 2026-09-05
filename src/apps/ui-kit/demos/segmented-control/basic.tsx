import { useState } from 'preact/hooks'
import { SegmentedControl } from '../../../../ui/segmented-control.tsx'
import { DemoVariants, DemoVariant } from '../../ui-kit-demo-shared.tsx'

export default function SegmentedControlDemo() {
  const [basic, setBasic] = useState('day')
  const [badge, setBadge] = useState('all')
  const [many, setMany] = useState('a')

  return (
    <DemoVariants>
      <DemoVariant label="基础两段" wide>
        <SegmentedControl
          value={basic}
          items={[
            { id: 'day', label: '日' },
            { id: 'week', label: '周' },
            { id: 'month', label: '月' },
          ]}
          onChange={setBasic}
          ariaLabel="时间范围"
        />
      </DemoVariant>
      <DemoVariant label="徽章 + 脏点" wide>
        <SegmentedControl
          value={badge}
          items={[
            { id: 'all', label: '全部', badge: 12 },
            { id: 'unread', label: '未读', badge: 3, dirty: true },
            { id: 'starred', label: '星标' },
          ]}
          onChange={setBadge}
          ariaLabel="消息分类"
        />
      </DemoVariant>
      <DemoVariant label="四段" wide>
        <SegmentedControl
          value={many}
          items={[
            { id: 'a', label: '概览' },
            { id: 'b', label: '详情' },
            { id: 'c', label: '日志' },
            { id: 'd', label: '设置' },
          ]}
          onChange={setMany}
          ariaLabel="页面分段"
        />
      </DemoVariant>
    </DemoVariants>
  )
}
