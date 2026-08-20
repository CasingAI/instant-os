import { runDataStoreTransaction, VSCODE_AI_CHAT_STORE } from '../../os/device-data-storage.ts'

/** VS Code AI 对话占用的数据空间字节。勿从此文件 import 对话 UI / Agent。 */
export async function getVscodeAiChatBytes(): Promise<number> {
  try {
    const records = await runDataStoreTransaction<Array<{ byteSize?: number }>>(
      VSCODE_AI_CHAT_STORE,
      'readonly',
      (store) => store.getAll(),
    )
    return records.reduce((total, record) => total + (record.byteSize ?? 0), 0)
  } catch {
    return 0
  }
}
