import { isDevToolsEnabled } from './instant-os-runtime.ts'

export function installDevToolkit(appId: string): () => void {
  if (!isDevToolsEnabled()) {
    return () => {}
  }

  const cleanups: Array<() => void> = []
  let disposed = false

  void import('./install-dev-host-mock.ts').then((hostMock) => {
    if (disposed) {
      return
    }
    cleanups.push(hostMock.installDevHostMock({ appId }))
  })

  void Promise.all([import('./DevConsole.tsx'), import('preact')]).then(([devConsole, preact]) => {
    if (disposed) {
      return
    }

    const mount = document.createElement('div')
    mount.id = 'instant-os-dev-console-root'
    document.body.appendChild(mount)
    preact.render(preact.h(devConsole.DevConsole, {}), mount)

    cleanups.push(() => {
      preact.render(null, mount)
      mount.remove()
    })
  })

  return () => {
    disposed = true
    for (const cleanup of cleanups.splice(0, cleanups.length)) {
      cleanup()
    }
  }
}
