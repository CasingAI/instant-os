import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from '../../os/device-storage.ts'
import type { GeneratedAppDataStore } from '../../os/generated-app-data-storage.ts'
import type { GeneratedAppId } from '../../os/types.ts'
import { toGeneratedAppId } from '../appstore/store-agent.ts'
import type { ICodeChatMessage, ICodeInternalProject } from './icode-types.ts'

const STORAGE_KEY = DEVICE_STORAGE_KEYS.icodeInternalProjects

function isStringRecord(value: unknown): value is GeneratedAppDataStore {
  if (typeof value !== 'object' || value === undefined) {
    return false
  }

  return Object.values(value as Record<string, unknown>).every((entry) => typeof entry === 'string')
}

function isChatMessage(value: unknown): value is ICodeChatMessage {
  if (typeof value !== 'object' || value === undefined) {
    return false
  }

  const message = value as Record<string, unknown>
  return (
    typeof message.id === 'string' &&
    (message.role === 'user' || message.role === 'assistant') &&
    typeof message.content === 'string' &&
    typeof message.createdAt === 'number'
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

export function loadInternalProjects(): ICodeInternalProject[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return []
    }

    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter(isInternalProject)
  } catch {
    return []
  }
}

function saveInternalProjects(projects: ICodeInternalProject[]): boolean {
  return writeLocalStorageItem(STORAGE_KEY, JSON.stringify(projects))
}

export function createInternalProject(name: string, description: string): ICodeInternalProject {
  const now = Date.now()
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
    linkedAppId: toGeneratedAppId(id) as GeneratedAppId,
    createdAt: now,
    updatedAt: now,
  }

  const projects = loadInternalProjects()
  saveInternalProjects([...projects, project])
  return project
}

export function updateInternalProject(
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
): ICodeInternalProject | undefined {
  const projects = loadInternalProjects()
  const index = projects.findIndex((project) => project.id === projectId)
  if (index < 0) {
    return undefined
  }

  const updated: ICodeInternalProject = {
    ...projects[index],
    ...patch,
    updatedAt: Date.now(),
  }
  const next = [...projects]
  next[index] = updated
  saveInternalProjects(next)
  return updated
}

export function removeInternalProject(projectId: string): boolean {
  const projects = loadInternalProjects()
  const next = projects.filter((project) => project.id !== projectId)
  if (next.length === projects.length) {
    return false
  }
  saveInternalProjects(next)
  return true
}

export function getInternalProject(projectId: string): ICodeInternalProject | undefined {
  return loadInternalProjects().find((project) => project.id === projectId)
}

export function previewAppIdForInternal(projectId: string): `gen:icode:${string}` {
  return `gen:icode:${projectId}`
}
