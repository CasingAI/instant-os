type GomokuModelNameProps = {
  name: string
  class?: string
}

export function GomokuModelName({ name, class: className }: GomokuModelNameProps) {
  return <span class={`gomoku-app__model-name${className ? ` ${className}` : ''}`}>{name}</span>
}
