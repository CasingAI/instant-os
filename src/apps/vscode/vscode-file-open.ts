import { registerFileOpenHandler } from '../../os/file-open-registry.ts'
import { VSCODE_OPEN_EXTENSIONS, VSCODE_OPTIONAL_OPEN_EXTENSIONS } from './vscode-open-extensions.ts'

registerFileOpenHandler({
  appId: 'vscode',
  extensions: [...VSCODE_OPEN_EXTENSIONS, ...VSCODE_OPTIONAL_OPEN_EXTENSIONS],
  rank: 10,
  extensionRanks: { jsonl: 4, ndjson: 4 },
})
