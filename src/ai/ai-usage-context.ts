import { APP_REGISTRY } from '../os/app-registry.tsx'

export type AiUsageContext = {
  /** 应用或模块标识，如 browser、news、gen:my-app */
  actor: string
  /** 行为标识，如 generate-page、chat */
  behavior: string
  actorLabel?: string
  behaviorLabel?: string
}

export function resolveActorLabel(actor: string): string {
  const builtin = APP_REGISTRY.find((app) => app.id === actor)
  if (builtin) {
    return builtin.name
  }
  if (actor.startsWith('gen:')) {
    return actor.slice(4)
  }
  if (actor.startsWith('ext:')) {
    return actor.slice(4)
  }
  return actor
}
