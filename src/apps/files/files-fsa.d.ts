export {}

/** File System Access API 补全：TS DOM 有 Handle，但缺 picker / 权限 / move */

type FilesFsaPermissionMode = 'read' | 'readwrite'

type FilesFsaPermissionState = 'granted' | 'denied' | 'prompt'

type FilesFsaDirectoryPickerOptions = {
  id?: string
  mode?: FilesFsaPermissionMode
  startIn?: FileSystemHandle | string
}

declare global {
  interface FileSystemHandle {
    queryPermission?: (descriptor?: {
      mode?: FilesFsaPermissionMode
    }) => Promise<FilesFsaPermissionState>
    requestPermission?: (descriptor?: {
      mode?: FilesFsaPermissionMode
    }) => Promise<FilesFsaPermissionState>
    move?: (name: string) => Promise<void>
  }

  interface Window {
    showDirectoryPicker?: (
      options?: FilesFsaDirectoryPickerOptions,
    ) => Promise<FileSystemDirectoryHandle>
  }
}
