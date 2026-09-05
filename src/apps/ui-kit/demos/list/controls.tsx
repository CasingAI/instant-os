import { useState } from 'preact/hooks'
import { List } from '../../../../ui/list.tsx'
import { ListItem } from '../../../../ui/list-item.tsx'
import { IosSwitch } from '../../../../ui/ios-switch.tsx'
import { IosTextField } from '../../../../ui/ios-text-field.tsx'
import { DemoVariants, DemoVariant } from '../../ui-kit-demo-shared.tsx'

export default function ListControlsDemo() {
  const [wifi, setWifi] = useState(true)
  const [autoDownload, setAutoDownload] = useState(false)
  const [home, setHome] = useState('https://')

  return (
    <DemoVariants>
      <DemoVariant label="control 槽（点控件不触发行）/ 整行点按勾选" wide>
        <List>
          <ListItem
            label="Wi-Fi"
            value={wifi ? '已开启' : '关闭'}
            control={<IosSwitch checked={wifi} onChange={setWifi} label="Wi-Fi" />}
          />
          <ListItem
            label="主页"
            control={
              <IosTextField
                value={home}
                onInput={(event) => setHome(event.currentTarget.value)}
                placeholder="https://"
              />
            }
          />
          <ListItem
            label="自动下载"
            selected={autoDownload}
            accessory="check"
            onClick={() => setAutoDownload(!autoDownload)}
          />
        </List>
      </DemoVariant>
    </DemoVariants>
  )
}
