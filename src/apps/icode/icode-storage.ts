import { createRegistryStore } from '../../os/registry-store.ts'
import { osNowMs } from '../../os/os-clock.ts'
import type { GeneratedAppDataStore } from '../../os/generated-app-data-storage.ts'
import type { ICodeChatEditBlock, ICodeChatMessage, ICodeInternalProject } from './icode-types.ts'

const registryStore = createRegistryStore<ICodeInternalProject[]>({
  appId: 'icode',
  defaultValue: () => [],
  // 实际线上数据在旧版迁移后落在 'store' 键下，因此以 'store' 作为遗留单键。
  legacyKey: 'store',
  fields: [
    {
      key: 'projects',
      read: (projects) => projects,
      write: (value) => value,
      serialize: (value) => JSON.stringify(value),
      deserialize: (raw) => {
        if (!raw) {
          return []
        }
        try {
          const parsed: unknown = JSON.parse(raw)
          if (!Array.isArray(parsed)) {
            return []
          }
          return parsed.filter(isInternalProject)
        } catch {
          return []
        }
      },
    },
  ],
  changedEventName: 'instant-os:icode-projects-changed',
})

void registryStore.hydrate()

function isStringRecord(value: unknown): value is GeneratedAppDataStore {
  if (typeof value !== 'object' || value === undefined) {
    return false
  }

  return Object.values(value as Record<string, unknown>).every((entry) => typeof entry === 'string')
}

function isChatEditBlock(value: unknown): value is ICodeChatEditBlock {
  if (typeof value !== 'object' || value === undefined) {
    return false
  }

  const block = value as Record<string, unknown>
  return typeof block.search === 'string' && typeof block.replace === 'string'
}

function isChatMessage(value: unknown): value is ICodeChatMessage {
  if (typeof value !== 'object' || value === undefined) {
    return false
  }

  const message = value as Record<string, unknown>
  const edits = message.edits
  return (
    typeof message.id === 'string' &&
    (message.role === 'user' || message.role === 'assistant') &&
    typeof message.content === 'string' &&
    typeof message.createdAt === 'number' &&
    (message.reasoningText === undefined || typeof message.reasoningText === 'string') &&
    (message.fullReply === undefined || typeof message.fullReply === 'string') &&
    (message.outputText === undefined || typeof message.outputText === 'string') &&
    (message.appliedEdits === undefined || typeof message.appliedEdits === 'number') &&
    (edits === undefined || (Array.isArray(edits) && edits.every(isChatEditBlock)))
  )
}

function isInternalProject(value: unknown): value is ICodeInternalProject {
  if (typeof value !== 'object' || value === undefined) {
    return false
  }

  const project = value as Record<string, unknown>
  return (
    typeof project.id === 'string' &&
    typeof project.name === 'string' &&
    typeof project.description === 'string' &&
    typeof project.category === 'string' &&
    typeof project.iconEmoji === 'string' &&
    typeof project.themeColor === 'string' &&
    Array.isArray(project.tags) &&
    typeof project.html === 'string' &&
    isStringRecord(project.appData) &&
    Array.isArray(project.chat) &&
    project.chat.every(isChatMessage) &&
    typeof project.createdAt === 'number' &&
    typeof project.updatedAt === 'number' &&
    (project.linkedAppId === undefined ||
      (typeof project.linkedAppId === 'string' && project.linkedAppId.startsWith('gen:')))
  )
}

export function subscribeInternalProjects(listener: () => void): () => void {
  return registryStore.subscribe(listener)
}

export function loadInternalProjectsSync(): ICodeInternalProject[] {
  return registryStore.readSync() ?? []
}

export async function loadInternalProjects(): Promise<ICodeInternalProject[]> {
  return registryStore.read()
}

export async function createInternalProject(
  name: string,
  description: string,
): Promise<ICodeInternalProject> {
  const now = osNowMs()
  const id = `icode-${now}`
  const project: ICodeInternalProject = {
    id,
    name: name.trim() || '未命名项目',
    description: description.trim() || '在 iCode 中开发的内部微应用',
    category: '内部开发',
    iconEmoji: '🛠️',
    themeColor: '#5856d6',
    tags: [],
    html: '',
    appData: {},
    chat: [],
    linkedAppId: `gen:${id}`,
    createdAt: now,
    updatedAt: now,
  }

  const projects = await loadInternalProjects()
  await registryStore.write([...projects, project])
  return project
}

export async function updateInternalProject(
  projectId: string,
  patch: Partial<
    Pick<
      ICodeInternalProject,
      | 'name'
      | 'description'
      | 'html'
      | 'appData'
      | 'chat'
      | 'tags'
      | 'iconEmoji'
      | 'themeColor'
      | 'category'
      | 'linkedAppId'
    >
  >,
): Promise<ICodeInternalProject | undefined> {
  const projects = await loadInternalProjects()
  const index = projects.findIndex((project) => project.id === projectId)
  if (index < 0) {
    return undefined
  }

  const updated: ICodeInternalProject = {
    ...projects[index],
    ...patch,
    updatedAt: osNowMs(),
  }
  const next = [...projects]
  next[index] = updated
  await registryStore.write(next)
  return updated
}

export async function removeInternalProject(projectId: string): Promise<boolean> {
  const projects = await loadInternalProjects()
  const next = projects.filter((project) => project.id !== projectId)
  if (next.length === projects.length) {
    return false
  }
  await registryStore.write(next)
  return true
}

export async function getInternalProject(
  projectId: string,
): Promise<ICodeInternalProject | undefined> {
  return (await loadInternalProjects()).find((project) => project.id === projectId)
}

export function previewAppIdForInternal(projectId: string): `gen:icode:${string}` {
  return `gen:icode:${projectId}`
}
