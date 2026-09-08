import { useState } from 'preact/hooks'
import { List } from '../../../../ui/list.tsx'
import { ListItem } from '../../../../ui/list-item.tsx'
import { HelpHint } from '../../../../ui/help-hint.tsx'
import { DemoVariants, DemoVariant } from '../../ui-kit-demo-shared.tsx'

export default function ListItemDemo() {
  const leading = (emoji: string, color: string) => (
    <span
      style={{
        width: '26px',
        height: '26px',
        borderRadius: '6px',
        background: color,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '14px',
      }}
    >
      {emoji}
    </span>
  )
  const [tapped, setTapped] = useState<string | null>(null)

  return (
    <DemoVariants>
      <DemoVariant label="槽位：值 / 副标题 / 图标 / 徽章 / extra（可点行有 hover/按下反馈，信息行零反馈）" wide>
        <List>
          <ListItem label="网络" value="Wi-Fi" accessory="disclosure" onClick={() => setTapped('网络')} />
          <ListItem
            label="面容解锁"
            subtitle="抬起唤醒并注视屏幕以解锁"
            accessory="disclosure"
            onClick={() => setTapped('面容解锁')}
          />
          <ListItem leading={leading('🎵', '#fa5c8f')} label="音乐" value="128 GB" />
          <ListItem label="测试通道" badge="BETA" value="已加入" />
          <ListItem label="上次备份" extra={<span class="list-item__value">2 分钟前</span>} />
        </List>
        {tapped && <p class="ui-kit-demo__status">已点按：{tapped}</p>}
      </DemoVariant>
      <DemoVariant label="行内说明钮：extra 槽放 HelpHint（点说明钮不触发行）">
        <List>
          <ListItem
            label="iCloud 云盘"
            extra={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <span class="list-item__value">已开启</span>
                <HelpHint text="开启后本机的文档与桌面数据会同步到 iCloud 云盘。" />
              </span>
            }
            onClick={() => setTapped('iCloud 云盘')}
          />
          <ListItem
            label="查找我的 iPhone"
            extra={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <span class="list-item__value">关闭</span>
                <HelpHint text="开启后设备丢失时可在「查找」App 里定位、锁定或抹掉它。" />
              </span>
            }
            onClick={() => setTapped('查找我的 iPhone')}
          />
        </List>
      </DemoVariant>
    </DemoVariants>
  )
}
