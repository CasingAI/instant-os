/** 非 3D 应用不在 system 提示中提及标签；3D 相关说明见 buildApp3dSystemPromptExtension。 */
export function buildGeneratedAppTagPromptSection(): string {
  return ''
}

export { APP_CAPABILITY_TAG_3D } from './app-capability-tags.ts'
