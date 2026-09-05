import type { ComponentChildren, JSX } from 'preact'
import { useContext, useEffect, useRef, useState } from 'preact/hooks'
import { ForwardIcon, GrabberIcon, InfoIcon } from '../icons/app-icons.tsx'
import { ListContext, type ListPointerEvent } from './list.tsx'

export type ListItemAccessory = 'none' | 'disclosure' | 'check' | 'detail'

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
  /** 控件槽：放 Switch / IosTextField 等，点击不再触发行选中。grouped 专属槽位，plain 忽略。 */
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

  useEffect(() => {
    if (!list.editing) setArmed(false)
  }, [list.editing])

  // 进编辑/卸载时清点闪：编辑态行行为暂停，蓝闪不该挂着
  useEffect(() => {
    if (list.editing) {
      window.clearTimeout(flashTimer.current)
      setFlashPhase('idle')
    }
    return () => window.clearTimeout(flashTimer.current)
  }, [list.editing])

  const active = selected ?? (id !== undefined && list.selectedId !== undefined && list.selectedId === id)
  const actionable = onClick !== undefined || (id !== undefined && list.onSelect !== undefined)

  const hasDelete = id !== undefined && list.onDelete !== undefined
  const hasReorder = id !== undefined && list.onReorder !== undefined

  // grouped/plain 两支类名前缀（机制同一份，DOM 骨架与类名按变体分叉）
  const plain = list.variant === 'plain'
  const cp = plain ? 'plain-list-item' : 'list-item'

  const handleClick = () => {
    if (armed) {
      setArmed(false)
      return
    }
    if (list.editing) return
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
    active ? `${cp}--selected` : '',
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
            {trailing !== undefined && <span class={`${cp}__trailing`}>{trailing}</span>}
          </span>
          {subtitle !== undefined && <span class={`${cp}__subtitle`}>{subtitle}</span>}
          {preview !== undefined && <span class={`${cp}__preview`}>{preview}</span>}
        </span>
      )}
      {accessory === 'check' && active && (
        <span class={`${cp}__check`} aria-hidden="true">
          ✓
        </span>
      )}
      {accessory === 'disclosure' && (
        <span class={`${cp}__disclosure`} aria-hidden="true">
          <ForwardIcon size={13} />
        </span>
      )}
      {accessory === 'detail' && (
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
      {control !== undefined ? (
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
      {accessory === 'check' && active && (
        <span class="list-item__check" aria-hidden="true">
          ✓
        </span>
      )}
      {accessory === 'disclosure' && (
        <span class="list-item__disclosure" aria-hidden="true">
          <ForwardIcon size={13} />
        </span>
      )}
      {accessory === 'detail' && (
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
      data-list-item-id={id}
      class={className}
      aria-current={active ? 'true' : undefined}
      aria-disabled={list.editing || undefined}
      tabIndex={list.editing ? -1 : undefined}
      disabled={disabled}
      onClick={handleClick}
      {...(rest as JSX.HTMLAttributes<HTMLButtonElement>)}
    >
      {content}
    </button>
  ) : (
    <div
      data-list-item-id={id}
      class={className}
      aria-current={active ? 'true' : undefined}
      onClick={handleClick}
      {...rest}
    >
      {content}
    </div>
  )
}
