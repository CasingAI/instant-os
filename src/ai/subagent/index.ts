export {
  BUILTIN_SUBAGENT_IDS,
  BUILTIN_SUBAGENTS,
  isBuiltinSubAgentId,
} from './subagent-builtin.ts'
export {
  buildSubAgentDelegationPromptSection,
} from './subagent-prompt.ts'
export {
  capSubAgentAccess,
  listAvailableSubAgents,
  resolveModelKeyFromSource,
  resolveSubAgent,
  resolveSubAgentModelKey,
  shouldExposeSubAgentDelegation,
} from './subagent-registry.ts'
export {
  createDelegateSubAgentTool,
  type CreateDelegateSubAgentToolOptions,
  type RunSubAgentFn,
} from './subagent-delegate-tool.ts'
export {
  acquireSubAgentSlot,
  getRunningSubAgentCount,
  releaseSubAgentSlot,
  resetSubAgentRuntimeForTests,
  runSubAgent,
  type RunSubAgentOptions,
} from './subagent-runtime.ts'
export type {
  BuiltinSubAgentId,
  CustomSubAgentDefinition,
  EffectiveSubAgent,
  SubAgentAccess,
  SubAgentBuiltinOverride,
  SubAgentDefaultModelPolicy,
  SubAgentDefinition,
  SubAgentHostConfig,
  SubAgentModelSource,
  SubAgentRunResult,
} from './subagent-types.ts'
