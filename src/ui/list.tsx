import type { ComponentChildren, JSX } from 'preact'

type ListProps = {
  /** 追加到容器的 app 局部修饰类（如 registry__key-list）。 */
  class?: string
  /** 表头内容（span 序列）；有值时渲染 settings__list-head 容器。 */
  head?: ComponentChildren
  /** 追加到表头的变体类（settings__list-head--tokens 等）。 */
  headClass?: string
  /** 滚动体变体类（settings__list-body--apps 等）；有值时 children 包进 settings__list-body。 */
  bodyClass?: string
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'class'>

function joinClass(base: string, extra?: string): string {
  return extra ? `${base} ${extra}` : base
}

/**
 * iOS 设置风格的分组列表容器（settings__list）。行内容放
 * SettingsNavRow / SettingsSwitchRow 等行组件或裸 settings__row。
 * 样式沿用 settings.css，组件自身不携带 CSS。
 */
export function List({ class: listClass, head, headClass, bodyClass, children, ...rest }: ListProps) {
  return (
    <div class={joinClass('settings__list', listClass)} {...rest}>
      {head !== undefined && (
        <div class={joinClass('settings__list-head', headClass)}>{head}</div>
      )}
      {bodyClass !== undefined ? (
        <div class={joinClass('settings__list-body', bodyClass)}>{children}</div>
      ) : (
        children
      )}
    </div>
  )
}
