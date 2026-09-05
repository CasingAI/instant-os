import { useState } from 'preact/hooks'
import { List, ListSection } from '../../../../ui/list.tsx'
import { groupByIndexLetter } from '../../../../ui/list-index.ts'
import { ListItem } from '../../../../ui/list-item.tsx'
import { IosRangeSlider } from '../../../../ui/ios-range-slider.tsx'
import { DemoVariants, DemoVariant } from '../../ui-kit-demo-shared.tsx'

export default function ListIndexDemo() {
  // 平铺名单 → groupByIndexLetter 自动归节排序。姓氏模式修正默认词典的姓氏读音
  // （曾小贤→Z、单雄信→S、仇英→Q）；List 组件只按 DOM 顺序收集节，「标签非降序」
  // 这条排序契约由数据侧的输出保证（A-Z 升序、# 沉底、组内按全拼）
  const names = [
    '0 元秒杀',
    '12306 客服',
    '24 便利店',
    '3M 便利贴',
    '4S 店小哥',
    '58 同城',
    '618 大促',
    '7-11 便当',
    '8 折优惠券',
    '9 键输入法',
    '阿福',
    '安琪',
    '敖丙',
    '艾克',
    '白露',
    '包拯',
    '百晓生',
    '北岛',
    '毕加索',
    '曹操',
    '陈皮',
    '蔡文姬',
    '晁盖',
    '车晓',
    '丁丁',
    '大卫',
    '貂蝉',
    '杜甫',
    '董卓',
    '恩雅',
    '耳东',
    '范闲',
    '飞白',
    '方鸿',
    '冯程程',
    '傅雷',
    '关雎',
    '归海',
    '高渐离',
    '郭靖',
    '顾城',
    '韩非',
    '何晏',
    '胡杨',
    '华佗',
    '黄盖',
    '花木兰',
    'Ivy',
    '建安',
    '九斤',
    '姜子牙',
    '金铃儿',
    '贾宝玉',
    '纪晓岚',
    '快雪',
    '凯风',
    '孔明',
    '柯南',
    '李白',
    '林徽',
    '柳如是',
    '刘备',
    '陆游',
    '鲁智深',
    '马良',
    '木心',
    '毛遂',
    '孟姜女',
    '米芾',
    '南音',
    '妞妞',
    '倪妮',
    '聂小倩',
    '牛皋',
    '欧阳',
    'Olivia',
    '潘安',
    '彭小满',
    '萍聚',
    '皮皮',
    '仇英',
    '钱塘',
    '青梅',
    '秦筝',
    '乔峰',
    '屈原',
    '任盈盈',
    '若曦',
    '阮小二',
    '单雄信',
    '苏轼',
    '石秀',
    '史湘云',
    '孙悟空',
    '宋江',
    '沈眉庄',
    '施小雅',
    '唐寅',
    '陶朱',
    '汤唯',
    '铁拐李',
    'Una',
    'Vivian',
    '王维',
    '吴刚',
    '魏征',
    '温宁',
    '徐霞',
    '薛涛',
    '夏侯惇',
    '谢小楼',
    '项少龙',
    '颜回',
    '虞姬',
    '严守一',
    '余则成',
    '杨过',
    '叶问',
    '张良',
    '庄周',
    '赵子龙',
    '郑和',
    '周瑜',
    '朱迪',
    '曾小贤',
  ]
  const groups = groupByIndexLetter(names, (name) => name, { surname: true })

  // 可调高度变体：滑杆经 CSS 变量驱动滚动体 max-height，List 内部的 ResizeObserver 会实时重算压缩档
  const [bodyHeight, setBodyHeight] = useState(280)

  // 分类数量滑杆变体：超市分类名池先按拼音归组排序（扁平化后仍保持拼音序，字母档
  // 不会触发排序契约告警），滑杆取前 N——默认 280px 高度下 N≤12 首字档、
  // 13~21 字母档、≥22 采样档，一杆看全三档
  const CATEGORY_POOL = [
    '水果类',
    '蔬菜类',
    '肉禽蛋',
    '海鲜水产',
    '粮油调味',
    '酒水饮料',
    '乳制品',
    '烘焙面点',
    '休闲零食',
    '糖果巧克力',
    '方便速食',
    '罐头腌渍',
    '茶叶咖啡',
    '个人护理',
    '美容护肤',
    '口腔护理',
    '纸品清洁',
    '家庭清洁',
    '厨房用品',
    '小家电',
    '数码配件',
    '文具玩具',
    '母婴用品',
    '宠物用品',
    '内衣袜子',
    '男装',
    '女装',
    '童装童鞋',
    '鞋靴箱包',
    '床上用品',
    '家居收纳',
    '绿植园艺',
    '五金工具',
    '汽车用品',
    '医药保健',
    '节令礼品',
  ]
  const sortedCategories = groupByIndexLetter(CATEGORY_POOL, (cat) => cat).flatMap(
    (group) => group.items,
  )
  const [catCount, setCatCount] = useState(8)

  const renderCategorySections = () =>
    sortedCategories.slice(0, catCount).map((cat) => (
      <ListSection key={cat} id={`cat-${cat}`} title={cat}>
        <ListItem label={`${cat}·精选`} value="详情" accessory="disclosure" onClick={() => {}} />
        <ListItem label={`${cat}·促销`} value="详情" accessory="disclosure" onClick={() => {}} />
        <ListItem label={`${cat}·新品`} value="详情" accessory="disclosure" onClick={() => {}} />
      </ListSection>
    ))

  const renderSections = () =>
    groups.map((group) => (
      <ListSection key={group.label} id={group.label} title={group.label}>
        {group.items.map((name) => (
          <ListItem key={name} label={name} value="详情" accessory="disclosure" onClick={() => {}} />
        ))}
      </ListSection>
    ))

  // 姓氏模式对比用的小名单：默认词典按普通话默认读音归组（曾→C/单→D/仇→C），
  // surname 开启才按姓氏读音（曾→Z/单→S/仇→Q）
  const MINI_NAMES = ['曾小明', '单雄信', '仇英']
  const renderMiniGroups = (surname: boolean) =>
    groupByIndexLetter(MINI_NAMES, (name) => name, { surname }).map((group) => (
      <ListSection
        key={`${surname}-${group.label}`}
        id={`${surname}-${group.label}`}
        title={group.label}
      >
        {group.items.map((name) => (
          <ListItem key={name} label={name} accessory="disclosure" />
        ))}
      </ListSection>
    ))

  return (
    <DemoVariants>
      <DemoVariant label="分类数量滑杆：三档全自动——节少条上显示标题首字（水果类→水），节多降为拼音首字母（水果类→S），再多槽位放不下走隔位采样" wide>
        <IosRangeSlider
          value={catCount}
          min={4}
          max={36}
          step={1}
          suffix="节"
          label="分类数量"
          marks={[
            { value: 12, label: '首字上限' },
            { value: 22, label: '采样' },
          ]}
          onChange={setCatCount}
        />
        <List indexBar scrollable>{renderCategorySections()}</List>
      </DemoVariant>
      <DemoVariant label="拖滑杆调高度：索引条实时在 全字母 / 隔位采样 之间切换" wide>
        <div
          class="ui-kit-demo__index-height-host"
          style={{ ['--ui-kit-demo-index-height' as string]: `${bodyHeight}px` }}
        >
          <IosRangeSlider
            value={bodyHeight}
            min={120}
            max={600}
            step={10}
            suffix="px"
            label="滚动体高度"
            marks={[
              { value: 280, label: '默认' },
              { value: 440, label: '全字母' },
            ]}
            onChange={setBodyHeight}
          />
          <List indexBar scrollable bodyClass="ui-kit-demo__list-body-variable">
            {renderSections()}
          </List>
        </div>
      </DemoVariant>
      <DemoVariant label="空间充足：27 格全字母（440px）" wide>
        <List indexBar scrollable bodyClass="ui-kit-demo__list-body-tall">
          {renderSections()}
        </List>
      </DemoVariant>
      <DemoVariant label="空间不足：只渲染采样字母（触点按全节等比映射）">
        <List indexBar scrollable>{renderSections()}</List>
      </DemoVariant>
      <DemoVariant label="节标题悬停：滚到滚动体顶部即钉住、被下一节顶走（无索引条）">
        <List scrollable>{renderSections()}</List>
      </DemoVariant>
      <DemoVariant label="词组节标题：左侧完整词组，节少时条上自动显示标题首字（水果类→水、蔬菜类→蔬），同条标签语言统一；id 只做锚点可任意命名">
        <List indexBar scrollable>
          <ListSection id="fruit" title="水果类">
            <ListItem label="苹果" value="详情" accessory="disclosure" onClick={() => {}} />
            <ListItem label="香蕉" value="详情" accessory="disclosure" onClick={() => {}} />
            <ListItem label="脐橙" value="详情" accessory="disclosure" onClick={() => {}} />
            <ListItem label="葡萄" value="详情" accessory="disclosure" onClick={() => {}} />
          </ListSection>
          <ListSection id="veg" title="蔬菜类">
            <ListItem label="白菜" value="详情" accessory="disclosure" onClick={() => {}} />
            <ListItem label="菠菜" value="详情" accessory="disclosure" onClick={() => {}} />
            <ListItem label="青椒" value="详情" accessory="disclosure" onClick={() => {}} />
            <ListItem label="茄子" value="详情" accessory="disclosure" onClick={() => {}} />
          </ListSection>
        </List>
      </DemoVariant>
      <DemoVariant label="indexLabel 显式覆盖：显式值任何档位原样上条（可与首字/拼音都无关，派生不准时兜底）">
        <List indexBar scrollable>
          <ListSection id="clearance" title="清仓特惠" indexLabel="C">
            <ListItem label="库存尾货" value="详情" accessory="disclosure" onClick={() => {}} />
          </ListSection>
          <ListSection id="hot" title="热销单品" indexLabel="H">
            <ListItem label="本周销冠" value="详情" accessory="disclosure" onClick={() => {}} />
          </ListSection>
          <ListSection id="new-arrival" title="新品上架" indexLabel="N">
            <ListItem label="首发开售" value="详情" accessory="disclosure" onClick={() => {}} />
          </ListSection>
        </List>
      </DemoVariant>
      <DemoVariant label="姓氏模式对比：默认词典把多音姓按默认读音归组（曾→C/单→D/仇→C），surname 显式开启才按姓氏读音（曾→Z/单→S/仇→Q）；普通词勿开（曾经沧海→zeng…）">
        <List title="默认词典">
          {renderMiniGroups(false)}
        </List>
        <List title="surname: true（人名列表用）">
          {renderMiniGroups(true)}
        </List>
      </DemoVariant>
      <DemoVariant label="乱序数据：条上字母乱序（M→A→Z），跳转仍工作但语义错乱，dev 控制台出排序契约告警（生产静默）——数据侧应 groupByIndexLetter 归组或修正节顺序">
        <List indexBar scrollable>
          <ListSection id="demo-m" title="M">
            <ListItem label="马良" value="详情" accessory="disclosure" onClick={() => {}} />
            <ListItem label="米芾" value="详情" accessory="disclosure" onClick={() => {}} />
          </ListSection>
          <ListSection id="demo-a" title="A">
            <ListItem label="阿福" value="详情" accessory="disclosure" onClick={() => {}} />
            <ListItem label="安琪" value="详情" accessory="disclosure" onClick={() => {}} />
          </ListSection>
          <ListSection id="demo-z" title="Z">
            <ListItem label="张良" value="详情" accessory="disclosure" onClick={() => {}} />
          </ListSection>
        </List>
      </DemoVariant>
    </DemoVariants>
  )
}
