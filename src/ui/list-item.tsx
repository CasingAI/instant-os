import type { ComponentChildren, JSX } from 'preact'
import { useContext, useEffect, useRef, useState } from 'preact/hooks'
import { ForwardIcon, GrabberIcon, InfoIcon } from '../icons/app-icons.tsx'
import { SettingsChoicePopoverMenu } from './settings-choice-popover-menu.tsx'
import { getFloatingOverlayRoot } from './floating-overlay-root.ts'
import { ListContext, type ListPointerEvent } from './list.tsx'

export type ListItemAccessory = 'none' | 'disclosure' | 'check' | 'detail'

/** 选择行的一个选项（与 SettingsChoiceOption 同构，独立定义避免跨家族耦合）。 */
export type ListChoiceOption = { id: string; label: string }

type ListItemProps = {
  /** 稳定 id：List 受控单选（selectedId/onSelect）与编辑模式（删除/重排）靠它结合。 */
  id?: string
  /** 左侧主标题。 */
  label?: ComponentChildren
  /** 灰色第二行副标题。 */
  subtitle?: ComponentChildren
  /** 左侧图标/头像位。 */
  leading?: ComponentChildren
  /** plain 变体专用：首行右上角落位（日期/时间）。grouped 忽略。 */
  trailing?: ComponentChildren
  /** plain 变体专用：末行灰色摘要行。grouped 忽略。 */
  preview?: ComponentChildren
  /** plain 变体专用：未读态——标题/副标题置粗。grouped 忽略。 */
  unread?: boolean
  /** 右侧值文本（与 extra 二选一）。grouped 专属槽位，plain 忽略。 */
  value?: ComponentChildren
  /** 右侧自定义内容（与 value 二选一）。grouped 专属槽位，plain 忽略。 */
  extra?: ComponentChildren
  /** 控件槽：放 Switch / Input 等，点击不再触发行选中。grouped 专属槽位，plain 忽略。 */
  control?: ComponentChildren
  /** 右侧配件：chevron 箭头 / 选中勾（跟随选中态）/ 蓝色 ⓘ 详情钮。 */
  accessory?: ListItemAccessory
  /** 名称旁的徽章文本。 */
  badge?: string
  /** 强制选中态；缺省时由 List 的 selectedId 结合 id 推导。 */
  selected?: boolean
  disabled?: boolean
  /** 有 onClick（或参与 List 受控单选）渲染为 button（可交互行），否则渲染为 div（静态行）；
   *  编辑模式只暂停行为（aria-disabled），不再换标签——换标签会重建整行 DOM，动画全断。 */
  onClick?: () => void
  /** 选择行：传入选项后本行变为选择行——右侧显示当前值，点行按 List 判定的宽窄
   *  行为响应：宽容器在行旁弹选择菜单，窄容器调 onChoiceNavigate（缺省回退弹菜单）。 */
  options?: readonly ListChoiceOption[]
  /** 选择行当前值（options 里某个 id）。 */
  choiceValue?: string
  /** 选择行：菜单里选中某项的回调；选中后菜单自行收起。 */
  onChoiceChange?: (id: string) => void
  /** 选择行：窄容器点行的跳转回调（跳哪由调用方接 Nav）。缺省回退为弹菜单。 */
  onChoiceNavigate?: () => void
  /** 覆盖选择行右侧显示文本；缺省按 choiceValue 从 options 找 label，找不到原样显示 choiceValue。 */
  choiceDisplayValue?: string
  class?: string
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'class'>

/**
 * List 的组合行，同一组件按 List 的 variant 双分支渲染：grouped（默认）为单行
 * flex 槽位（AntD List.Item 风格）；plain 为邮件式多行骨架——首行 label+trailing
 * （发件人与日期同行）、subtitle（主题）、preview（灰色摘要），unread 置粗。
 * 行为与 List 结合：带 id 的行自动参与受控单选；List 进入编辑模式时出现删除钮
 * 与排序把手，此时行行为暂停（aria-disabled）而非换标签——换标签会重建整行
 * DOM，动画全断。减号/把手/红钮常驻 DOM，显隐交给编辑态类下的 CSS 过渡——
 * 条件挂载的新元素带着终态样式插入，transition 永远不跑，只会闪现。两支类名
 * 宇宙独立（list-item* / plain-list-item*），机制（armed、拖拽、选中）只有一份。
 */
export function ListItem({
  id,
  label,
  subtitle,
  leading,
  trailing,
  preview,
  unread,
  value,
  extra,
  control,
  options,
  choiceValue,
  onChoiceChange,
  onChoiceNavigate,
  choiceDisplayValue,
  accessory = 'none',
  badge,
  selected,
  disabled,
  onClick,
  class: itemClass,
  ...rest
}: ListItemProps) {
  const list = useContext(ListContext)
  const [armed, setArmed] = useState(false)
  // 点闪（iOS deselectRow 式）两相：hold = 蓝底反白硬切保持 0.5s；out = 墨水与
  // 蓝底覆盖层同速 400ms 一起淡出（iOS 原版 cell 退场是整层一起淡，文字不先于
  // 背景弹回常态）。只服务于纯动作行——选中行的反馈由选中状态自身承载，不做点闪
  const [flashPhase, setFlashPhase] = useState<'hold' | 'out' | 'idle'>('idle')
  const flashTimer = useRef<number | undefined>(undefined)

  // 选择行：options 非空即生效。弹层锚点是行根本体；宽窄形态由 List 实测后经
  // Context 下发（choiceNarrow），行只管按形态分流点击与收放菜单。
  const isChoice = options !== undefined && options.length > 0
  const choiceNarrow = isChoice && list.choiceNarrow === true
  const [choiceOpen, setChoiceOpen] = useState(false)
  const rowRef = useRef<HTMLElement>(null)
  const setRowRef = (node: HTMLElement | null) => {
    rowRef.current = node
  }
  const choiceDisplay =
    choiceDisplayValue ??
    options?.find((option) => option.id === choiceValue)?.label ??
    choiceValue

  useEffect(() => {
    if (choiceNarrow) setChoiceOpen(false)
  }, [choiceNarrow])

  useEffect(() => {
    if (!list.editing) setArmed(false)
  }, [list.editing])

  // 选择行菜单开着时的外点/Esc 关闭（与 SettingsChoiceField 同款判定：行本体
  // 与浮层宿主内的点不关，其余全关）
  useEffect(() => {
    if (!choiceOpen) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (rowRef.current?.contains(target)) {
        return
      }
      if (getFloatingOverlayRoot().contains(target)) {
        return
      }
      setChoiceOpen(false)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setChoiceOpen(false)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [choiceOpen])

  // 进编辑/卸载时清点闪：编辑态行行为暂停，蓝闪不该挂着
  useEffect(() => {
    if (list.editing) {
      window.clearTimeout(flashTimer.current)
      setFlashPhase('idle')
    }
    return () => window.clearTimeout(flashTimer.current)
  }, [list.editing])

  const active =
    selected ??
    (id !== undefined && ((list.selectedId !== undefined && list.selectedId === id) || (list.selectedIds?.includes(id) ?? false)))
  // 蓝底持久高亮只是选中的呈现档位之一：selectionTone="check" 时选中只落勾，蓝底留给按下瞬间反馈
  const showHighlight = active && list.selectionTone !== 'check'
  const actionable =
    onClick !== undefined || isChoice || (id !== undefined && list.onSelect !== undefined)
  // 选择行的箭头配件缺省补上（调用方显式传的 accessory 优先——比如想用勾选样式）
  const effectiveAccessory =
    isChoice && accessory === 'none' ? ('disclosure' as ListItemAccessory) : accessory

  const hasDelete = id !== undefined && list.onDelete !== undefined
  const hasReorder = id !== undefined && list.onReorder !== undefined

  // grouped/plain 两支类名前缀（机制同一份，DOM 骨架与类名按变体分叉）
  const plain = list.variant === 'plain'
  const cp = plain ? 'plain-list-item' : 'list-item'
  // 选择行在 plain 变体没有 value 槽，当前值落到首行 trailing 位
  const plainTrailing = trailing ?? (isChoice && plain ? choiceDisplay : undefined)

  // 选择行的弹出菜单：锚点是行根本体，选中即回调并收起
  const choiceMenu = isChoice ? (
    <SettingsChoicePopoverMenu
      open={choiceOpen}
      anchorRef={rowRef}
      options={options}
      value={choiceValue ?? ''}
      label={typeof label === 'string' ? label : ''}
      onChange={(next) => {
        onChoiceChange?.(next)
        setChoiceOpen(false)
      }}
    />
  ) : undefined

  const handleClick = () => {
    if (armed) {
      setArmed(false)
      return
    }
    if (list.editing) return
    // 选择行独占点击：宽形态开合菜单、窄形态走跳转回调（没传回调则回退弹
    // 菜单，永不出现点了没反应）；不参与行选中与点闪（反馈由菜单/跳转承载）
    if (isChoice) {
      if (choiceNarrow && onChoiceNavigate) {
        onChoiceNavigate()
        return
      }
      setChoiceOpen((open) => !open)
      return
    }
    if (id !== undefined && list.onSelect !== undefined) list.onSelect(id)
    onClick?.()
    // 点闪只属于纯动作行。受控选中行（id+onSelect，或外部 selected）跳过：它们的
    // 反馈由选中状态自己承载，若也点闪，覆盖层会挂在换选后的旧行上滞留 0.5s 再淡出，
    // 肉眼即「旧蓝底慢慢消失」。重复点击顺延保持期（≥0.5s 从最后一次 click 起算）
    const selectionDriven = (id !== undefined && list.onSelect !== undefined) || selected !== undefined
    if (actionable && !selectionDriven) {
      window.clearTimeout(flashTimer.current)
      setFlashPhase('hold')
      flashTimer.current = window.setTimeout(() => {
        setFlashPhase('out')
        // 400ms 与覆盖层 opacity 过渡同速；结束后回 idle 只是摘掉过渡通道，无视觉变化
        flashTimer.current = window.setTimeout(() => setFlashPhase('idle'), 400)
      }, 500)
    }
  }

  const className = [
    cp,
    actionable ? `${cp}--button` : `${cp}--static`,
    showHighlight ? `${cp}--selected` : '',
    armed ? `${cp}--armed` : '',
    flashPhase === 'hold' ? `${cp}--flashed` : flashPhase === 'out' ? `${cp}--flash-out` : '',
    plain && unread ? `${cp}--unread` : '',
    itemClass,
  ]
    .filter(Boolean)
    .join(' ')

  // plain 变体：邮件式多行骨架——首行 label+trailing 同排，下接 subtitle / preview
  const plainContent = (
    <>
      {hasDelete && (
        <span
          class={`${cp}__minus`}
          role="button"
          tabIndex={list.editing ? 0 : -1}
          aria-hidden={!list.editing || undefined}
          aria-label={`删除 ${typeof label === 'string' ? label : '该项'}`}
          onClick={(event) => {
            event.stopPropagation()
            if (list.editing) setArmed(true)
          }}
        />
      )}
      {leading !== undefined && <span class={`${cp}__leading`}>{leading}</span>}
      {label !== undefined && (
        <span class={`${cp}__label`}>
          <span class={`${cp}__line`}>
            <span class={`${cp}__name`}>
              {label}
              {badge !== undefined && <span class={`${cp}__badge`}>{badge}</span>}
            </span>
            {plainTrailing !== undefined && (
              <span class={`${cp}__trailing`}>{plainTrailing}</span>
            )}
          </span>
          {subtitle !== undefined && <span class={`${cp}__subtitle`}>{subtitle}</span>}
          {preview !== undefined && <span class={`${cp}__preview`}>{preview}</span>}
        </span>
      )}
      {effectiveAccessory === 'check' && (
        <span
          class={active ? `${cp}__check` : `${cp}__check ${cp}__check--off`}
          aria-hidden="true"
        >
          ✓
        </span>
      )}
      {effectiveAccessory === 'disclosure' && (
        <span class={`${cp}__disclosure`} aria-hidden="true">
          <ForwardIcon size={13} />
        </span>
      )}
      {effectiveAccessory === 'detail' && (
        <span
          class={`${cp}__detail`}
          role="button"
          tabIndex={0}
          aria-label="详情"
          onClick={(event) => event.stopPropagation()}
        >
          <InfoIcon size={18} />
        </span>
      )}
      {hasReorder && (
        <span
          class={`${cp}__grabber`}
          aria-hidden="true"
          onPointerDown={(event) => {
            event.preventDefault()
            list.beginReorder?.(event as ListPointerEvent, id)
          }}
          onPointerMove={(event) => list.moveReorder?.(event as ListPointerEvent)}
          onPointerUp={() => list.endReorder?.()}
          onLostPointerCapture={() => list.endReorder?.()}
        >
          <GrabberIcon size={12} />
        </span>
      )}
      {hasDelete && (
        <button
          type="button"
          class={`${cp}__delete`}
          tabIndex={armed ? 0 : -1}
          aria-hidden={!armed || undefined}
          onClick={(event) => {
            event.stopPropagation()
            if (id !== undefined) list.onDelete?.(id)
          }}
        >
          删除
        </button>
      )}
    </>
  )

  const content = plain ? (
    plainContent
  ) : (
    <>
      {hasDelete && (
        <span
          class="list-item__minus"
          role="button"
          tabIndex={list.editing ? 0 : -1}
          aria-hidden={!list.editing || undefined}
          aria-label={`删除 ${typeof label === 'string' ? label : '该项'}`}
          onClick={(event) => {
            event.stopPropagation()
            if (list.editing) setArmed(true)
          }}
        />
      )}
      {leading !== undefined && <span class="list-item__leading">{leading}</span>}
      {label !== undefined && (
        <span class="list-item__label">
          <span class="list-item__name">
            {label}
            {badge !== undefined && <span class="list-item__badge">{badge}</span>}
          </span>
          {subtitle !== undefined && <span class="list-item__subtitle">{subtitle}</span>}
        </span>
      )}
      {isChoice ? (
        <span class="list-item__value">{choiceDisplay}</span>
      ) : control !== undefined ? (
        <span
          class="list-item__control"
          onClick={(event) => event.stopPropagation()}
        >
          {control}
        </span>
      ) : extra !== undefined ? (
        <span class="list-item__extra">{extra}</span>
      ) : value !== undefined ? (
        <span class="list-item__value">{value}</span>
      ) : undefined}
      {effectiveAccessory === 'check' && (
        <span
          class={active ? 'list-item__check' : `list-item__check list-item__check--off`}
          aria-hidden="true"
        >
          ✓
        </span>
      )}
      {effectiveAccessory === 'disclosure' && (
        <span class="list-item__disclosure" aria-hidden="true">
          <ForwardIcon size={13} />
        </span>
      )}
      {effectiveAccessory === 'detail' && (
        <span
          class="list-item__detail"
          role="button"
          tabIndex={0}
          aria-label="详情"
          onClick={(event) => event.stopPropagation()}
        >
          <InfoIcon size={18} />
        </span>
      )}
      {hasReorder && (
        <span
          class="list-item__grabber"
          aria-hidden="true"
          onPointerDown={(event) => {
            event.preventDefault()
            list.beginReorder?.(event as ListPointerEvent, id)
          }}
          onPointerMove={(event) => list.moveReorder?.(event as ListPointerEvent)}
          onPointerUp={() => list.endReorder?.()}
          onLostPointerCapture={() => list.endReorder?.()}
        >
          <GrabberIcon size={12} />
        </span>
      )}
      {hasDelete && (
        <button
          type="button"
          class="list-item__delete"
          tabIndex={armed ? 0 : -1}
          aria-hidden={!armed || undefined}
          onClick={(event) => {
            event.stopPropagation()
            if (id !== undefined) list.onDelete?.(id)
          }}
        >
          删除
        </button>
      )}
    </>
  )

  return actionable ? (
    <button
      type="button"
      ref={isChoice ? setRowRef : undefined}
      data-list-item-id={id}
      class={className}
      aria-current={active ? 'true' : undefined}
      aria-disabled={list.editing || undefined}
      aria-haspopup={isChoice && !choiceNarrow ? 'listbox' : undefined}
      aria-expanded={isChoice && !choiceNarrow ? choiceOpen : undefined}
      tabIndex={list.editing ? -1 : undefined}
      disabled={disabled}
      onClick={handleClick}
      {...(rest as JSX.HTMLAttributes<HTMLButtonElement>)}
    >
      {content}
      {choiceMenu}
    </button>
  ) : (
    <div
      ref={isChoice ? setRowRef : undefined}
      data-list-item-id={id}
      class={className}
      aria-current={active ? 'true' : undefined}
      onClick={handleClick}
      {...rest}
    >
      {content}
      {choiceMenu}
    </div>
  )
}
