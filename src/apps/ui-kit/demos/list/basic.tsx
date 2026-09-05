import { useState } from 'preact/hooks'
import { List } from '../../../../ui/list.tsx'
import { ListItem } from '../../../../ui/list-item.tsx'
import { DemoVariants, DemoVariant } from '../../ui-kit-demo-shared.tsx'

export default function ListDemo() {
  const files = [
    { id: 'f1', name: '季度报告.pdf', size: '2.4 MB' },
    { id: 'f2', name: '设计稿.sketch', size: '18.7 MB' },
    { id: 'f3', name: '会议记录.md', size: '12 KB' },
    { id: 'f4', name: '素材包.zip', size: '148 MB' },
  ]
  const [tapped, setTapped] = useState<string | null>(null)

  return (
    <DemoVariants>
      <DemoVariant label="节标题 / 脚注（导航行可点：hover / 按下 / 点闪）" wide>
        <List title="通用" footnote="重置网络设置将清除已保存的 Wi-Fi 密码。">
          <ListItem
            label="关于本机"
            value="iOS 6.1.4"
            accessory="disclosure"
            onClick={() => setTapped('关于本机')}
          />
          <ListItem
            label="软件更新"
            value="已是最新"
            accessory="disclosure"
            onClick={() => setTapped('软件更新')}
          />
        </List>
        {tapped && <p class="ui-kit-demo__status">已点按：{tapped}</p>}
      </DemoVariant>
      <DemoVariant label="表头 + 限高滚动区（数据行无 onClick：零反馈）" wide>
        <List head={<><span>文件</span><span>大小</span></>} scrollable>
          {files.map((file) => (
            <ListItem key={file.id} label={file.name} value={file.size} />
          ))}
        </List>
      </DemoVariant>
    </DemoVariants>
  )
}
